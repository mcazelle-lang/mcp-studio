import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AudioEngineService, AudioMode, saveAudioMode } from './core/audio-engine.service';
import { KitService } from './core/kit.service';
import { MetronomeService } from './core/metronome.service';
import { padLabel } from './core/models';
import { SynthService } from './core/synth.service';
import { TakesService } from './core/takes.service';

/** Au-delà, le décalage entre le geste et le son devient perceptible. */
const LATENCY_WARNING_MS = 80;
/** Délai après le démarrage de l'audio avant de compter les coupures. */
const GLITCH_WARMUP_MS = 3000;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Les navigateurs mobiles n'autorisent l'audio qu'après un geste de l'utilisateur.
    '(document:pointerdown)': 'engine.unlock()',
    '(document:keydown)': 'engine.unlock()',
  },
})
export class App {
  protected readonly engine = inject(AudioEngineService);
  protected readonly metronome = inject(MetronomeService);
  private readonly kit = inject(KitService);
  private readonly synth = inject(SynthService);
  private readonly takes = inject(TakesService);

  protected readonly tabs = [
    { path: '/pads', label: 'Pads', icon: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z' },
    { path: '/samples', label: 'Samples', icon: 'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 18v3' },
    { path: '/synth', label: 'Synthé', icon: 'M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0M4 20h16M4 4h16' },
    { path: '/keyboard', label: 'Clavier', icon: 'M3 5h18v14H3zM8 5v8M13 5v8M18 5v8M8 13v6M13 13v6M18 13v6' },
  ];

  protected panic(): void {
    this.takes.stopPlayback();
    this.synth.allNotesOff();
    this.engine.stopAll();
  }

  protected readonly selectedLabel = computed(() => padLabel(this.kit.selected()));

  /** Fenêtre de diagnostic de la latence (null = fermée). */
  protected readonly latency = signal<ReturnType<AudioEngineService['latency']> | null>(null);
  /** Latence annoncée trop élevée. */
  protected readonly latencyWarning = signal(false);
  /** Coupures audio depuis l'ouverture de l'app (null si le navigateur ne les compte pas). */
  protected readonly glitches = signal<number | null>(null);
  /** Voyant orange : latence audible ou coupures audio constatées. */
  protected readonly audioWarning = computed(() => this.latencyWarning() || (this.glitches() ?? 0) > 0);

  constructor() {
    // La latence de sortie n'est connue qu'une fois l'audio démarré : on la vérifie à ce moment-là.
    effect(() => {
      if (!this.engine.running()) return;
      setTimeout(() => this.checkLatency(), 500);
    });
    // Surveille les coupures (son qui saute) pour pouvoir le signaler et proposer le mode Stable.
    // Le démarrage de la sortie audio en produit quelques-unes, inaudibles : on ne compte qu'ensuite.
    let watching = false;
    effect(() => {
      if (!this.engine.running() || watching || this.engine.underruns() === null) return;
      watching = true;
      setTimeout(() => {
        const initial = this.engine.underruns() ?? 0;
        this.glitches.set(0);
        setInterval(() => {
          this.glitches.set((this.engine.underruns() ?? 0) - initial);
          this.checkLatency();
        }, 2000);
      }, GLITCH_WARMUP_MS);
    });
  }

  private checkLatency(): void {
    const { processing, output } = this.engine.latency();
    this.latencyWarning.set(processing + (output ?? 0) > LATENCY_WARNING_MS);
  }

  protected toggleLatency(): void {
    this.latency.set(this.latency() ? null : this.engine.latency());
  }

  protected setAudioMode(mode: AudioMode): void {
    if (mode === this.engine.mode) return;
    saveAudioMode(mode);
    // Le mode s'applique à la création du moteur audio.
    location.reload();
  }
}
