import { cutoffToHz } from '../../core/audio-utils';
import { DECAY_HOLD, Envelope } from '../../core/models';

/** Petite illustration vectorielle (viewBox 200 × 64). */
export interface Figure {
  paths: { d: string; style: 'main' | 'ghost' | 'fill' | 'soft' }[];
  /** Zones grisées, en x (0..200). */
  shades?: [number, number][];
  labels?: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }[];
}

export const W = 200;
export const H = 64;
const MID = H / 2;
const AMP = 26;
const BASE = H - 6;

type Shape = 'sine' | 'triangle' | 'sawtooth' | 'square';
export const SHAPES: Shape[] = ['sine', 'triangle', 'sawtooth', 'square'];

function osc(shape: Shape, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'triangle':
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    case 'sawtooth':
      return 2 * p - 1;
    case 'square':
      return p < 0.5 ? 1 : -1;
  }
}

/** Bruit pseudo-aléatoire déterministe (même dessin à chaque rendu). */
function rand(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function path(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
}

/** Trace y = fn(t) pour t ∈ [0, 1] sur toute la largeur, centré verticalement. */
function signal(fn: (t: number, i: number) => number, from = 0, to = 1, n = 240): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    pts.push([t * W, MID - Math.max(-1.15, Math.min(1.15, fn(t, i))) * AMP]);
  }
  return path(pts);
}

/** Trace une enveloppe (0..1) posée sur la ligne de base, et sa surface. */
function envelopeShape(fn: (t: number) => number, from = 0, to = 1, n = 160): { line: string; area: string } {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    pts.push([t * W, BASE - Math.max(0, Math.min(1, fn(t))) * (BASE - 6)]);
  }
  const line = path(pts);
  return { line, area: `${line}L${(to * W).toFixed(1)} ${BASE}L${(from * W).toFixed(1)} ${BASE}Z` };
}

const baseline = (): Figure['paths'][number] => ({ d: `M0 ${BASE}L${W} ${BASE}`, style: 'ghost' });

/** Sample de démonstration : son percussif qui décroît. */
function sampleWave(t: number, i: number): number {
  return Math.exp(-t * 3.5) * (0.65 * Math.sin(2 * Math.PI * 18 * t) + 0.35 * rand(i));
}

// ---------- Figures communes ----------

export function levelFigure(v: number): Figure {
  return {
    paths: [
      { d: signal((t) => Math.sin(2 * Math.PI * 4 * t)), style: 'ghost' },
      { d: signal((t) => v * Math.sin(2 * Math.PI * 4 * t)), style: 'main' },
    ],
  };
}

/** Tune d'un sample : hauteur et durée sont liées (lecture plus rapide = plus aigu et plus court). */
export function samplePitchFigure(semitones: number): Figure {
  const rate = 2 ** (semitones / 12);
  const base = 0.55;
  const length = Math.min(1, base / rate);
  const wave = (len: number) => (t: number) => (t > len ? 0 : Math.exp((-3 * t) / len) * Math.sin((2 * Math.PI * 7 * t) / len));
  return {
    paths: [
      { d: signal(wave(base)), style: 'ghost' },
      { d: signal(wave(length), 0, 1, 400), style: 'main' },
    ],
    labels: semitones === 0 ? [] : [{ x: W - 4, y: 10, text: rate > 1 ? 'plus aigu, plus court' : 'plus grave, plus long', anchor: 'end' }],
  };
}

/** Transposition d'un oscillateur : seule la fréquence change. */
export function oscPitchFigure(octaves: number): Figure {
  const cycles = 3 * 2 ** octaves;
  return {
    paths: [
      { d: signal((t) => Math.sin(2 * Math.PI * 3 * t)), style: 'ghost' },
      { d: signal((t) => Math.sin(2 * Math.PI * cycles * t), 0, 1, 480), style: 'main' },
    ],
  };
}

