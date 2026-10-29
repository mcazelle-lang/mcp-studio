import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AudioEngineService, startSampleVoice } from './audio-engine.service';
import { encodeWav } from './audio-utils';
import { KitService } from './kit.service';
import { MetronomeService } from './metronome.service';
import { Sample, Take, TakeNote, TakeSound } from './models';
import { SampleLibraryService } from './sample-library.service';
import { startSynthVoice } from './synth.service';

const API = '/api/takes';
const SETTINGS_KEY = 'mpc.takes.settings';
/** Une note jouée un peu avant le premier temps est ramenée au début plutôt que perdue. */
const EARLY_TOLERANCE_S = 0.15;
const RENDER_RATE = 44100;

export type RecorderState = 'idle' | 'countin' | 'recording';
export type Quantize = 0 | 8 | 16;

interface OpenNote {
  start: number;
  velocity: number;
}

interface Playback {
  /** Toutes les notes de la relecture passent par ce bus : le couper suffit à tout faire taire. */
  bus: GainNode;
  stoppers: (() => void)[];
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Enregistrement des notes jouées au clavier, calé sur le métronome :
 * prises sauvegardées, relecture (en boucle ou non) et conversion en sample.
 */
@Injectable({ providedIn: 'root' })
export class TakesService {
  private readonly http = inject(HttpClient);
  private readonly engine = inject(AudioEngineService);
  private readonly metronome = inject(MetronomeService);
  private readonly library = inject(SampleLibraryService);
  private readonly kit = inject(KitService);

  readonly takes = signal<Take[]>([]);
  readonly state = signal<RecorderState>('idle');
  /** Instant audio où l'enregistrement commence (fin du décompte). */
  readonly recordStart = signal(0);
  readonly countIn = signal(true);
  readonly quantize = signal<Quantize>(0);
  readonly loop = signal(false);
  readonly playingId = signal<string | null>(null);

