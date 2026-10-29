import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cutoffToHz, encodeWav, formatHz, formatSeconds, noteName } from '../../core/audio-utils';
import { describeError } from '../../core/http-errors';
import { KitService } from '../../core/kit.service';
import { Envelope, OscSettings, SynthPatch, defaultPatch, padLabel } from '../../core/models';
import { SampleLibraryService } from '../../core/sample-library.service';
import { SynthService } from '../../core/synth.service';
import { Knob } from '../../shared/knob';
import { OCTAVE_KEY_CODES, PIANO_KEY_CODES, Piano, isPlayableKeyEvent } from '../../shared/piano';
import { FACTORY_BY_FAMILY, factoryPatch } from '../../core/presets/synth-presets';
import { ScopeMode, SynthScope } from './synth-scope';

type Section = 'osc1' | 'osc2' | 'filter' | 'ampEnv' | 'filterEnv' | 'lfo';

/** Vue du graphique la plus parlante pour chaque groupe de réglages. */
const SCOPE_FOR: Record<Section | 'noise' | 'volume' | 'drive', ScopeMode> = {
  drive: 'wave',
  osc1: 'wave',
  osc2: 'wave',
  noise: 'wave',
  volume: 'wave',
  filter: 'filter',
  ampEnv: 'note',
  filterEnv: 'note',
  lfo: 'note',
};

@Component({
  selector: 'app-synth',
  imports: [Knob, Piano, SynthScope, RouterLink],
  templateUrl: './synth.html',
  styleUrl: './synth.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onKey($event, true)',
    '(window:keyup)': 'onKey($event, false)',
    // Une touche relâchée hors de la fenêtre ne déclenche pas de keyup : on coupe tout.
    '(window:blur)': 'releaseKeys()',
  },
})
export class SynthView {
  protected readonly synth = inject(SynthService);
  private readonly library = inject(SampleLibraryService);
  private readonly kit = inject(KitService);

  protected readonly patch = this.synth.patch;
  protected readonly waves: { value: OscillatorType; label: string }[] = [
    { value: 'sine', label: 'SIN' },
    { value: 'triangle', label: 'TRI' },
    { value: 'sawtooth', label: 'SAW' },
    { value: 'square', label: 'SQR' },
  ];
  protected readonly filterTypes = [
    { value: 'lowpass', label: 'LP' },
    { value: 'bandpass', label: 'BP' },
    { value: 'highpass', label: 'HP' },
  ] as const;
  protected readonly lfoTargets = [
    { value: 'pitch', label: 'Pitch' },
    { value: 'filter', label: 'Filtre' },
    { value: 'amp', label: 'Volume' },
  ] as const;
  protected readonly envelopes = [
    { key: 'ampEnv', title: 'Enveloppe volume' },
    { key: 'filterEnv', title: 'Enveloppe filtre' },
  ] as const;
  protected readonly oscillators = [
    { key: 'osc1', title: 'Oscillateur 1' },
    { key: 'osc2', title: 'Oscillateur 2' },
  ] as const;

  protected readonly scopeFocus = signal<ScopeMode>('wave');
  protected readonly currentPreset = signal('');
  protected readonly factoryGroups = FACTORY_BY_FAMILY;
  protected readonly octave = signal(4);
  protected readonly keysDown = signal<ReadonlySet<number>>(new Set());
  protected readonly renderNote = signal(60);
  protected readonly renderHold = signal(0.6);
  protected readonly renderName = signal('Synth');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly selectedLabel = computed(() => padLabel(this.kit.selected()));

  protected readonly fmt = {
    percent: (v: number) => `${Math.round(v * 100)}`,
    signed: (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`),
    cutoff: (v: number) => formatHz(cutoffToHz(v)),
    time: (v: number) => formatSeconds(v),
    hz: (v: number) => `${v.toFixed(1)}Hz`,
    q: (v: number) => v.toFixed(1),
    note: (v: number) => noteName(v),
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.synth.allNotesOff());
  }

  protected update<K extends Section>(section: K, changes: Partial<SynthPatch[K]>): void {
    this.patch.update((p) => ({ ...p, [section]: { ...p[section], ...changes } }));
    this.scopeFocus.set(SCOPE_FOR[section]);
  }

  protected setGlobal(key: 'noise' | 'volume' | 'drive', value: number): void {
    this.patch.update((p) => ({ ...p, [key]: value }));
    this.scopeFocus.set(SCOPE_FOR[key]);
  }

  protected setOsc(key: 'osc1' | 'osc2', field: keyof OscSettings, value: OscSettings[keyof OscSettings]): void {
    this.update(key, { [field]: value });
  }

  protected setEnv(key: 'ampEnv' | 'filterEnv', field: keyof Envelope, value: number): void {
    this.update(key, { [field]: value });
  }

  protected initPatch(): void {
    this.patch.set(defaultPatch());
    this.currentPreset.set('');
  }

  /** `value` vaut « factory:<clé> » (preset d'usine) ou « user:<id> » (preset sauvegardé). */
  protected loadPreset(value: string): void {
    const [kind, id] = value.split(':');
    if (kind === 'factory') {
      this.patch.set(structuredClone(factoryPatch(id)));
    } else if (kind === 'user') {
      const preset = this.synth.presets().find((p) => p.id === id);
      if (!preset) return;
      this.patch.set({ ...defaultPatch(), ...preset.patch });
    } else {
      return;
    }
    this.currentPreset.set(value);
  }

  protected async savePreset(): Promise<void> {
    const name = prompt('Nom du preset ?', 'Mon son');
    if (!name) return;
    try {
      await this.synth.savePreset(name);
      this.message.set(`Preset « ${name} » sauvegardé.`);
    } catch {
      this.message.set('Sauvegarde du preset impossible.');
    }
  }

  protected shiftOctave(delta: number): void {
    this.releaseKeys();
    this.octave.update((o) => Math.min(7, Math.max(1, o + delta)));
  }

  protected releaseKeys(): void {
    this.keysDown.set(new Set());
    this.synth.allNotesOff();
  }

  protected onKey(e: KeyboardEvent, down: boolean): void {
    if (!isPlayableKeyEvent(e)) return;
    if (down && OCTAVE_KEY_CODES[e.code]) {
      e.preventDefault();
      return this.shiftOctave(OCTAVE_KEY_CODES[e.code]);
    }
    const offset = PIANO_KEY_CODES[e.code];
    if (offset === undefined) return;
    e.preventDefault();
    const midi = (this.octave() + 1) * 12 + offset;
    const keys = new Set(this.keysDown());
    if (down) {
      keys.add(midi);
      this.synth.noteOn(midi);
    } else {
      keys.delete(midi);
      this.synth.noteOff(midi);
    }
    this.keysDown.set(keys);
  }

  /** Fige le son courant en sample (WAV) et l'ajoute à la bibliothèque. */
  protected async createSample(assign: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const buffer = await this.synth.render(this.renderNote(), this.renderHold());
      const name = `${this.renderName().trim() || 'Synth'} ${noteName(this.renderNote())}`;
      const sample = await this.library.upload(encodeWav(buffer), {
        name,
        source: 'synth',
        duration: buffer.duration,
        filename: `${name}.wav`,
        buffer,
      });
      if (assign) this.kit.assign(this.kit.selected(), sample.id);
      this.message.set(assign ? `« ${name} » créé sur le pad ${this.selectedLabel()}.` : `« ${name} » ajouté à la bibliothèque.`);
    } catch (err) {
      this.message.set(`Création impossible : ${describeError(err)}`);
    } finally {
      this.busy.set(false);
    }
  }
}
