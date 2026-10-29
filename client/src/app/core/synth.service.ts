import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AudioEngineService, Voice } from './audio-engine.service';
import { cutoffToHz, midiToFreq } from './audio-utils';
import { Envelope, SynthPatch, SynthPreset, defaultPatch } from './models';

const STORAGE_KEY = 'mpc.synth.patch';

export interface SynthVoice {
  /** Déclenche la phase de release à l'instant `when` et renvoie l'instant où le son est éteint. */
  release(when: number): number;
  /** Coupe immédiatement. */
  kill(): void;
}

/** Valeur d'une enveloppe ADSR `elapsed` secondes après le début (décroissance exponentielle comme setTargetAtTime). */
export function envelopeValue(env: Envelope, elapsed: number, peak: number, floor: number): number {
  const sustain = floor + (peak - floor) * env.sustain;
  if (elapsed < env.attack) return floor + (peak - floor) * (elapsed / Math.max(env.attack, 1e-4));
  return sustain + (peak - sustain) * Math.exp(-(elapsed - env.attack) / Math.max(env.decay / 4, 1e-4));
}

/** Fréquence de coupure au repos et au sommet de l'enveloppe de filtre. */
export function filterCutoffRange(patch: SynthPatch): { base: number; peak: number } {
  const base = cutoffToHz(patch.filter.cutoff);
  return { base, peak: Math.min(20000, base * 2 ** (patch.filter.envAmount * 7)) };
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Une seconde de bruit blanc, créée une fois par contexte audio puis partagée par toutes les notes. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

const driveCurves = new Map<number, Float32Array<ArrayBuffer>>();

/** Courbe de saturation douce (tanh), mise en cache par niveau. */
function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 100);
  let curve = driveCurves.get(key);
  if (!curve) {
    const k = 1 + (key / 100) * 12;
    curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    driveCurves.set(key, curve);
  }
  return curve;
}

function scheduleEnvelope(param: AudioParam, env: Envelope, t: number, peak: number, floor: number): void {
  const sustain = floor + (peak - floor) * env.sustain;
  param.cancelScheduledValues(t);
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + Math.max(env.attack, 0.002));
  param.setTargetAtTime(sustain, t + Math.max(env.attack, 0.002), Math.max(env.decay / 4, 1e-4));
}

/**
 * Construit une voix de synthé soustractif dans n'importe quel contexte audio
 * (temps réel pour jouer, OfflineAudioContext pour fabriquer un sample).
 */
export function startSynthVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  patch: SynthPatch,
  midi: number,
  velocity: number,
  t: number,
): SynthVoice {
  const freq = midiToFreq(midi);
  const sources: AudioScheduledSourceNode[] = [];
  /** Tous les nœuds de la voix, débranchés quand elle se termine (sinon ils ne sont jamais libérés). */
  const nodes: AudioNode[] = [];
  const track = <T extends AudioNode>(node: T): T => (nodes.push(node), node);

  const mix = track(ctx.createGain());
  for (const osc of [patch.osc1, patch.osc2]) {
    if (osc.level <= 0) continue;
    const node = track(ctx.createOscillator());
    node.type = osc.wave;
    node.frequency.value = freq * 2 ** osc.octave;
    node.detune.value = osc.detune;
    const gain = track(ctx.createGain());
    gain.gain.value = osc.level * 0.5;
    node.connect(gain).connect(mix);
    sources.push(node);
  }
  if (patch.noise > 0) {
    const noise = track(ctx.createBufferSource());
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const gain = track(ctx.createGain());
    gain.gain.value = patch.noise * 0.4;
    noise.connect(gain).connect(mix);
    sources.push(noise);
  }

  const filter = track(ctx.createBiquadFilter());
  filter.type = patch.filter.type;
  filter.Q.value = patch.filter.resonance;
  const { base: baseCutoff, peak: peakCutoff } = filterCutoffRange(patch);
  scheduleEnvelope(filter.frequency, patch.filterEnv, t, peakCutoff, baseCutoff);

  const amp = track(ctx.createGain());
  scheduleEnvelope(amp.gain, patch.ampEnv, t, 1, 0);

  const tremolo = track(ctx.createGain());
  const out = track(ctx.createGain());
  out.gain.value = patch.volume * velocity;
  let filtered: AudioNode = mix.connect(filter);
  const drive = patch.drive ?? 0;
  if (drive > 0) {
    const shaper = track(ctx.createWaveShaper());
    shaper.curve = driveCurve(drive);
    shaper.oversample = '2x';
    // La saturation fait monter le niveau : on compense pour garder un volume comparable.
    const makeup = track(ctx.createGain());
    makeup.gain.value = 1 / (1 + drive);
    filtered = filtered.connect(shaper).connect(makeup);
  }
  filtered.connect(amp).connect(tremolo).connect(out).connect(destination);

  if (patch.lfo.depth > 0) {
    const lfo = track(ctx.createOscillator());
    lfo.type = patch.lfo.wave;
    lfo.frequency.value = patch.lfo.rate;
    const depth = track(ctx.createGain());
    lfo.connect(depth);
    if (patch.lfo.target === 'pitch') {
      depth.gain.value = patch.lfo.depth * 100;
      sources.forEach((s) => s instanceof OscillatorNode && depth.connect(s.detune));
    } else if (patch.lfo.target === 'filter') {
      depth.gain.value = patch.lfo.depth * 2400;
      depth.connect(filter.detune);
    } else {
      depth.gain.value = patch.lfo.depth / 2;
      tremolo.gain.value = 1 - patch.lfo.depth / 2;
      depth.connect(tremolo.gain);
    }
    sources.push(lfo);
  }

  sources.forEach((s) => s.start(t));

  let end = Infinity;
  const stopAll = (when: number) => {
    end = when;
    sources.forEach((s) => {
      try {
        s.stop(when);
      } catch {
        /* déjà arrêtée */
      }
    });
  };
  // Toutes les sources s'arrêtent au même instant : la fin de la première suffit.
  sources[0]?.addEventListener('ended', () => nodes.forEach((n) => n.disconnect()));

  return {
    release(when: number): number {
      if (end !== Infinity) return end;
      const elapsed = when - t;
      const release = Math.max(patch.ampEnv.release, 0.01);
      amp.gain.cancelScheduledValues(when);
      amp.gain.setValueAtTime(envelopeValue(patch.ampEnv, elapsed, 1, 0), when);
      amp.gain.linearRampToValueAtTime(0, when + release);
      filter.frequency.cancelScheduledValues(when);
      filter.frequency.setValueAtTime(envelopeValue(patch.filterEnv, elapsed, peakCutoff, baseCutoff), when);
      filter.frequency.setTargetAtTime(baseCutoff, when, Math.max(patch.filterEnv.release / 4, 1e-4));
      stopAll(when + release + 0.02);
      return end;
    },
    /** Coupe très vite mais en fondu (un arrêt net produit un clic). */
    kill() {
      if (end !== Infinity && end <= ctx.currentTime) return;
      const now = ctx.currentTime;
      const gain = amp.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
      else gain.cancelScheduledValues(now);
      gain.setTargetAtTime(0, now, 0.005);
      stopAll(now + 0.04);
    },
  };
}

