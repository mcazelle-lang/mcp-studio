import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { formatHz, formatSeconds, midiToFreq, noteName } from '../../core/audio-utils';
import { Envelope, SynthPatch } from '../../core/models';
import { envelopeValue, filterCutoffRange, startSynthVoice } from '../../core/synth.service';

export type ScopeMode = 'wave' | 'note' | 'filter';

interface Rendered {
  mode: 'wave' | 'note';
  samples: Float32Array;
}

interface Colors {
  accent: string;
  line: string;
  muted: string;
  text: string;
  filter: string;
}

const WAVE_NOTE = 48;
const NOTE_NOTE = 60;
const DB_TOP = 24;
const DB_BOTTOM = -48;
const FILTER_LABELS: Record<SynthPatch['filter']['type'], string> = {
  lowpass: 'Passe-bas',
  bandpass: 'Passe-bande',
  highpass: 'Passe-haut',
};

/** Durée pendant laquelle la note est tenue dans l'aperçu « Note ». */
function noteHold(patch: SynthPatch): number {
  return Math.min(3, Math.max(0.5, patch.ampEnv.attack + patch.ampEnv.decay + 0.3));
}

function noteLength(patch: SynthPatch): number {
  return noteHold(patch) + Math.max(patch.ampEnv.release, 0.01) + 0.05;
}

/** Fenêtre d'observation de l'onde : au moins 2 périodes de l'oscillateur le plus grave. */
function waveWindow(patch: SynthPatch): { start: number; length: number } {
  const freq = midiToFreq(WAVE_NOTE);
  const active = [patch.osc1, patch.osc2].filter((o) => o.level > 0);
  const lowest = active.length ? Math.min(...active.map((o) => o.octave)) : 0;
  return {
    // On observe le son au sommet de l'attaque, là où il est le plus présent.
    start: Math.min(patch.ampEnv.attack, 2) + 0.03,
    length: Math.max(2 / (freq * 2 ** lowest), 3 / freq),
  };
}

async function renderWave(patch: SynthPatch): Promise<Float32Array> {
  const rate = 44100;
  const { start, length } = waveWindow(patch);
  const ctx = new OfflineAudioContext(1, Math.ceil((start + length) * rate) + 1, rate);
  startSynthVoice(ctx, ctx.destination, patch, WAVE_NOTE, 1, 0);
  const buffer = await ctx.startRendering();
  const from = Math.floor(start * rate);
  return buffer.getChannelData(0).slice(from, from + Math.ceil(length * rate));
}

async function renderNote(patch: SynthPatch): Promise<Float32Array> {
  const rate = 22050;
  const ctx = new OfflineAudioContext(1, Math.ceil(noteLength(patch) * rate), rate);
  startSynthVoice(ctx, ctx.destination, patch, NOTE_NOTE, 1, 0).release(noteHold(patch));
  return (await ctx.startRendering()).getChannelData(0);
}

/** Valeur (0..1) d'une enveloppe à l'instant t, relâchée à `hold`, comme dans le moteur du synthé. */
function envelopeAt(env: Envelope, t: number, hold: number, linearRelease: boolean): number {
  if (t < hold) return envelopeValue(env, t, 1, 0);
  const atRelease = envelopeValue(env, hold, 1, 0);
  const release = Math.max(env.release, 0.01);
  return linearRelease
    ? Math.max(0, atRelease * (1 - (t - hold) / release))
    : atRelease * Math.exp(-(t - hold) / Math.max(release / 4, 1e-4));
}

/**
 * Aperçu graphique du patch : forme d'onde, note complète avec enveloppes,
 * ou réponse en fréquence du filtre. Recalculé à chaque modification.
 */
