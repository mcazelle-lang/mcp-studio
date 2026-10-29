import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
const STORAGE_KEY = 'mpc.metronome';

export interface Beat {
  /** Numéro du temps depuis le démarrage (0 = premier temps). */
  index: number;
  /** Premier temps d'une mesure. */
  downbeat: boolean;
  /** Position dans la mesure (0 .. beatsPerBar - 1). */
  inBar: number;
  /** Instant audio du temps. */
  time: number;
}

/**
 * Métronome : les clics sont programmés un peu à l'avance sur l'horloge audio
 * (précis à l'échantillon près) et le voyant s'allume quand le clic sonne réellement.
 */
@Injectable({ providedIn: 'root' })
export class MetronomeService {
  private readonly engine = inject(AudioEngineService);

  readonly bpm = signal(120);
  readonly beatsPerBar = signal(4);
  /** Clic sonore (le voyant clignote toujours). */
  readonly click = signal(true);
  readonly running = signal(false);
  /** Dernier temps entendu ; le voyant s'en sert pour clignoter. */
  readonly beat = signal<Beat | null>(null);
  readonly beatDuration = computed(() => 60 / this.bpm());
  readonly barDuration = computed(() => this.beatDuration() * this.beatsPerBar());

  /** Instant audio du temps n° 0. */
  private origin = 0;
  private nextIndex = 0;
  private timer?: ReturnType<typeof setInterval>;
  private frame = 0;
  private readonly pending: { time: number; index: number }[] = [];
  private readonly out: GainNode;

  constructor() {
    this.out = this.engine.ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(this.engine.ctx.destination);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved) {
        this.bpm.set(saved.bpm ?? 120);
        this.beatsPerBar.set(saved.beatsPerBar ?? 4);
        this.click.set(saved.click ?? true);
      }
    } catch {
      /* stockage indisponible */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ bpm: this.bpm(), beatsPerBar: this.beatsPerBar(), click: this.click() }),
      );
    } catch {
      /* stockage indisponible */
    }
  }

  setBpm(bpm: number): void {
    const value = Math.round(Math.min(240, Math.max(40, bpm)));
    if (value === this.bpm()) return;
    // On garde la position courante pour changer de tempo sans « sauter ».
    if (this.running()) {
      const now = this.engine.ctx.currentTime;
      const position = (now - this.origin) / this.beatDuration();
      this.bpm.set(value);
      this.origin = now - position * this.beatDuration();
      this.resync();
    } else {
      this.bpm.set(value);
    }
    this.persist();
  }

  setBeatsPerBar(beats: number): void {
    this.beatsPerBar.set(beats);
    this.persist();
  }

  setClick(on: boolean): void {
    this.click.set(on);
    this.persist();
  }

  toggle(): void {
    if (this.running()) this.stop();
    else this.start();
  }

  start(): void {
    if (this.running()) return;
    this.engine.unlock();
    this.origin = this.engine.ctx.currentTime + 0.1;
    this.nextIndex = 0;
    this.pending.length = 0;
    this.running.set(true);
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.frame = requestAnimationFrame(this.draw);
  }

  stop(): void {
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    this.pending.length = 0;
    this.running.set(false);
    this.beat.set(null);
  }

  /** Instant audio du premier début de mesure situé à `time` ou après. */
  nextBarStart(time: number): number {
    const bar = this.barDuration();
    return this.origin + Math.ceil((time - this.origin - 1e-3) / bar) * bar;
  }

  private resync(): void {
    const now = this.engine.ctx.currentTime;
    this.nextIndex = Math.max(0, Math.ceil((now - this.origin) / this.beatDuration()));
    this.pending.length = 0;
  }

  private schedule(): void {
    const ctx = this.engine.ctx;
    while (this.origin + this.nextIndex * this.beatDuration() < ctx.currentTime + LOOKAHEAD_S) {
      const time = this.origin + this.nextIndex * this.beatDuration();
      if (time >= ctx.currentTime - 0.01) {
        if (this.click()) this.playClick(time, this.nextIndex % this.beatsPerBar() === 0);
        this.pending.push({ time, index: this.nextIndex });
      }
      this.nextIndex++;
    }
  }

  private playClick(time: number, downbeat: boolean): void {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = downbeat ? 1760 : 1100;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(downbeat ? 1 : 0.6, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(env).connect(this.out);
    // Sans ce débranchement, chaque clic resterait branché à la sortie et serait traité indéfiniment.
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
    osc.start(time);
    osc.stop(time + 0.06);
  }

  private draw = () => {
    const now = this.engine.ctx.currentTime;
    let latest: { time: number; index: number } | undefined;
    while (this.pending.length && this.pending[0].time <= now) latest = this.pending.shift();
    if (latest) {
      const inBar = latest.index % this.beatsPerBar();
      this.beat.set({ index: latest.index, downbeat: inBar === 0, inBar, time: latest.time });
    }
    this.frame = requestAnimationFrame(this.draw);
  };
}
