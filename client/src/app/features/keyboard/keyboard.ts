import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AudioEngineService, Voice } from '../../core/audio-engine.service';
import { cutoffToHz, formatHz, formatSeconds, noteName } from '../../core/audio-utils';
import { describeError } from '../../core/http-errors';
import { KitService } from '../../core/kit.service';
import { MetronomeService } from '../../core/metronome.service';
import { PlaybackSettings, Take, TakeSound, defaultPlaybackSettings, padLabel } from '../../core/models';
import { FACTORY_BY_FAMILY, FactoryPatch, factoryPreset } from '../../core/presets/synth-presets';
import { SampleLibraryService } from '../../core/sample-library.service';
import { SynthService } from '../../core/synth.service';
import { Quantize, TakesService } from '../../core/takes.service';
import { Knob } from '../../shared/knob';
import { OCTAVE_KEY_CODES, PIANO_KEY_CODES, Piano, isPlayableKeyEvent } from '../../shared/piano';

@Component({
  selector: 'app-keyboard',
  imports: [Knob, Piano, RouterLink],
  templateUrl: './keyboard.html',
  styleUrl: './keyboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onKey($event, true)',
    '(window:keyup)': 'onKey($event, false)',
    // Une touche relâchée hors de la fenêtre ne déclenche pas de keyup : on coupe tout.
    '(window:blur)': 'releaseKeys()',
    '(window:resize)': 'viewport.set({ w: $any($event.target).innerWidth, h: $any($event.target).innerHeight })',
  },
})
export class KeyboardView {
  protected readonly library = inject(SampleLibraryService);
  protected readonly synth = inject(SynthService);
  protected readonly takes = inject(TakesService);
  protected readonly metronome = inject(MetronomeService);
  private readonly engine = inject(AudioEngineService);
  private readonly kit = inject(KitService);

  protected readonly instruments = FACTORY_BY_FAMILY;
  /** « synth » (patch de la page Synthé), « factory:<clé> » (instrument) ou « sample:<id> ». */
  protected readonly source = signal<string>('synth');
  protected readonly octave = signal(3);
  protected readonly sustain = signal(false);
  protected readonly rootNote = signal(60);
  protected readonly settings = signal<PlaybackSettings>({ ...defaultPlaybackSettings(), mode: 'gate' });
  protected readonly release = signal(0.3);
  protected readonly keysDown = signal<ReadonlySet<number>>(new Set());
  protected readonly viewport = signal({ w: window.innerWidth, h: window.innerHeight });
  protected readonly takesOpen = signal(false);
  protected readonly message = signal<{ text: string; error?: boolean } | null>(null);
  protected readonly busyTake = signal<string | null>(null);
  protected readonly selectedLabel = computed(() => padLabel(this.kit.selected()));
  protected readonly isSample = computed(() => this.source().startsWith('sample:'));

  /** En portrait on empile deux rangées d'une octave ; en paysage, une seule rangée plus large. */
  protected readonly layout = computed(() => {
    const { w, h } = this.viewport();
    const portrait = h > w;
    const octaves = Math.max(1, Math.min(3, Math.floor(w / (portrait ? 330 : 380))));
    const base = (this.octave() + 1) * 12;
    const rows = portrait ? [base + octaves * 12, base] : [base];
    return { rows, octaves };
  });

  protected readonly range = computed(() => {
    const { rows, octaves } = this.layout();
    return `${noteName(Math.min(...rows))} – ${noteName(Math.max(...rows) + octaves * 12)}`;
  });

  /** Texte de l'enregistreur : tempo, décompte (4, 3, 2, 1) ou mesure en cours. */
  protected readonly status = computed(() => {
    const state = this.takes.state();
    const beat = this.metronome.beat();
    if (state === 'idle') {
      const playing = this.takes.takes().find((t) => t.id === this.takes.playingId());
      return playing ? `▶ ${playing.name}` : 'Prêt';
    }
    const start = this.takes.recordStart();
    if (state === 'countin') {
      const remaining = beat ? Math.round((start - beat.time) / this.metronome.beatDuration()) : 0;
      return remaining > 0 ? `Décompte ${remaining}` : 'Décompte…';
    }
    const bar = beat ? Math.floor((beat.time - start) / this.metronome.barDuration() + 1e-6) + 1 : 1;
    return `REC · mesure ${Math.max(1, bar)}`;
  });

  protected readonly fmt = {
    percent: (v: number) => `${Math.round(v * 100)}`,
    cutoff: (v: number) => formatHz(cutoffToHz(v)),
    time: (v: number) => formatSeconds(v),
    note: (v: number) => noteName(v),
    bpm: (v: number) => `${Math.round(v)} BPM`,
  };