export function panFigure(v: number): Figure {
  const angle = ((v + 1) * Math.PI) / 4;
  const left = Math.cos(angle);
  const right = Math.sin(angle);
  const bar = (x: number, h: number) => `M${x} ${BASE}L${x} ${BASE - h * 48}L${x + 50} ${BASE - h * 48}L${x + 50} ${BASE}Z`;
  return {
    paths: [baseline(), { d: bar(35, left), style: 'fill' }, { d: bar(115, right), style: 'fill' }],
    labels: [
      { x: 60, y: H - 0.5, text: 'Gauche', anchor: 'middle' },
      { x: 140, y: H - 0.5, text: 'Droite', anchor: 'middle' },
    ],
  };
}

/** Réponse en fréquence d'un filtre 2 pôles (approximation analytique du BiquadFilter). */
export function filterFigure(cutoff: number, q: number, type: 'lowpass' | 'bandpass' | 'highpass' = 'lowpass'): Figure {
  const fc = cutoffToHz(cutoff);
  const response = (t: number) => {
    const f = 20 * 1000 ** t;
    const r = f / fc;
    const den = Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
    const mag = type === 'lowpass' ? 1 / den : type === 'highpass' ? (r * r) / den : r / q / den;
    const db = 20 * Math.log10(Math.max(mag, 1e-4));
    // +18 dB en haut, −42 dB en bas
    return Math.max(0, Math.min(1, (db + 42) / 60));
  };
  const shape = envelopeShape(response, 0, 1, 200);
  const zeroDb = BASE - (42 / 60) * (BASE - 6);
  return {
    paths: [
      { d: `M0 ${zeroDb.toFixed(1)}L${W} ${zeroDb.toFixed(1)}`, style: 'ghost' },
      { d: shape.area, style: 'soft' },
      { d: shape.line, style: 'main' },
    ],
    labels: [
      { x: 2, y: H - 0.5, text: 'graves' },
      { x: W - 2, y: H - 0.5, text: 'aigus', anchor: 'end' },
    ],
  };
}

// ---------- Pads ----------

const SAMPLE_SECONDS = 1.5;

export function attackFigure(attack: number): Figure {
  const total = 1.6;
  const env = (t: number) => {
    const s = t * total;
    if (s > SAMPLE_SECONDS) return 0;
    return attack < 0.002 ? 1 : Math.min(1, s / attack);
  };
  const shape = envelopeShape(env);
  return { paths: [baseline(), { d: shape.area, style: 'soft' }, { d: shape.line, style: 'main' }] };
}

export function padDecayFigure(decay: number): Figure {
  const total = 2;
  const env = (t: number) => {
    const s = t * total;
    if (s > SAMPLE_SECONDS) return 0;
    return decay >= DECAY_HOLD ? 1 : Math.exp(-s / (decay / 4));
  };
  const shape = envelopeShape(env);
  return {
    paths: [baseline(), { d: shape.area, style: 'soft' }, { d: shape.line, style: 'main' }],
    labels: decay >= DECAY_HOLD ? [{ x: W - 4, y: 10, text: 'sample entier', anchor: 'end' }] : [],
  };
}

export function startFigure(start: number): Figure {
  return {
    paths: [
      { d: signal(sampleWave, 0, start, Math.max(2, Math.round(300 * start))), style: 'ghost' },
      { d: signal((t, i) => sampleWave(t, i + Math.round(300 * start)), start, 1, Math.max(2, Math.round(300 * (1 - start)))), style: 'main' },
    ],
    shades: start > 0 ? [[0, start * W]] : [],
    labels: start > 0.12 ? [{ x: (start * W) / 2, y: 10, text: 'ignoré', anchor: 'middle' }] : [],
  };
}

export function reverbFigure(amount: number): Figure {
  const dry = (t: number, i: number) => (t < 0.25 ? Math.exp(-t * 18) * (0.7 * Math.sin(2 * Math.PI * 22 * t) + 0.3 * rand(i)) : 0);
  const tail = (t: number, i: number) => (t < 0.03 ? 0 : amount * 0.75 * Math.exp(-(t - 0.03) * 2.2) * rand(i * 7));
  return {
    paths: [
      { d: signal(tail, 0, 1, 360), style: 'soft' },
      { d: signal(dry, 0, 1, 360), style: 'main' },
    ],
    labels: amount > 0.05 ? [{ x: W - 4, y: 10, text: 'queue de réverbe', anchor: 'end' }] : [],
  };
}

