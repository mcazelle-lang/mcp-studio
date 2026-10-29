import { startSynthVoice } from '../synth.service';
import { factoryPatch } from './synth-presets';

/** Recette d'un son de kit, fabriqué par synthèse au moment du chargement. */
export type SoundSpec =
  | { kind: 'kick'; f0: number; f1: number; pitchDecay: number; decay: number; click: number; drive: number }
  | { kind: 'snare'; tone: number; toneDecay: number; noiseDecay: number; noiseHP: number; snappy: number }
  | { kind: 'hat'; decay: number; cutoff: number }
  | { kind: 'clap'; decay: number }
  | { kind: 'rim' }
  | { kind: 'cowbell' }
  | { kind: 'tom'; freq: number; decay: number }
  | { kind: 'shaker'; decay: number }
  | { kind: 'crash'; decay: number }
  | { kind: 'zap'; f0: number; f1: number; decay: number }
  | { kind: 'riser'; duration: number }
  /** `strum` : décalage entre les notes d'un accord, en secondes (accord gratté). */
  | { kind: 'synth'; preset: string; notes: number[]; hold: number; strum?: number };

const RATE = 44100;
/** Fréquences « métalliques » de la TR-808, utilisées pour les cymbales. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

type Ctx = OfflineAudioContext;

function noise(c: Ctx, seconds: number): AudioBufferSourceNode {
  const buffer = c.createBuffer(1, Math.max(1, Math.ceil(c.sampleRate * seconds)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  return src;
}

/** Enveloppe attaque linéaire + décroissance exponentielle (≈ silence après `decay`). */
function envelope(c: Ctx, attack: number, decay: number, peak = 1, at = 0): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setTargetAtTime(0, at + attack, decay / 4);
  return g;
}

function filter(c: Ctx, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

function saturator(c: Ctx, drive: number): WaveShaperNode {
  const shaper = c.createWaveShaper();
  const k = 1 + drive * 20;
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  shaper.curve = curve;
  return shaper;
}

function metal(c: Ctx, out: AudioNode, length: number): void {
  const mix = c.createGain();
  mix.gain.value = 0.3;
  for (const f of METAL) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(mix);
    o.start(0);
    o.stop(length);
  }
  mix.connect(out);
}

function soundLength(spec: SoundSpec): number {
  switch (spec.kind) {
    case 'kick':
      return spec.decay * 1.3 + 0.05;
    case 'snare':
      return Math.max(spec.toneDecay, spec.noiseDecay) * 1.3 + 0.05;
    case 'hat':
    case 'shaker':
    case 'crash':
    case 'zap':
      return spec.decay * 1.4 + 0.05;
    case 'clap':
      return spec.decay * 1.3 + 0.08;
    case 'rim':
      return 0.12;
    case 'cowbell':
      return 0.5;
    case 'tom':
      return spec.decay * 1.3 + 0.05;
    case 'riser':
      return spec.duration + 0.06;
    case 'synth': {
      const patch = factoryPatch(spec.preset);
      const strum = (spec.strum ?? 0) * (spec.notes.length - 1);
      return strum + spec.hold + Math.max(patch.ampEnv.release, 0.01) + 0.05;
    }
  }
}