  private readonly voices = new Map<number, Voice>();
  private readonly sustained = new Set<number>();
  /** Notes qui sonnent (pour clore proprement les notes enregistrées). */
  private readonly sounding = new Set<number>();
  private buffer: AudioBuffer | null = null;
  private instrument: FactoryPatch | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.allOff();
      if (this.takes.state() !== 'idle') void this.takes.stopRecording();
    });
  }

  protected async selectSource(value: string): Promise<void> {
    this.allOff();
    this.source.set(value);
    this.buffer = null;
    this.instrument = null;
    const [kind, id] = value.split(':');
    if (kind === 'factory') this.instrument = factoryPreset(id);
    if (kind === 'sample') this.buffer = await this.library.getBuffer(id);
  }

  protected setSetting<K extends keyof PlaybackSettings>(key: K, value: PlaybackSettings[K]): void {
    this.settings.update((s) => ({ ...s, [key]: value }));
  }

  protected noteOn(midi: number): void {
    this.sustained.delete(midi);
    if (this.isSample()) {
      if (!this.buffer) return;
      this.voices.get(midi)?.stop(0.02);
      this.voices.set(midi, this.engine.playBuffer(this.buffer, this.settings(), 1, midi - this.rootNote()));
    } else {
      this.synth.noteOn(midi, 1, this.instrument?.patch ?? this.synth.patch());
    }
    this.sounding.add(midi);
    this.takes.noteOn(midi);
  }

  protected noteOff(midi: number): void {
    if (this.sustain()) {
      this.sustained.add(midi);
      return;
    }
    this.stopNote(midi);
  }

  private stopNote(midi: number): void {
    this.synth.noteOff(midi);
    this.voices.get(midi)?.stop(this.release());
    this.voices.delete(midi);
    this.sounding.delete(midi);
    this.takes.noteOff(midi);
  }

  protected toggleSustain(): void {
    const on = !this.sustain();
    this.sustain.set(on);
    if (!on) {
      this.sustained.forEach((m) => this.stopNote(m));
      this.sustained.clear();
    }
  }

  protected shiftOctave(delta: number): void {
    this.allOff();
    this.octave.update((o) => Math.min(6, Math.max(0, o + delta)));
  }

  protected releaseKeys(): void {
    this.keysDown.set(new Set());
    this.allOff();
  }

  private allOff(): void {
    this.sounding.forEach((m) => this.takes.noteOff(m));
    this.sounding.clear();
    this.synth.allNotesOff();
    this.voices.forEach((v) => v.stop(0.05));
    this.voices.clear();
    this.sustained.clear();
  }

  // ---------- Enregistrement ----------

  /** Le son courant, figé pour que la prise sonne pareil même si on modifie le synthé ensuite. */
  private currentSound(): TakeSound | null {
    if (this.isSample()) {
      const id = this.source().slice('sample:'.length);
      const sample = this.library.byId().get(id);
      if (!sample) return null;
      return {
        kind: 'sample',
        label: sample.name,
        sampleId: id,
        rootNote: this.rootNote(),
        settings: this.settings(),
        release: this.release(),
      };
    }
    const patch = structuredClone(this.instrument?.patch ?? this.synth.patch());
    return { kind: 'synth', label: this.instrument?.name ?? 'Synthé', patch };
  }

  protected async toggleRecord(): Promise<void> {
    if (this.takes.state() === 'idle') {
      const sound = this.currentSound();
      if (!sound) return;
      this.message.set(null);
      this.takes.arm(sound);
      return;
    }
    this.allOff();
    try {
      const take = await this.takes.stopRecording();
      this.message.set(
        take
          ? {
              text: `« ${take.name} » enregistrée : ${take.notes.length} note${take.notes.length > 1 ? 's' : ''} sur ${take.bars} mesure${take.bars > 1 ? 's' : ''}.`,
            }
          : { text: 'Aucune note enregistrée.' },
      );
    } catch (err) {
      this.message.set({ text: `Enregistrement impossible : ${describeError(err)}`, error: true });
    }
  }

  protected async togglePlay(take: Take): Promise<void> {
    if (this.takes.playingId() === take.id) return this.takes.stopPlayback();
    try {
      await this.takes.play(take);
    } catch (err) {
      this.message.set({ text: `Lecture impossible : ${describeError(err)}`, error: true });
    }
  }

  protected async toSample(take: Take): Promise<void> {
    this.busyTake.set(take.id);
    try {
      await this.takes.toSample(take, true);
      this.message.set({ text: `« ${take.name} » est maintenant un sample, sur le pad ${this.selectedLabel()}.` });
    } catch (err) {
      this.message.set({ text: `Conversion impossible : ${describeError(err)}`, error: true });
    } finally {
      this.busyTake.set(null);
    }
  }

  protected async removeTake(take: Take): Promise<void> {
    if (!confirm(`Supprimer « ${take.name} » ?`)) return;
    try {
      await this.takes.remove(take);
    } catch (err) {
      this.message.set({ text: `Suppression impossible : ${describeError(err)}`, error: true });
    }
  }

  protected setQuantize(q: Quantize): void {
    this.takes.quantize.set(q);
    this.takes.saveSettings();
  }

  protected setCountIn(on: boolean): void {
    this.takes.countIn.set(on);
    this.takes.saveSettings();
  }

  protected setLoop(on: boolean): void {
    this.takes.loop.set(on);
    this.takes.saveSettings();
  }

  protected onKey(e: KeyboardEvent, down: boolean): void {
    if (!isPlayableKeyEvent(e)) return;
    if (down && OCTAVE_KEY_CODES[e.code]) {
      e.preventDefault();
      this.keysDown.set(new Set());
      return this.shiftOctave(OCTAVE_KEY_CODES[e.code]);
    }
    const offset = PIANO_KEY_CODES[e.code];
    if (offset === undefined) return;
    e.preventDefault();
    const midi = Math.min(...this.layout().rows) + offset;
    const keys = new Set(this.keysDown());
    if (down) {
      keys.add(midi);
      this.noteOn(midi);
    } else {
      keys.delete(midi);
      this.noteOff(midi);
    }
    this.keysDown.set(keys);
  }
}