@Component({
  selector: 'app-synth-scope',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div class="segmented">
        <button type="button" [class.on]="choice() === 'auto'" (click)="choice.set('auto')" title="Suit le potard que vous tournez">
          Auto
        </button>
        @for (m of modes; track m.value) {
          <button
            type="button"
            [class.on]="choice() === m.value"
            [class.follow]="choice() === 'auto' && mode() === m.value"
            (click)="choice.set(m.value)"
          >
            {{ m.label }}
          </button>
        }
      </div>
      <span class="caption">{{ caption() }}</span>
    </div>
    <div class="plot">
      <canvas #canvas></canvas>
      @if (mode() === 'note') {
        <div class="legend">
          <span class="amp">Volume</span>
          @if (patch().filter.envAmount > 0.01) {
            <span class="flt">Filtre</span>
          }
        </div>
      }
      @if (mode() === 'filter' && patch().filter.envAmount > 0.01) {
        <div class="legend"><span class="flt dashed">Ouverture max (env)</span></div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; --scope-filter: #7fb4ff; }
    .head { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .segmented { flex: none; }
    .segmented button.follow { color: var(--accent); }
    .caption {
      flex: 1; min-width: 0; text-align: right; font-size: 12px; color: var(--muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .plot {
      position: relative; height: var(--scope-height, 120px);
      background: var(--surface-2); border-radius: 10px; overflow: hidden;
    }
    canvas { width: 100%; height: 100%; display: block; }
    .legend {
      position: absolute; top: 6px; right: 8px; display: flex; gap: 10px;
      font-size: 10px; color: var(--muted); pointer-events: none;
    }
    .legend span::before {
      content: ''; display: inline-block; width: 12px; height: 2px; margin-right: 4px; vertical-align: middle;
    }
    .amp::before { background: var(--text); }
    .flt::before { background: var(--scope-filter); }
    .flt.dashed::before { background: repeating-linear-gradient(90deg, var(--scope-filter) 0 3px, transparent 3px 5px); }
  `,
})
export class SynthScope {
  readonly patch = input.required<SynthPatch>();
  /** Mode suggéré par le dernier réglage modifié (utilisé en mode Auto). */
  readonly follow = input<ScopeMode>('wave');

  protected readonly modes: { value: ScopeMode; label: string }[] = [
    { value: 'wave', label: 'Onde' },
    { value: 'note', label: 'Note' },
    { value: 'filter', label: 'Filtre' },
  ];
  protected readonly choice = signal<ScopeMode | 'auto'>('auto');
  protected readonly mode = computed(() => {
    const choice = this.choice();
    return choice === 'auto' ? this.follow() : choice;
  });

  protected readonly caption = computed(() => {
    const patch = this.patch();
    switch (this.mode()) {
      case 'wave':
        return `Signal sur ${noteName(WAVE_NOTE)}`;
      case 'note':
        return `${noteName(NOTE_NOTE)} tenue ${formatSeconds(noteHold(patch))} puis relâchée`;
      case 'filter': {
        const { base, peak } = filterCutoffRange(patch);
        const env = patch.filter.envAmount > 0.01 ? ` → ${formatHz(peak)}` : '';
        return `${FILTER_LABELS[patch.filter.type]} ${formatHz(base)}Hz${env} · Q ${patch.filter.resonance.toFixed(1)}`;
      }
    }
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly width = signal(0);
  private readonly rendered = signal<Rendered | null>(null);
  private filterCtx?: OfflineAudioContext;
  private rendering = false;
  private pending = false;

  constructor() {
    const observer = new ResizeObserver(([entry]) => this.width.set(Math.round(entry.contentRect.width)));
    observer.observe(this.host.nativeElement);
    inject(DestroyRef).onDestroy(() => observer.disconnect());

    effect(() => {
      this.patch();
      if (this.mode() !== 'filter') this.requestRender();
    });
    afterRenderEffect(() => {
      this.width();
      this.draw(this.mode(), this.patch(), this.rendered());
    });
  }

  /** Lance un rendu hors-ligne ; pendant qu'on tourne un potard, on enchaîne au plus un rendu à la fois. */
  private requestRender(): void {
    if (this.rendering) {
      this.pending = true;
      return;
    }
    this.rendering = true;
    const patch = untracked(this.patch);
    const mode = untracked(this.mode);
    if (mode === 'filter') {
      this.rendering = false;
      return;
    }
    (mode === 'wave' ? renderWave(patch) : renderNote(patch))
      .then((samples) => this.rendered.set({ mode, samples }))
      .catch((err) => console.error('Aperçu du synthé impossible', err))
      .finally(() => {
        this.rendering = false;
        if (this.pending) {
          this.pending = false;
          this.requestRender();
        }
      });
  }

  private draw(mode: ScopeMode, patch: SynthPatch, data: Rendered | null): void {
    const canvas = this.canvas().nativeElement;
    const dpr = window.devicePixelRatio || 1;
    const { width: w, height: h } = canvas.getBoundingClientRect();
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const css = getComputedStyle(this.host.nativeElement);
    const colors: Colors = {
      accent: css.getPropertyValue('--accent').trim(),
      line: css.getPropertyValue('--line').trim(),
      muted: css.getPropertyValue('--muted').trim(),
      text: css.getPropertyValue('--text').trim(),
      filter: css.getPropertyValue('--scope-filter').trim(),
    };
    g.font = '10px system-ui, sans-serif';

    if (mode === 'filter') this.drawFilter(g, w, h, patch, colors);
    else if (data?.mode === 'wave' && mode === 'wave') this.drawWave(g, w, h, data.samples, colors);
    else if (data?.mode === 'note' && mode === 'note') this.drawNote(g, w, h, data.samples, patch, colors);
  }

  private drawWave(g: CanvasRenderingContext2D, w: number, h: number, samples: Float32Array, c: Colors): void {
    const mid = h / 2;
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(w, mid);
    g.stroke();

    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    // Échelle fixe (sauf saturation) pour que le volume et le filtre restent visibles.
    const scale = (mid - 8) / Math.max(1, peak);
    const n = samples.length;

    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = mid - samples[i] * scale;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = c.accent;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.stroke();

    g.lineTo(w, mid);
    g.lineTo(0, mid);
    g.closePath();
    g.globalAlpha = 0.15;
    g.fillStyle = c.accent;
    g.fill();
    g.globalAlpha = 1;
  }

  private drawNote(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    samples: Float32Array,
    patch: SynthPatch,
    c: Colors,
  ): void {
    const mid = h / 2;
    const total = noteLength(patch);
    const hold = noteHold(patch);
    const columns = Math.floor(w);
    const step = samples.length / columns;

    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    const scale = (mid - 8) / Math.max(1, peak);

    // Signal réel (min/max par colonne de pixels)
    g.fillStyle = c.accent;
    g.globalAlpha = 0.55;
    for (let x = 0; x < columns; x++) {
      let min = 0;
      let max = 0;
      const end = Math.min(samples.length, Math.floor((x + 1) * step));
      for (let i = Math.floor(x * step); i < end; i++) {
        if (samples[i] < min) min = samples[i];
        if (samples[i] > max) max = samples[i];
      }
      g.fillRect(x, mid - max * scale, 1, Math.max(1, (max - min) * scale));
    }
    g.globalAlpha = 1;

    // Moment où la touche est relâchée
    const xRelease = (hold / total) * w;
    g.strokeStyle = c.muted;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(xRelease, 0);
    g.lineTo(xRelease, h);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = c.muted;
    g.fillText('relâché', xRelease + 4, h - 6);
    g.fillText(formatSeconds(total), w - 34, h - 6);

    // Enveloppe de volume théorique, calée sur l'amplitude réelle
    const outline = peak * scale;
    g.strokeStyle = c.text;
    g.globalAlpha = 0.8;
    g.lineWidth = 1.5;
    for (const sign of [1, -1]) {
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const v = envelopeAt(patch.ampEnv, (x / w) * total, hold, true);
        const y = mid - sign * v * outline;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // Enveloppe de filtre, pondérée par sa quantité
    const amount = patch.filter.envAmount;
    if (amount > 0.01) {
      g.strokeStyle = c.filter;
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const v = envelopeAt(patch.filterEnv, (x / w) * total, hold, false);
        const y = h - 4 - v * amount * (h - 16);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  private drawFilter(g: CanvasRenderingContext2D, w: number, h: number, patch: SynthPatch, c: Colors): void {
    const toY = (db: number) => ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * h;
    const toX = (hz: number) => (Math.log(hz / 20) / Math.log(1000)) * w;

    // Grille : décibels et fréquences
    g.lineWidth = 1;
    g.fillStyle = c.muted;
    for (const db of [12, 0, -24]) {
      g.strokeStyle = c.line;
      g.globalAlpha = db === 0 ? 1 : 0.5;
      g.beginPath();
      g.moveTo(0, toY(db));
      g.lineTo(w, toY(db));
      g.stroke();
      g.globalAlpha = 1;
      g.fillText(`${db > 0 ? '+' : ''}${db}dB`, 4, toY(db) - 3);
    }
    for (const [hz, label] of [[100, '100'], [1000, '1k'], [10000, '10k']] as const) {
      g.strokeStyle = c.line;
      g.globalAlpha = 0.5;
      g.beginPath();
      g.moveTo(toX(hz), 0);
      g.lineTo(toX(hz), h);
      g.stroke();
      g.globalAlpha = 1;
      g.fillText(label, toX(hz) + 3, h - 5);
    }

    const columns = Math.max(2, Math.floor(w));
    const freqs = new Float32Array(columns);
    for (let x = 0; x < columns; x++) freqs[x] = 20 * 1000 ** (x / (columns - 1));
    const response = (cutoff: number) => {
      this.filterCtx ??= new OfflineAudioContext(1, 128, 44100);
      const filter = this.filterCtx.createBiquadFilter();
      filter.type = patch.filter.type;
      filter.frequency.value = cutoff;
      filter.Q.value = patch.filter.resonance;
      const mag = new Float32Array(columns);
      filter.getFrequencyResponse(freqs, mag, new Float32Array(columns));
      return mag;
    };
    const plot = (mag: Float32Array) => {
      g.beginPath();
      for (let x = 0; x < columns; x++) {
        const y = toY(20 * Math.log10(Math.max(mag[x], 1e-6)));
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };

    const { base, peak } = filterCutoffRange(patch);
    if (patch.filter.envAmount > 0.01 && peak > base * 1.01) {
      plot(response(peak));
      g.strokeStyle = c.filter;
      g.lineWidth = 1.5;
      g.setLineDash([4, 3]);
      g.stroke();
      g.setLineDash([]);
    }

    plot(response(base));
    g.strokeStyle = c.accent;
    g.lineWidth = 2;
    g.stroke();
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.globalAlpha = 0.15;
    g.fillStyle = c.accent;
    g.fill();
    g.globalAlpha = 1;
  }
}
