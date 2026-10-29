import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AudioEngineService, Voice } from '../../core/audio-engine.service';
import { cutoffToHz, formatHz, formatSeconds } from '../../core/audio-utils';
import { KitService } from '../../core/kit.service';
import { BANKS, DECAY_HOLD, PADS_PER_BANK, PlaybackSettings, defaultPlaybackSettings, padLabel } from '../../core/models';
import { SampleLibraryService } from '../../core/sample-library.service';
import { describeError } from '../../core/http-errors';
import { KIT_GROUPS, KIT_PRESETS, KitPreset } from '../../core/presets/kit-presets';
import { Knob } from '../../shared/knob';

/** Ordre d'affichage façon MPC : pad 1 en bas à gauche, pad 16 en haut à droite. */
const LAYOUT = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

/** Touches physiques (indépendantes de la disposition AZERTY/QWERTY) pour jouer au clavier d'ordinateur. */
const KEY_CODES = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR',
  'KeyA', 'KeyS', 'KeyD', 'KeyF',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV',
];

@Component({
  selector: 'app-pads',
  imports: [Knob, RouterLink],
  templateUrl: './pads.html',
  styleUrl: './pads.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onKey($event, true)',
    '(window:keyup)': 'onKey($event, false)',
  },
})
export class PadsView {
  protected readonly kitService = inject(KitService);
  protected readonly library = inject(SampleLibraryService);
  private readonly engine = inject(AudioEngineService);

  protected readonly banks = BANKS;
  protected readonly decayHold = DECAY_HOLD;
  protected readonly defaults = defaultPlaybackSettings();
  protected readonly fullLevel = signal(true);
  protected readonly pickerOpen = signal(false);
  protected readonly kitsOpen = signal(false);
  protected readonly kitError = signal<string | null>(null);
  protected readonly kitGroups = KIT_GROUPS.map((group) => ({
    group,
    presets: KIT_PRESETS.filter((p) => p.group === group),
  }));
  protected readonly hits = signal<ReadonlySet<number>>(new Set());
  private readonly pointers = new Map<number, number>();
  private previewVoice?: Voice;

  protected readonly pads = computed(() => {
    const kit = this.kitService.kit();
    const byId = this.library.byId();
    const offset = this.kitService.bank() * PADS_PER_BANK;
    return LAYOUT.map((n) => {
      const index = offset + n;
      const pad = kit.pads[index];
      const sample = pad.sampleId ? byId.get(pad.sampleId) : undefined;
      return {
        index,
        label: padLabel(index),
        sample,
        // « Techno · Kick » → « Kick » : le style est déjà visible dans l'éditeur du pad.
        shortName: sample?.name.split(' · ').pop() ?? '',
      };
    });
  });

  protected readonly selected = computed(() => {
    const index = this.kitService.selected();
    const pad = this.kitService.kit().pads[index];
    return {
      index,
      label: padLabel(index),
      settings: pad.settings,
      sample: pad.sampleId ? this.library.byId().get(pad.sampleId) : undefined,
    };
  });

  protected readonly fmt = {
    percent: (v: number) => `${Math.round(v * 100)}`,
    pitch: (v: number) => (v > 0 ? `+${v}` : `${v}`),
    pan: (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
    cutoff: (v: number) => formatHz(cutoffToHz(v)),
    time: (v: number) => formatSeconds(v),
    decay: (v: number) => (v >= DECAY_HOLD ? '∞' : formatSeconds(v)),
  };

  protected set<K extends keyof PlaybackSettings>(key: K, value: PlaybackSettings[K]): void {
    this.kitService.setSetting(this.kitService.selected(), key, value);
  }

  protected padDown(e: PointerEvent, index: number): void {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    let velocity = 1;
    if (!this.fullLevel()) {
      // Sans « Full level », la vélocité dépend de la hauteur de frappe : plus fort en haut du pad.
      const rect = (e.currentTarget as Element).getBoundingClientRect();
      velocity = 0.25 + 0.75 * (1 - (e.clientY - rect.top) / rect.height);
    }
    this.pointers.set(e.pointerId, index);
    this.hit(index, velocity);
  }

  protected padUp(e: PointerEvent): void {
    const index = this.pointers.get(e.pointerId);
    if (index === undefined) return;
    this.pointers.delete(e.pointerId);
    this.unhit(index);
  }

  private hit(index: number, velocity: number): void {
    this.kitService.selected.set(index);
    this.kitService.trigger(index, velocity);
    this.hits.update((s) => new Set(s).add(index));
  }

  private unhit(index: number): void {
    this.kitService.release(index);
    this.hits.update((s) => {
      const next = new Set(s);
      next.delete(index);
      return next;
    });
  }

  protected onKey(e: KeyboardEvent, down: boolean): void {
    if (e.repeat || e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest('input, select, textarea')) return;
    const slot = KEY_CODES.indexOf(e.code);
    if (slot < 0) return;
    e.preventDefault();
    const index = this.kitService.bank() * PADS_PER_BANK + LAYOUT[slot];
    if (down) this.hit(index, 1);
    else this.unhit(index);
  }

  protected assign(sampleId: string | null): void {
    this.kitService.assign(this.kitService.selected(), sampleId);
    this.pickerOpen.set(false);
    this.previewVoice?.stop();
  }

  protected async loadKit(preset: KitPreset): Promise<void> {
    const bank = this.kitService.bank();
    const offset = bank * PADS_PER_BANK;
    const used = this.kitService.kit().pads.slice(offset, offset + PADS_PER_BANK).some((p) => p.sampleId);
    if (used && !confirm(`Remplacer les pads de la banque ${BANKS[bank]} par le kit ${preset.name} ?`)) return;
    this.kitError.set(null);
    try {
      await this.kitService.loadPreset(preset, bank);
      this.kitService.selected.set(offset);
      this.kitsOpen.set(false);
    } catch (err) {
      this.kitError.set(`Chargement impossible : ${describeError(err)}`);
    }
  }

  protected async preview(sampleId: string): Promise<void> {
    this.previewVoice?.stop();
    const buffer = await this.library.getBuffer(sampleId);
    this.previewVoice = this.engine.playBuffer(buffer, defaultPlaybackSettings());
  }
}