  private sound?: TakeSound;
  private readonly open = new Map<number, OpenNote>();
  private captured: { midi: number; start: number; end: number; velocity: number }[] = [];
  private startedMetronome = false;
  private stateTimer?: ReturnType<typeof setTimeout>;
  private playback?: Playback;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
      if (saved) {
        this.countIn.set(saved.countIn ?? true);
        this.quantize.set(saved.quantize ?? 0);
        this.loop.set(saved.loop ?? false);
      }
    } catch {
      /* stockage indisponible */
    }
    void firstValueFrom(this.http.get<Take[]>(API))
      .then((takes) => this.takes.set(takes))
      .catch(() => {});
  }

  saveSettings(): void {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ countIn: this.countIn(), quantize: this.quantize(), loop: this.loop() }),
      );
    } catch {
      /* stockage indisponible */
    }
  }

  // ---------- Enregistrement ----------

  /** Arme l'enregistrement : il démarre au début de la prochaine mesure (après une mesure de décompte si activé). */
  arm(sound: TakeSound): void {
    if (this.state() !== 'idle') return;
    this.stopPlayback();
    this.sound = sound;
    this.captured = [];
    this.open.clear();
    this.startedMetronome = !this.metronome.running();
    if (this.startedMetronome) this.metronome.start();

    const now = this.engine.ctx.currentTime;
    const start = this.metronome.nextBarStart(now + (this.countIn() ? this.metronome.barDuration() : 0));
    this.recordStart.set(start);
    this.state.set('countin');
    this.stateTimer = setTimeout(() => this.state() === 'countin' && this.state.set('recording'), (start - now) * 1000);
  }

  noteOn(midi: number, velocity = 1): void {
    if (this.state() === 'idle') return;
    this.closeNote(midi);
    this.open.set(midi, { start: this.engine.ctx.currentTime, velocity });
  }

  /** À appeler quand le son de la note s'arrête vraiment (relâchement, ou fin du sustain). */
  noteOff(midi: number): void {
    if (this.state() !== 'idle') this.closeNote(midi);
  }

  private closeNote(midi: number): void {
    const note = this.open.get(midi);
    if (!note) return;
    this.open.delete(midi);
    this.captured.push({ midi, start: note.start, end: this.engine.ctx.currentTime, velocity: note.velocity });
  }

  /** Arrête l'enregistrement et sauvegarde la prise. Renvoie null si rien n'a été joué. */
  async stopRecording(): Promise<Take | null> {
    if (this.state() === 'idle' || !this.sound) return null;
    clearTimeout(this.stateTimer);
    const now = this.engine.ctx.currentTime;
    const start = this.recordStart();
    [...this.open.keys()].forEach((midi) => this.closeNote(midi));
    this.state.set('idle');
    if (this.startedMetronome) this.metronome.stop();
    if (now < start) return null;

    const bar = this.metronome.barDuration();
    const bars = Math.max(1, Math.ceil((now - start - 0.05) / bar));
    const length = bars * bar;
    const notes = this.buildNotes(start, length);
    if (!notes.length) return null;

    // Numéro suivant le plus grand existant, et pas de « Prise 4 · Prise 2 · … » quand on rejoue une prise.
    const number = Math.max(0, ...this.takes().map((t) => Number(/^Prise (\d+)/.exec(t.name)?.[1] ?? 0))) + 1;
    const label = this.sound.label.replace(/^Prise \d+ · /, '');
    const take = await firstValueFrom(
      this.http.post<Take>(API, {
        name: `Prise ${number} · ${label}`,
        bpm: this.metronome.bpm(),
        beatsPerBar: this.metronome.beatsPerBar(),
        bars,
        length,
        sound: this.sound,
        notes,
      }),
    );
    this.takes.update((list) => [take, ...list]);
    return take;
  }

  private buildNotes(start: number, length: number): TakeNote[] {
    const q = this.quantize();
    const grid = q ? (this.metronome.beatDuration() * 4) / q : 0;
    const notes: TakeNote[] = [];
    for (const n of this.captured) {
      let time = n.start - start;
      let duration = Math.max(0.03, n.end - n.start);
      if (time < -EARLY_TOLERANCE_S || time >= length) continue;
      if (time < 0) {
        duration = Math.max(0.03, duration + time);
        time = 0;
      }
      if (grid) {
        // Une note calée sur la fin de la prise appartient au début du tour suivant.
        time = (Math.round(time / grid) * grid) % length;
      }
      notes.push({ midi: n.midi, time: +time.toFixed(4), duration: +duration.toFixed(4), velocity: n.velocity });
    }
    return notes.sort((a, b) => a.time - b.time);
  }

  // ---------- Relecture ----------

  private async prepare(take: Take): Promise<AudioBuffer | null> {
    if (take.sound.kind === 'synth') return null;
    try {
      return await this.library.getBuffer(take.sound.sampleId);
    } catch {
      throw new Error(`le sample « ${take.sound.label} » utilisé par cette prise n’existe plus`);
    }
  }

  /** Programme toutes les notes d'une prise à partir de l'instant `t0` dans le contexte donné. */
  private schedule(
    ctx: BaseAudioContext,
    destination: AudioNode,
    take: Take,
    buffer: AudioBuffer | null,
    t0: number,
    stoppers?: (() => void)[],
  ): void {
    const sound = take.sound;
    for (const note of take.notes) {
      const start = t0 + note.time;
      const end = start + note.duration;
      if (sound.kind === 'synth') {
        const voice = startSynthVoice(ctx, destination, sound.patch, note.midi, note.velocity, start);
        voice.release(end);
        stoppers?.push(() => voice.kill());
      } else if (buffer) {
        const { voice, source } = startSampleVoice(
          ctx,
          destination,
          null,
          buffer,
          sound.settings,
          note.velocity,
          note.midi - sound.rootNote,
          start,
        );
        voice.stop(sound.release, end);
        stoppers?.push(() => {
          try {
            source.stop();
          } catch {
            /* déjà arrêtée */
          }
        });
      }
    }
  }

  async play(take: Take): Promise<void> {
    this.stopPlayback();
    const buffer = await this.prepare(take);
    const ctx = this.engine.ctx;
    const bus = ctx.createGain();
    bus.connect(this.engine.input);
    const playback: Playback = { bus, stoppers: [] };
    this.playback = playback;
    this.playingId.set(take.id);

    let next = ctx.currentTime + 0.05;
    const scheduleLoop = () => {
      // On programme chaque tour un peu avant qu'il commence.
      while (next < ctx.currentTime + 0.5) {
        this.schedule(ctx, bus, take, buffer, next, playback.stoppers);
        next += take.length;
        if (!this.loop()) {
          clearInterval(playback.timer);
          const remaining = (next - ctx.currentTime) * 1000 + 300;
          playback.timer = setTimeout(() => this.playback === playback && this.stopPlayback(), remaining);
          return;
        }
      }
    };
    playback.timer = setInterval(scheduleLoop, 100);
    scheduleLoop();
  }

  stopPlayback(): void {
    const playback = this.playback;
    if (!playback) return;
    this.playback = undefined;
    clearInterval(playback.timer);
    clearTimeout(playback.timer);
    const now = this.engine.ctx.currentTime;
    playback.bus.gain.setTargetAtTime(0, now, 0.01);
    setTimeout(() => {
      playback.stoppers.forEach((stop) => stop());
      playback.bus.disconnect();
    }, 80);
    this.playingId.set(null);
  }

  // ---------- Conversion en sample ----------

  /** Fige une prise en fichier WAV dans la bibliothèque ; l'affecte au pad sélectionné si `assign`. */
  async toSample(take: Take, assign: boolean): Promise<Sample> {
    const buffer = await this.prepare(take);
    const tail = (take.sound.kind === 'synth' ? take.sound.patch.ampEnv.release : take.sound.release) + 0.2;
    const offline = new OfflineAudioContext(2, Math.ceil((take.length + tail) * RENDER_RATE), RENDER_RATE);
    this.schedule(offline, offline.destination, take, buffer, 0);
    const rendered = await offline.startRendering();

    // Normalise comme les sons des kits : niveau homogène sur les pads, sans saturation.
    let peak = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      for (const v of rendered.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    }
    if (peak > 0) {
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const data = rendered.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] *= 0.9 / peak;
      }
    }

    const sample = await this.library.upload(encodeWav(rendered), {
      name: take.name,
      source: 'take',
      duration: rendered.duration,
      filename: `prise-${take.id.slice(0, 8)}.wav`,
      buffer: rendered,
    });
    if (assign) this.kit.assign(this.kit.selected(), sample.id);
    return sample;
  }

  async remove(take: Take): Promise<void> {
    if (this.playingId() === take.id) this.stopPlayback();
    await firstValueFrom(this.http.delete(`${API}/${take.id}`));
    this.takes.update((list) => list.filter((t) => t.id !== take.id));
  }
}