@Injectable({ providedIn: 'root' })
export class SynthService {
  private readonly http = inject(HttpClient);
  private readonly engine = inject(AudioEngineService);
  private readonly active = new Map<number, { synth: SynthVoice; voice: Voice }>();

  readonly patch = signal<SynthPatch>(this.restore());
  readonly presets = signal<SynthPreset[]>([]);

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.patch()));
      } catch {
        /* stockage indisponible (navigation privée) */
      }
    });
    void firstValueFrom(this.http.get<SynthPreset[]>('/api/presets'))
      .then((p) => this.presets.set(p))
      .catch(() => {});
  }

  private restore(): SynthPatch {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...defaultPatch(), ...JSON.parse(saved) };
    } catch {
      /* ignore */
    }
    return defaultPatch();
  }

  /** Joue une note avec le patch courant, ou avec `patch` (instrument du clavier) sans modifier le patch courant. */
  noteOn(midi: number, velocity = 1, patch: SynthPatch = this.patch()): void {
    this.noteOff(midi);
    const ctx = this.engine.ctx;
    const synth = startSynthVoice(ctx, this.engine.input, patch, midi, velocity, ctx.currentTime);
    const voice: Voice = { stop: () => synth.kill() };
    this.engine.track(voice);
    this.active.set(midi, { synth, voice });
  }

  noteOff(midi: number): void {
    const entry = this.active.get(midi);
    if (!entry) return;
    this.active.delete(midi);
    const end = entry.synth.release(this.engine.ctx.currentTime);
    setTimeout(() => this.engine.forget(entry.voice), (end - this.engine.ctx.currentTime) * 1000 + 50);
  }

  allNotesOff(): void {
    [...this.active.keys()].forEach((m) => this.noteOff(m));
  }

  /** Fabrique un sample à partir du patch courant : note tenue `hold` secondes puis release. */
  async render(midi: number, hold: number): Promise<AudioBuffer> {
    const patch = this.patch();
    const rate = this.engine.ctx.sampleRate;
    const length = hold + Math.max(patch.ampEnv.release, 0.01) + 0.1;
    const offline = new OfflineAudioContext(2, Math.ceil(rate * length), rate);
    startSynthVoice(offline, offline.destination, patch, midi, 1, 0).release(hold);
    return offline.startRendering();
  }

  async savePreset(name: string): Promise<void> {
    const preset = await firstValueFrom(this.http.post<SynthPreset>('/api/presets', { name, patch: this.patch() }));
    this.presets.update((list) => [...list, preset]);
  }

  async deletePreset(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/presets/${id}`));
    this.presets.update((list) => list.filter((p) => p.id !== id));
  }
}