/** Appui de 0 à 35 % de la largeur : one-shot continue, gate (ou relâchement) coupe. */
export function gateFigure(cut: boolean, release = 0.04): Figure {
  const total = 2;
  const pressed = 0.35;
  const natural = (s: number) => (s > SAMPLE_SECONDS ? 0 : Math.exp(-s * 1.6));
  const env = (t: number) => {
    const s = t * total;
    if (!cut || t <= pressed) return natural(s);
    const r = s - pressed * total;
    return Math.max(0, natural(pressed * total) * (1 - r / Math.max(release, 0.01)));
  };
  const shape = envelopeShape(env, 0, 1, 240);
  return {
    paths: [
      baseline(),
      { d: envelopeShape((t) => natural(t * total)).line, style: 'ghost' },
      { d: shape.area, style: 'soft' },
      { d: shape.line, style: 'main' },
    ],
    shades: [[0, pressed * W]],
    labels: [{ x: (pressed * W) / 2, y: 10, text: 'appui', anchor: 'middle' }],
  };
}

export function reverseFigure(on: boolean): Figure {
  const fn = (t: number, i: number) => (on ? sampleWave(1 - t, 300 - i) : sampleWave(t, i));
  return { paths: [{ d: signal(fn, 0, 1, 300), style: 'main' }] };
}

export function velocityFigure(fullLevel: boolean): Figure {
  const levels = fullLevel ? [1, 1, 1, 1] : [1, 0.75, 0.5, 0.25];
  const paths: Figure['paths'] = [baseline()];
  levels.forEach((l, i) => {
    const x = 20 + i * 45;
    paths.push({ d: `M${x} ${BASE}L${x} ${BASE - l * 48}L${x + 28} ${BASE - l * 48}L${x + 28} ${BASE}Z`, style: 'fill' });
  });
  return {
    paths,
    labels: fullLevel
      ? [{ x: W / 2, y: 8, text: 'toujours au maximum', anchor: 'middle' }]
      : [
          { x: 34, y: 8, text: 'haut', anchor: 'middle' },
          { x: 169, y: 8, text: 'bas du pad', anchor: 'middle' },
        ],
  };
}

// ---------- Synthé ----------

export function waveShapeFigure(index: number): Figure {
  const shape = SHAPES[index];
  return { paths: [{ d: signal((t) => osc(shape, 2 * t) * 0.9, 0, 1, 400), style: 'main' }] };
}

export function detuneFigure(cents: number): Figure {
  // Deux oscillateurs désaccordés « battent » : le volume ondule (effet exagéré pour être visible).
  const spread = (Math.abs(cents) / 50) * 0.15;
  const f = 20;
  const fn = (t: number) => 0.5 * (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * (1 + spread) * t + 0.3));
  return { paths: [{ d: signal(fn, 0, 1, 600), style: 'main' }] };
}

export function noiseFigure(amount: number): Figure {
  return {
    paths: [
      { d: signal((t) => Math.sin(2 * Math.PI * 3 * t)), style: 'ghost' },
      { d: signal((t, i) => (1 - amount * 0.4) * Math.sin(2 * Math.PI * 3 * t) + amount * 0.6 * rand(i), 0, 1, 400), style: 'main' },
    ],
  };
}

