import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AudioEngineService, Voice } from './audio-engine.service';
import { SampleLibraryService } from './sample-library.service';
import { BANKS, Kit, PADS_PER_BANK, Pad, PlaybackSettings, defaultPlaybackSettings } from './models';
import { encodeWav } from './audio-utils';
import { MetronomeService } from './metronome.service';
import { KitPreset } from './presets/kit-presets';
import { renderSound } from './presets/sound-design';

const API = '/api/kit';
const SAVE_DELAY_MS = 600;

function defaultKit(): Kit {
  return {
    name: 'Kit 1',
    master: 0.8,
    pads: Array.from({ length: BANKS.length * PADS_PER_BANK }, () => ({
      sampleId: null,
      settings: defaultPlaybackSettings(),
    })),
  };
}

/** État des 64 pads (4 banques × 16), de leurs réglages et du volume master. */
@Injectable({ providedIn: 'root' })
export class KitService {
  private readonly http = inject(HttpClient);
  private readonly engine = inject(AudioEngineService);
  private readonly library = inject(SampleLibraryService);
  private readonly metronome = inject(MetronomeService);
  private readonly ready = new Map<string, AudioBuffer>();
  private readonly gateVoices = new Map<number, Voice>();
  private saveTimer?: ReturnType<typeof setTimeout>;

  readonly kit = signal<Kit>(defaultKit());
  readonly bank = signal(0);
  readonly selected = signal(0);
  readonly selectedPad = computed(() => this.kit().pads[this.selected()]);
  /** Progression du chargement d'un kit preset (null quand rien n'est en cours). */
  readonly loadingPreset = signal<{ name: string; done: number; total: number } | null>(null);

  constructor() {
    void this.load();
    // Sur mobile l'app peut être fermée à tout moment : on envoie la sauvegarde en attente sans délai.
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.flush());
  }

  private flush(): void {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    void fetch(API, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.kit()),
    });
  }

  private async load(): Promise<void> {
    const saved = await firstValueFrom(this.http.get<Kit | null>(API)).catch(() => null);
    if (saved?.pads?.length) {
      const base = defaultKit();
      saved.pads.forEach((pad, i) => {
        if (i < base.pads.length) base.pads[i] = { sampleId: pad.sampleId, settings: { ...base.pads[i].settings, ...pad.settings } };
      });
      this.kit.set({ ...base, name: saved.name ?? base.name, master: saved.master ?? base.master });
    }
    this.engine.setMasterVolume(this.kit().master);
    // Pré-décode les samples affectés pour une latence minimale au premier coup.
    this.kit().pads.forEach((pad) => pad.sampleId && this.preload(pad.sampleId));
  }

  private preload(sampleId: string): Promise<AudioBuffer> {
    return this.library.getBuffer(sampleId).then((buffer) => {
      this.ready.set(sampleId, buffer);
      return buffer;
    });
  }

  private update(mutator: (kit: Kit) => Kit): void {
    this.kit.update(mutator);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void firstValueFrom(this.http.put(API, this.kit())).catch((err) => console.error('Sauvegarde du kit impossible', err));
    }, SAVE_DELAY_MS);
  }

  private updatePad(index: number, mutator: (pad: Pad) => Pad): void {
    this.update((kit) => ({ ...kit, pads: kit.pads.map((p, i) => (i === index ? mutator(p) : p)) }));
  }

  setMaster(volume: number): void {
    this.engine.setMasterVolume(volume);
    this.update((kit) => ({ ...kit, master: volume }));
  }

  setSetting<K extends keyof PlaybackSettings>(index: number, key: K, value: PlaybackSettings[K]): void {
    this.updatePad(index, (pad) => ({ ...pad, settings: { ...pad.settings, [key]: value } }));
  }

  resetSettings(index: number): void {
    this.updatePad(index, (pad) => ({ ...pad, settings: defaultPlaybackSettings() }));
  }

  assign(index: number, sampleId: string | null): void {
    this.updatePad(index, (pad) => ({ ...pad, sampleId }));
    if (sampleId) void this.preload(sampleId);
  }

  /** Retire un sample supprimé de tous les pads (le serveur fait de même de son côté). */
  unassignSample(sampleId: string): void {
    if (this.kit().pads.some((p) => p.sampleId === sampleId)) {
      this.update((kit) => ({
        ...kit,
        pads: kit.pads.map((p) => (p.sampleId === sampleId ? { ...p, sampleId: null } : p)),
      }));
    }
  }

  /**
   * Charge un kit preset sur une banque : les sons sont fabriqués par synthèse,
   * enregistrés dans la bibliothèque (réutilisés s'ils existent déjà), puis affectés aux 16 pads.
   */
  async loadPreset(preset: KitPreset, bank = this.bank()): Promise<void> {
    this.loadingPreset.set({ name: preset.name, done: 0, total: preset.pads.length });
    try {
      const ids: string[] = [];
      for (const pad of preset.pads) {
        const name = `${preset.name} · ${pad.name}`;
        const existing = this.library.samples().find((s) => s.source === 'preset' && s.name === name);
        if (existing) {
          ids.push(existing.id);
        } else {
          const buffer = await renderSound(pad.sound);
          const sample = await this.library.upload(encodeWav(buffer), {
            name,
            source: 'preset',
            duration: buffer.duration,
            filename: `${preset.key}-${ids.length + 1}.wav`,
            buffer,
          });
          ids.push(sample.id);
        }
        this.loadingPreset.update((s) => s && { ...s, done: s.done + 1 });
      }

      const offset = bank * PADS_PER_BANK;
      this.update((kit) => ({
        ...kit,
        pads: kit.pads.map((pad, i) => {
          const slot = i - offset;
          if (slot < 0 || slot >= PADS_PER_BANK) return pad;
          const presetPad = preset.pads[slot];
          return {
            sampleId: presetPad ? ids[slot] : null,
            settings: { ...defaultPlaybackSettings(), ...presetPad?.settings },
          };
        }),
      }));
      ids.forEach((id) => void this.preload(id));
      this.metronome.setBpm(preset.bpm);
    } finally {
      this.loadingPreset.set(null);
    }
  }

  trigger(index: number, velocity = 1): void {
    const pad = this.kit().pads[index];
    if (!pad?.sampleId) return;
    const play = (buffer: AudioBuffer) => {
      const voice = this.engine.playBuffer(buffer, pad.settings, velocity);
      if (pad.settings.mode === 'gate') {
        this.gateVoices.get(index)?.stop();
        this.gateVoices.set(index, voice);
      }
    };
    const buffer = this.ready.get(pad.sampleId);
    if (buffer) play(buffer);
    else void this.preload(pad.sampleId).then(play);
  }

  release(index: number): void {
    const voice = this.gateVoices.get(index);
    if (voice) {
      voice.stop(0.04);
      this.gateVoices.delete(index);
    }
  }
}