function build(c: Ctx, out: AudioNode, spec: SoundSpec, length: number): void {
  switch (spec.kind) {
    case 'kick': {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(spec.f0, 0);
      o.frequency.exponentialRampToValueAtTime(spec.f1, spec.pitchDecay);
      const body = envelope(c, 0.001, spec.decay);
      const chain = spec.drive > 0 ? o.connect(body).connect(saturator(c, spec.drive)) : o.connect(body);
      chain.connect(out);
      o.start(0);
      if (spec.click > 0) {
        const n = noise(c, 0.03);
        n.connect(filter(c, 'highpass', 3000)).connect(envelope(c, 0.0005, 0.015, spec.click)).connect(out);
        n.start(0);
      }
      return;
    }
    case 'snare': {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(spec.tone, 0);
      o.frequency.exponentialRampToValueAtTime(spec.tone * 0.8, spec.toneDecay);
      o.connect(envelope(c, 0.001, spec.toneDecay, 0.8)).connect(out);
      o.start(0);
      const n = noise(c, length);
      n.connect(filter(c, 'highpass', spec.noiseHP)).connect(envelope(c, 0.001, spec.noiseDecay, spec.snappy)).connect(out);
      n.start(0);
      return;
    }
    case 'hat': {
      const env = envelope(c, 0.001, spec.decay);
      const hp = filter(c, 'highpass', spec.cutoff);
      const band = filter(c, 'bandpass', 10000, 0.8);
      metal(c, band, length);
      band.connect(hp).connect(env).connect(out);
      const n = noise(c, length);
      const air = c.createGain();
      air.gain.value = 0.25;
      n.connect(air).connect(hp);
      n.start(0);
      return;
    }
    case 'clap': {
      const n = noise(c, length);
      const g = c.createGain();
      g.gain.setValueAtTime(0, 0);
      for (const t of [0, 0.011, 0.022]) {
        g.gain.setValueAtTime(1, t);
        g.gain.setTargetAtTime(0.05, t, 0.003);
      }
      g.gain.setValueAtTime(0.9, 0.033);
      g.gain.setTargetAtTime(0, 0.033, spec.decay / 4);
      n.connect(filter(c, 'bandpass', 1200, 1.2)).connect(g).connect(out);
      n.start(0);
      return;
    }
    case 'rim': {
      const hp = filter(c, 'highpass', 300);
      hp.connect(out);
      const click = c.createOscillator();
      click.type = 'triangle';
      click.frequency.value = 1700;
      click.connect(envelope(c, 0.0005, 0.03)).connect(hp);
      const body = c.createOscillator();
      body.type = 'square';
      body.frequency.value = 480;
      body.connect(envelope(c, 0.0005, 0.02, 0.4)).connect(hp);
      click.start(0);
      body.start(0);
      return;
    }
    case 'cowbell': {
      const band = filter(c, 'bandpass', 1000, 1);
      const env = c.createGain();
      env.gain.setValueAtTime(1, 0);
      env.gain.setTargetAtTime(0.25, 0, 0.015);
      env.gain.setTargetAtTime(0, 0.06, 0.08);
      band.connect(env).connect(out);
      for (const f of [540, 800]) {
        const o = c.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(band);
        o.start(0);
      }
      return;
    }
    case 'tom': {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(spec.freq * 1.5, 0);
      o.frequency.exponentialRampToValueAtTime(spec.freq, spec.decay * 0.5);
      o.connect(envelope(c, 0.002, spec.decay)).connect(out);
      o.start(0);
      const n = noise(c, 0.03);
      n.connect(filter(c, 'lowpass', 4000)).connect(envelope(c, 0.0005, 0.02, 0.15)).connect(out);
      n.start(0);
      return;
    }
    case 'shaker': {
      const n = noise(c, length);
      n.connect(filter(c, 'highpass', 5000)).connect(envelope(c, 0.015, spec.decay)).connect(out);
      n.start(0);
      return;
    }
    case 'crash': {
      const env = envelope(c, 0.002, spec.decay);
      const hp = filter(c, 'highpass', 4000);
      hp.connect(env).connect(out);
      const band = filter(c, 'bandpass', 8000, 0.5);
      band.connect(hp);
      metal(c, band, length);
      const n = noise(c, length);
      n.connect(hp);
      n.start(0);
      return;
    }
    case 'zap': {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(spec.f0, 0);
      o.frequency.exponentialRampToValueAtTime(spec.f1, spec.decay);
      o.connect(envelope(c, 0.001, spec.decay)).connect(out);
      o.start(0);
      return;
    }
    case 'riser': {
      const n = noise(c, length);
      const band = filter(c, 'bandpass', 300, 4);
      band.frequency.setValueAtTime(300, 0);
      band.frequency.exponentialRampToValueAtTime(8000, spec.duration);
      const g = c.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, spec.duration);
      g.gain.linearRampToValueAtTime(0, spec.duration + 0.05);
      n.connect(band).connect(g).connect(out);
      n.start(0);
      return;
    }
    case 'synth': {
      const patch = factoryPatch(spec.preset);
      spec.notes.forEach((midi, i) => {
        const at = i * (spec.strum ?? 0);
        startSynthVoice(c, out, patch, midi, 1, at).release(at + spec.hold);
      });
      return;
    }
  }
}

/** Normalise le son et coupe le silence de fin. */
function finalize(c: Ctx, rendered: AudioBuffer): AudioBuffer {
  const data = rendered.getChannelData(0);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return rendered;

  let end = data.length;
  while (end > 1 && Math.abs(data[end - 1]) < peak * 0.001) end--;
  const fade = Math.min(Math.floor(RATE * 0.005), end);
  const out = c.createBuffer(1, end, RATE);
  const dst = out.getChannelData(0);
  const gain = 0.95 / peak;
  for (let i = 0; i < end; i++) {
    const tail = i >= end - fade ? (end - 1 - i) / fade : 1;
    dst[i] = data[i] * gain * tail;
  }
  return out;
}

export async function renderSound(spec: SoundSpec): Promise<AudioBuffer> {
  const length = soundLength(spec);
  const c = new OfflineAudioContext(1, Math.ceil(length * RATE), RATE);
  const out = c.createGain();
  out.connect(c.destination);
  build(c, out, spec, length);
  return finalize(c, await c.startRendering());
}