/** Enveloppe ADSR complète ; le segment correspondant au potard est mis en avant. */
export function adsrFigure(env: Envelope, highlight: keyof Envelope, hold = 0.6): Figure {
  const total = env.attack + env.decay + hold + env.release + 0.1;
  const decayed = (s: number) => env.sustain + (1 - env.sustain) * Math.exp(-(s - env.attack) / Math.max(env.decay / 4, 1e-4));
  const value = (s: number) => {
    if (s < env.attack) return s / Math.max(env.attack, 1e-4);
    const releaseAt = env.attack + env.decay + hold;
    if (s < releaseAt) return decayed(s);
    const r = (s - releaseAt) / Math.max(env.release, 0.01);
    return Math.max(0, decayed(releaseAt) * (1 - r));
  };
  const at = (seconds: number) => seconds / total;
  const segments: Record<keyof Envelope, [number, number]> = {
    attack: [0, at(env.attack)],
    decay: [at(env.attack), at(env.attack + env.decay)],
    sustain: [at(env.attack + env.decay), at(env.attack + env.decay + hold)],
    release: [at(env.attack + env.decay + hold), at(env.attack + env.decay + hold + env.release)],
  };
  const full = envelopeShape((t) => value(t * total), 0, 1, 240);
  const [from, to] = segments[highlight];
  const part = envelopeShape((t) => value(t * total), from, Math.max(to, from + 0.005), 80);
  const keyUp = at(env.attack + env.decay + hold) * W;
  return {
    paths: [baseline(), { d: full.area, style: 'soft' }, { d: full.line, style: 'ghost' }, { d: part.line, style: 'main' }],
    shades: [[0, keyUp]],
    labels: [{ x: keyUp - 3, y: 9, text: 'touche tenue', anchor: 'end' }],
  };
}

/** Ouverture du filtre dans le temps (échelle en octaves au-dessus du cutoff). */
export function filterEnvAmountFigure(amount: number, env: Envelope): Figure {
  const total = env.attack + env.decay + 0.6 + env.release + 0.1;
  const keyUp = ((env.attack + env.decay + 0.6) / total) * W;
  const decayed = (s: number) => env.sustain + (1 - env.sustain) * Math.exp(-(s - env.attack) / Math.max(env.decay / 4, 1e-4));
  const value = (s: number) => {
    if (s < env.attack) return s / Math.max(env.attack, 1e-4);
    const releaseAt = env.attack + env.decay + 0.6;
    if (s < releaseAt) return decayed(s);
    return decayed(releaseAt) * Math.exp(-(s - releaseAt) / Math.max(env.release / 4, 1e-4));
  };
  const shape = envelopeShape((t) => amount * value(t * total));
  return {
    paths: [baseline(), { d: shape.area, style: 'soft' }, { d: shape.line, style: 'main' }],
    shades: [[0, keyUp]],
    labels: [{ x: W - 4, y: 9, text: amount > 0.01 ? `jusqu'à +${(amount * 7).toFixed(1)} oct.` : 'filtre fixe', anchor: 'end' }],
  };
}

export function lfoTargetFigure(index: number): Figure {
  const depth = 0.6;
  const lfo = (t: number) => Math.sin(2 * Math.PI * 2 * t);
  let fn: (t: number, i: number) => number;
  if (index === 0) {
    // Pitch : la fréquence varie (vibrato). Phase = intégrale de 14 × (1 + 0.35·depth·lfo).
    const deviation = 14 * 0.35 * depth;
    fn = (t) => Math.sin(2 * Math.PI * (14 * t - (deviation * Math.cos(2 * Math.PI * 2 * t)) / (2 * Math.PI * 2)));
  } else if (index === 1) {
    // Filtre : la brillance varie (carré plus ou moins arrondi)
    let y = 0;
    fn = (t) => {
      const a = 0.04 + 0.5 * (0.5 + 0.5 * lfo(t));
      y += a * (osc('square', 12 * t) - y);
      return y * 0.9;
    };
  } else {
    // Volume : trémolo
    fn = (t) => (1 - depth / 2 + (depth / 2) * lfo(t)) * Math.sin(2 * Math.PI * 14 * t);
  }
  return { paths: [{ d: signal(fn, 0, 1, 600), style: 'main' }] };
}

/** Courbe du LFO sur une seconde. */
export function lfoCurveFigure(rate: number, depth: number, shapeIndex = 0): Figure {
  const shape = SHAPES[shapeIndex];
  return {
    paths: [
      { d: `M0 ${MID}L${W} ${MID}`, style: 'ghost' },
      { d: signal((t) => depth * osc(shape, rate * t), 0, 1, 600), style: 'main' },
    ],
    labels: [{ x: W - 4, y: H - 1, text: '1 seconde', anchor: 'end' }],
  };
}

