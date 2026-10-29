export type SampleSource = 'recording' | 'import' | 'synth' | 'preset' | 'take';

export interface Sample {
  id: string;
  name: string;
  source: SampleSource;
  file: string;
  mimeType: string;
  size: number;
  duration: number | null;
  createdAt: string;
}

/** Réglages de lecture d'un sample (potards d'un pad). */
export interface PlaybackSettings {
  /** 0..1 */
  volume: number;
  /** demi-tons, -24..24 */
  pitch: number;
  /** -1 (gauche) .. 1 (droite) */
  pan: number;
  /** 0..1, converti en fréquence de coupure logarithmique */
  cutoff: number;
  /** secondes */
  attack: number;
  /** secondes ; DECAY_HOLD = le sample est joué en entier */
  decay: number;
  /** position de départ, fraction 0..0.95 de la durée */
  start: number;
  /** envoi vers la réverbe, 0..1 */
  reverb: number;
  reverse: boolean;
  /** one-shot : le sample joue jusqu'au bout ; gate : il s'arrête quand on relâche */
  mode: 'oneshot' | 'gate';
}

export const DECAY_HOLD = 5;

export interface Pad {
  sampleId: string | null;
  settings: PlaybackSettings;
}

export interface Kit {
  name: string;
  master: number;
  pads: Pad[];
}

export const BANKS = ['A', 'B', 'C', 'D'] as const;
export const PADS_PER_BANK = 16;

export function defaultPlaybackSettings(): PlaybackSettings {
  return {
    volume: 0.8,
    pitch: 0,
    pan: 0,
    cutoff: 1,
    attack: 0,
    decay: DECAY_HOLD,
    start: 0,
    reverb: 0,
    reverse: false,
    mode: 'oneshot',
  };
}

export function padLabel(index: number): string {
  return `${BANKS[Math.floor(index / PADS_PER_BANK)]}${(index % PADS_PER_BANK) + 1}`;
}

// ---------- Synthé ----------

export interface OscSettings {
  wave: OscillatorType;
  /** -2..2 */
  octave: number;
  /** cents, -50..50 */
  detune: number;
  /** 0..1 */
  level: number;
}

export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SynthPatch {
  osc1: OscSettings;
  osc2: OscSettings;
  noise: number;
  filter: {
    type: 'lowpass' | 'highpass' | 'bandpass';
    cutoff: number;
    resonance: number;
    envAmount: number;
  };
  ampEnv: Envelope;
  filterEnv: Envelope;
  lfo: {
    wave: OscillatorType;
    rate: number;
    depth: number;
    target: 'pitch' | 'filter' | 'amp';
  };
  volume: number;
  /** Saturation après le filtre, 0..1 (0 = son propre). */
  drive: number;
}

export interface SynthPreset {
  id: string;
  name: string;
  patch: SynthPatch;
  createdAt: string;
}

export function defaultPatch(): SynthPatch {
  return {
    osc1: { wave: 'sawtooth', octave: 0, detune: -6, level: 0.7 },
    osc2: { wave: 'square', octave: -1, detune: 6, level: 0.4 },
    noise: 0,
    filter: { type: 'lowpass', cutoff: 0.55, resonance: 4, envAmount: 0.4 },
    ampEnv: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.4 },
    filterEnv: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 0.4 },
    lfo: { wave: 'sine', rate: 5, depth: 0, target: 'pitch' },
    volume: 0.7,
    drive: 0,
  };
}

// ---------- Prises enregistrées au clavier ----------

export interface TakeNote {
  midi: number;
  /** Début, en secondes depuis le début de la prise. */
  time: number;
  duration: number;
  velocity: number;
}

/** Le son avec lequel la prise a été jouée, figé au moment de l'enregistrement. */
export type TakeSound =
  | { kind: 'synth'; label: string; patch: SynthPatch }
  | { kind: 'sample'; label: string; sampleId: string; rootNote: number; settings: PlaybackSettings; release: number };

export interface Take {
  id: string;
  name: string;
  createdAt: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  /** Durée totale (nombre entier de mesures), en secondes. */
  length: number;
  sound: TakeSound;
  notes: TakeNote[];
}