export function driveFigure(drive: number): Figure {
  const k = 1 + drive * 12;
  const shaped = (t: number) => Math.tanh(k * Math.sin(2 * Math.PI * 3 * t)) / Math.tanh(k);
  return {
    paths: [
      { d: signal((t) => Math.sin(2 * Math.PI * 3 * t)), style: 'ghost' },
      { d: signal(shaped, 0, 1, 480), style: 'main' },
    ],
    labels: drive > 0.4 ? [{ x: W - 4, y: 10, text: 'crêtes écrasées', anchor: 'end' }] : [],
  };
}

// ---------- Enregistreur & métronome ----------

/** Traits verticaux : premier temps de la mesure en grand, autres temps en petit. */
function beatTicks(positions: { x: number; downbeat: boolean }[]): Figure['paths'] {
  return positions.map(({ x, downbeat }) => ({
    d: `M${x.toFixed(1)} ${BASE}L${x.toFixed(1)} ${downbeat ? 8 : 30}`,
    style: downbeat ? 'main' : 'ghost',
  }));
}

export function tempoFigure(bpm: number): Figure {
  const seconds = 4;
  const beat = 60 / bpm;
  const ticks: { x: number; downbeat: boolean }[] = [];
  for (let i = 0; i * beat < seconds; i++) ticks.push({ x: 4 + ((i * beat) / seconds) * (W - 8), downbeat: i % 4 === 0 });
  return { paths: [baseline(), ...beatTicks(ticks)], labels: [{ x: W - 4, y: H - 0.5, text: '4 secondes', anchor: 'end' }] };
}

export function meterFigure(beatsPerBar: number): Figure {
  const total = beatsPerBar * 2;
  const ticks = Array.from({ length: total }, (_, i) => ({ x: 6 + (i / total) * (W - 12), downbeat: i % beatsPerBar === 0 }));
  return {
    paths: [baseline(), ...beatTicks(ticks)],
    labels: [
      { x: 6, y: H - 0.5, text: 'mesure 1' },
      { x: 6 + W / 2 - 6, y: H - 0.5, text: 'mesure 2' },
    ],
  };
}

export function countInFigure(on: boolean): Figure {
  const ticks = Array.from({ length: 8 }, (_, i) => ({ x: 6 + (i / 8) * (W - 12), downbeat: i % 4 === 0 }));
  return {
    paths: [baseline(), ...beatTicks(ticks)],
    shades: on ? [[0, W / 2]] : [],
    labels: on
      ? [
          { x: W / 4, y: 10, text: 'décompte', anchor: 'middle' },
          { x: (3 * W) / 4, y: 10, text: 'enregistrement', anchor: 'middle' },
        ]
      : [{ x: W / 2, y: 10, text: 'enregistrement dès la mesure suivante', anchor: 'middle' }],
  };
}

/** Notes jouées (pointillés) et leur position une fois calées sur la grille. */
export function quantizeFigure(division: number): Figure {
  const played = [0.03, 0.27, 0.46, 0.69, 0.83];
  const note = (t: number, y: number) => {
    const x = 4 + t * (W - 8);
    return `M${x.toFixed(1)} ${y}L${(x + 14).toFixed(1)} ${y}L${(x + 14).toFixed(1)} ${y + 10}L${x.toFixed(1)} ${y + 10}Z`;
  };
  const paths: Figure['paths'] = [];
  if (division) {
    for (let i = 0; i <= division; i++) {
      const x = 4 + (i / division) * (W - 8);
      paths.push({ d: `M${x.toFixed(1)} 4L${x.toFixed(1)} ${BASE}`, style: 'ghost' });
    }
  }
  for (const t of played) {
    const snapped = division ? Math.round(t * division) / division : t;
    if (division) paths.push({ d: note(t, 12), style: 'soft' });
    paths.push({ d: note(snapped, division ? 34 : 24), style: 'fill' });
  }
  return {
    paths,
    labels: division ? [{ x: W - 4, y: H - 0.5, text: 'joué ↑ · calé ↓', anchor: 'end' }] : [{ x: W - 4, y: H - 0.5, text: 'timing joué', anchor: 'end' }],
  };
}
