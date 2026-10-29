import { SynthPatch, defaultPatch } from '../models';

export const GENRES = ['Drum n Bass', 'Funk', 'Dance', 'Disco', 'Hip-hop', 'Techno'] as const;
export type Genre = (typeof GENRES)[number];

export const FAMILIES = ['Basses', 'Guitares', 'Vents', 'Claviers', 'Cordes & nappes', 'Leads & synthés'] as const;
export type Family = (typeof FAMILIES)[number];

export interface FactoryPatch {
  key: string;
  name: string;
  family: Family;
  /** Style musical d'origine, pour les sons tirés des kits par style. */
  genre?: Genre;
  patch: SynthPatch;
}

type PatchOverrides = {
  [K in keyof SynthPatch]?: SynthPatch[K] extends object ? Partial<SynthPatch[K]> : SynthPatch[K];
};

/** Construit un patch complet à partir des seuls réglages qui diffèrent du patch par défaut. */
function make(o: PatchOverrides): SynthPatch {
  const base = defaultPatch();
  return {
    osc1: { ...base.osc1, ...o.osc1 },
    osc2: { ...base.osc2, ...o.osc2 },
    noise: o.noise ?? base.noise,
    filter: { ...base.filter, ...o.filter },
    ampEnv: { ...base.ampEnv, ...o.ampEnv },
    filterEnv: { ...base.filterEnv, ...o.filterEnv },
    lfo: { ...base.lfo, ...o.lfo },
    volume: o.volume ?? base.volume,
    drive: o.drive ?? base.drive,
  };
}

// Rappel : cutoff 0.33 ≈ 200 Hz, 0.47 ≈ 500 Hz, 0.57 ≈ 1 kHz, 0.67 ≈ 2 kHz, 0.77 ≈ 4 kHz.
export const FACTORY_PATCHES: FactoryPatch[] = [
  // ---------- Drum n Bass ----------
  {
    key: 'dnb-reese',
    name: 'Reese Bass',
    genre: 'Drum n Bass',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -18, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 18, level: 0.7 },
      filter: { type: 'lowpass', cutoff: 0.45, resonance: 2, envAmount: 0.15 },
      ampEnv: { attack: 0.005, decay: 0.3, sustain: 1, release: 0.15 },
      filterEnv: { attack: 0.01, decay: 0.5, sustain: 0.5, release: 0.2 },
      lfo: { wave: 'sine', rate: 0.4, depth: 0.35, target: 'filter' },
      volume: 0.7,
    }),
  },
  {
    key: 'dnb-sub',
    name: 'Sub Bass',
    genre: 'Drum n Bass',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'sine', octave: 0, detune: 0, level: 0.9 },
      osc2: { wave: 'triangle', octave: 1, detune: 0, level: 0.12 },
      filter: { type: 'lowpass', cutoff: 0.6, resonance: 0.5, envAmount: 0 },
      ampEnv: { attack: 0.005, decay: 0.2, sustain: 1, release: 0.12 },
      volume: 0.85,
    }),
  },
  {
    key: 'dnb-pad',
    name: 'Atmos Pad',
    genre: 'Drum n Bass',
    family: 'Cordes & nappes',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -8, level: 0.5 },
      osc2: { wave: 'triangle', octave: 1, detune: 8, level: 0.4 },
      noise: 0.05,
      filter: { type: 'lowpass', cutoff: 0.5, resonance: 2, envAmount: 0.2 },
      ampEnv: { attack: 0.8, decay: 1, sustain: 0.8, release: 1.8 },
      filterEnv: { attack: 1.2, decay: 1.5, sustain: 0.6, release: 1.5 },
      lfo: { wave: 'sine', rate: 0.3, depth: 0.3, target: 'filter' },
      volume: 0.55,
    }),
  },
  // ---------- Funk ----------
  {
    key: 'funk-slap',
    name: 'Slap Bass',
    genre: 'Funk',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'square', octave: 0, detune: 0, level: 0.6 },
      osc2: { wave: 'sawtooth', octave: -1, detune: 0, level: 0.5 },
      filter: { type: 'lowpass', cutoff: 0.42, resonance: 9, envAmount: 0.7 },
      ampEnv: { attack: 0.003, decay: 0.25, sustain: 0.4, release: 0.1 },
      filterEnv: { attack: 0.002, decay: 0.18, sustain: 0.05, release: 0.1 },
      volume: 0.75,
    }),
  },
  {
    key: 'funk-clav',
    name: 'Clavinet',
    genre: 'Funk',
    family: 'Claviers',
    patch: make({
      osc1: { wave: 'square', octave: 0, detune: 0, level: 0.5 },
      osc2: { wave: 'sawtooth', octave: 1, detune: 4, level: 0.4 },
      filter: { type: 'lowpass', cutoff: 0.7, resonance: 6, envAmount: 0.5 },
      ampEnv: { attack: 0.002, decay: 0.35, sustain: 0.2, release: 0.12 },
      filterEnv: { attack: 0.001, decay: 0.12, sustain: 0.1, release: 0.1 },
      volume: 0.6,
    }),
  },
  {
    key: 'funk-wah',
    name: 'Wah Lead',
    genre: 'Funk',
    family: 'Leads & synthés',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 7, level: 0.4 },
      filter: { type: 'bandpass', cutoff: 0.55, resonance: 8, envAmount: 0.2 },
      ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.2 },
      lfo: { wave: 'sine', rate: 4, depth: 0.5, target: 'filter' },
      volume: 0.6,
    }),
  },
  // ---------- Dance ----------
  {
    key: 'dance-supersaw',
    name: 'Supersaw',
    genre: 'Dance',
    family: 'Leads & synthés',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -14, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 14, level: 0.7 },
      filter: { type: 'lowpass', cutoff: 0.75, resonance: 1, envAmount: 0.2 },
      ampEnv: { attack: 0.01, decay: 0.4, sustain: 0.85, release: 0.5 },
      filterEnv: { attack: 0.01, decay: 0.6, sustain: 0.5, release: 0.5 },
      lfo: { wave: 'sine', rate: 5.5, depth: 0.08, target: 'pitch' },
      volume: 0.55,
    }),
  },
  {
    key: 'dance-pluck',
    name: 'Pluck',
    genre: 'Dance',
    family: 'Leads & synthés',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -4, level: 0.7 },
      osc2: { wave: 'square', octave: 1, detune: 4, level: 0.3 },
      filter: { type: 'lowpass', cutoff: 0.4, resonance: 5, envAmount: 0.8 },
      ampEnv: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.25 },
      filterEnv: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
      volume: 0.65,
    }),
  },
  {
    key: 'dance-stab',
    name: 'Rave Stab',
    genre: 'Dance',
    family: 'Leads & synthés',
    patch: make({
      osc1: { wave: 'square', octave: 0, detune: -10, level: 0.6 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 10, level: 0.6 },
      filter: { type: 'lowpass', cutoff: 0.6, resonance: 6, envAmount: 0.5 },
      ampEnv: { attack: 0.003, decay: 0.25, sustain: 0.15, release: 0.2 },
      filterEnv: { attack: 0.002, decay: 0.2, sustain: 0.1, release: 0.2 },
      volume: 0.6,
    }),
  },
  // ---------- Disco ----------
  {
    key: 'disco-strings',
    name: 'Disco Strings',
    genre: 'Disco',
    family: 'Cordes & nappes',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -10, level: 0.6 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 10, level: 0.6 },
      filter: { type: 'lowpass', cutoff: 0.62, resonance: 1.5, envAmount: 0.1 },
      ampEnv: { attack: 0.15, decay: 0.5, sustain: 0.85, release: 0.6 },
      filterEnv: { attack: 0.3, decay: 0.6, sustain: 0.7, release: 0.6 },
      lfo: { wave: 'triangle', rate: 5.5, depth: 0.15, target: 'pitch' },
      volume: 0.55,
    }),
  },
  {
    key: 'disco-octave',
    name: 'Octave Bass',
    genre: 'Disco',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.6 },
      osc2: { wave: 'square', octave: -1, detune: 0, level: 0.5 },
      filter: { type: 'lowpass', cutoff: 0.5, resonance: 7, envAmount: 0.55 },
      ampEnv: { attack: 0.003, decay: 0.22, sustain: 0.35, release: 0.1 },
      filterEnv: { attack: 0.002, decay: 0.16, sustain: 0.1, release: 0.1 },
      volume: 0.75,
    }),
  },
  {
    key: 'disco-brass',
    name: 'Section cuivres',
    genre: 'Disco',
    family: 'Vents',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -5, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 5, level: 0.5 },
      filter: { type: 'lowpass', cutoff: 0.48, resonance: 2, envAmount: 0.45 },
      ampEnv: { attack: 0.04, decay: 0.3, sustain: 0.8, release: 0.25 },
      filterEnv: { attack: 0.06, decay: 0.35, sustain: 0.4, release: 0.3 },
      volume: 0.6,
    }),
  },
  // ---------- Hip-hop ----------
  {
    key: 'hiphop-808',
    name: '808 Bass',
    genre: 'Hip-hop',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'sine', octave: 0, detune: 0, level: 0.9 },
      osc2: { wave: 'triangle', octave: 1, detune: 0, level: 0.15 },
      filter: { type: 'lowpass', cutoff: 0.7, resonance: 0.5, envAmount: 0 },
      ampEnv: { attack: 0.003, decay: 1.2, sustain: 0.5, release: 0.6 },
      volume: 0.9,
    }),
  },
  {
    key: 'hiphop-keys',
    name: 'Lo-fi Keys',
    genre: 'Hip-hop',
    family: 'Claviers',
    patch: make({
      osc1: { wave: 'sine', octave: 0, detune: 0, level: 0.7 },
      osc2: { wave: 'triangle', octave: 1, detune: 3, level: 0.3 },
      noise: 0.02,
      filter: { type: 'lowpass', cutoff: 0.55, resonance: 0.7, envAmount: 0.2 },
      ampEnv: { attack: 0.005, decay: 1.2, sustain: 0.3, release: 0.6 },
      filterEnv: { attack: 0.005, decay: 0.8, sustain: 0.2, release: 0.5 },
      lfo: { wave: 'sine', rate: 4, depth: 0.2, target: 'amp' },
      volume: 0.7,
    }),
  },
  // ---------- Techno ----------
  {
    key: 'techno-acid',
    name: 'Acid 303',
    genre: 'Techno',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.8 },
      osc2: { wave: 'square', octave: 0, detune: 0, level: 0 },
      filter: { type: 'lowpass', cutoff: 0.38, resonance: 16, envAmount: 0.75 },
      ampEnv: { attack: 0.003, decay: 0.25, sustain: 0.6, release: 0.1 },
      filterEnv: { attack: 0.002, decay: 0.25, sustain: 0.05, release: 0.1 },
      volume: 0.6,
    }),
  },
  {
    key: 'techno-dub',
    name: 'Dub Chord',
    genre: 'Techno',
    family: 'Leads & synthés',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -6, level: 0.6 },
      osc2: { wave: 'square', octave: 0, detune: 6, level: 0.4 },
      filter: { type: 'lowpass', cutoff: 0.45, resonance: 4, envAmount: 0.3 },
      ampEnv: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.3 },
      filterEnv: { attack: 0.003, decay: 0.2, sustain: 0, release: 0.2 },
      volume: 0.6,
    }),
  },
  // ---------- Guitares ----------
  {
    key: 'gtr-nylon',
    name: 'Guitare nylon',
    family: 'Guitares',
    patch: make({
      osc1: { wave: 'triangle', octave: 0, detune: 0, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 3, level: 0.25 },
      noise: 0.03,
      filter: { type: 'lowpass', cutoff: 0.5, resonance: 1.5, envAmount: 0.45 },
      ampEnv: { attack: 0.002, decay: 1.2, sustain: 0, release: 0.3 },
      filterEnv: { attack: 0.001, decay: 0.25, sustain: 0.1, release: 0.2 },
      volume: 0.75,
    }),
  },
  {
    key: 'gtr-clean',
    name: 'Guitare électrique claire',
    family: 'Guitares',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -3, level: 0.6 },
      osc2: { wave: 'square', octave: 0, detune: 3, level: 0.3 },
      filter: { type: 'lowpass', cutoff: 0.55, resonance: 2, envAmount: 0.4 },
      ampEnv: { attack: 0.002, decay: 1.5, sustain: 0.15, release: 0.3 },
      filterEnv: { attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.25 },
      volume: 0.65,
    }),
  },
  {
    key: 'gtr-muted',
    name: 'Guitare funk étouffée',
    family: 'Guitares',
    genre: 'Funk',
    patch: make({
      osc1: { wave: 'square', octave: 0, detune: 0, level: 0.5 },
      osc2: { wave: 'sawtooth', octave: 1, detune: 0, level: 0.3 },
      noise: 0.08,
      filter: { type: 'bandpass', cutoff: 0.62, resonance: 5, envAmount: 0.4 },
      ampEnv: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 },
      filterEnv: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 },
      volume: 0.75,
    }),
  },
  {
    key: 'gtr-dist',
    name: 'Guitare saturée',
    family: 'Guitares',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -8, level: 0.7 },
      osc2: { wave: 'square', octave: -1, detune: 8, level: 0.5 },
      filter: { type: 'lowpass', cutoff: 0.58, resonance: 1.5, envAmount: 0.2 },
      ampEnv: { attack: 0.003, decay: 0.5, sustain: 0.85, release: 0.25 },
      filterEnv: { attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.2 },
      drive: 0.8,
      volume: 0.45,
    }),
  },
  {
    key: 'gtr-lead',
    name: 'Guitare solo',
    family: 'Guitares',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -6, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 6, level: 0.5 },
      filter: { type: 'lowpass', cutoff: 0.62, resonance: 3, envAmount: 0.25 },
      ampEnv: { attack: 0.005, decay: 0.4, sustain: 0.9, release: 0.4 },
      filterEnv: { attack: 0.005, decay: 0.4, sustain: 0.6, release: 0.3 },
      lfo: { wave: 'sine', rate: 5.5, depth: 0.15, target: 'pitch' },
      drive: 0.65,
      volume: 0.45,
    }),
  },
  // ---------- Basses ----------
  {
    key: 'bass-finger',
    name: 'Basse au doigt',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'triangle', octave: 0, detune: 0, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.3 },
      filter: { type: 'lowpass', cutoff: 0.4, resonance: 2, envAmount: 0.3 },
      ampEnv: { attack: 0.003, decay: 0.8, sustain: 0.3, release: 0.15 },
      filterEnv: { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.15 },
      volume: 0.85,
    }),
  },
  {
    key: 'bass-picked',
    name: 'Basse au médiator',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.6 },
      osc2: { wave: 'square', octave: 0, detune: 0, level: 0.3 },
      filter: { type: 'lowpass', cutoff: 0.48, resonance: 3, envAmount: 0.5 },
      ampEnv: { attack: 0.002, decay: 0.5, sustain: 0.35, release: 0.12 },
      filterEnv: { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.1 },
      drive: 0.1,
      volume: 0.8,
    }),
  },
  {
    key: 'bass-moog',
    name: 'Basse synthé analogique',
    family: 'Basses',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -4, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: -1, detune: 4, level: 0.5 },
      filter: { type: 'lowpass', cutoff: 0.35, resonance: 8, envAmount: 0.5 },
      ampEnv: { attack: 0.003, decay: 0.3, sustain: 0.7, release: 0.12 },
      filterEnv: { attack: 0.002, decay: 0.3, sustain: 0.2, release: 0.12 },
      drive: 0.2,
      volume: 0.7,
    }),
  },
  // ---------- Vents ----------
  {
    key: 'wind-flute',
    name: 'Flûte',
    family: 'Vents',
    patch: make({
      osc1: { wave: 'sine', octave: 0, detune: 0, level: 0.7 },
      osc2: { wave: 'triangle', octave: 1, detune: 0, level: 0.15 },
      noise: 0.12,
      filter: { type: 'lowpass', cutoff: 0.6, resonance: 1, envAmount: 0.1 },
      ampEnv: { attack: 0.08, decay: 0.2, sustain: 0.85, release: 0.2 },
      filterEnv: { attack: 0.1, decay: 0.3, sustain: 0.8, release: 0.2 },
      lfo: { wave: 'sine', rate: 5, depth: 0.12, target: 'pitch' },
      volume: 0.65,
    }),
  },
  {
    key: 'wind-clarinet',
    name: 'Clarinette',
    family: 'Vents',
    patch: make({
      osc1: { wave: 'square', octave: 0, detune: 0, level: 0.6 },
      osc2: { wave: 'triangle', octave: 0, detune: 0, level: 0.2 },
      noise: 0.03,
      filter: { type: 'lowpass', cutoff: 0.52, resonance: 1.5, envAmount: 0.15 },
      ampEnv: { attack: 0.05, decay: 0.2, sustain: 0.85, release: 0.15 },
      lfo: { wave: 'sine', rate: 5, depth: 0.08, target: 'pitch' },
      volume: 0.6,
    }),
  },
  {
    key: 'wind-sax',
    name: 'Saxophone',
    family: 'Vents',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: -3, level: 0.6 },
      osc2: { wave: 'square', octave: 0, detune: 3, level: 0.3 },
      noise: 0.06,
      filter: { type: 'lowpass', cutoff: 0.5, resonance: 4, envAmount: 0.35 },
      ampEnv: { attack: 0.04, decay: 0.3, sustain: 0.8, release: 0.15 },
      filterEnv: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 0.2 },
      lfo: { wave: 'sine', rate: 5.5, depth: 0.12, target: 'pitch' },
      drive: 0.25,
      volume: 0.55,
    }),
  },
  {
    key: 'wind-trumpet',
    name: 'Trompette',
    family: 'Vents',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 4, level: 0.4 },
      filter: { type: 'lowpass', cutoff: 0.45, resonance: 2.5, envAmount: 0.55 },
      ampEnv: { attack: 0.03, decay: 0.25, sustain: 0.85, release: 0.12 },
      filterEnv: { attack: 0.04, decay: 0.25, sustain: 0.55, release: 0.15 },
      lfo: { wave: 'sine', rate: 6, depth: 0.08, target: 'pitch' },
      drive: 0.15,
      volume: 0.55,
    }),
  },
  {
    key: 'wind-trombone',
    name: 'Trombone',
    family: 'Vents',
    patch: make({
      osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.7 },
      osc2: { wave: 'sawtooth', octave: -1, detune: 0, level: 0.3 },
      filter: { type: 'lowpass', cutoff: 0.38, resonance: 2, envAmount: 0.4 },
      ampEnv: { attack: 0.06, decay: 0.3, sustain: 0.85, release: 0.2 },
      filterEnv: { attack: 0.08, decay: 0.4, sustain: 0.5, release: 0.25 },
      volume: 0.6,
    }),
  },
  // ---------- Claviers ----------
  {
    key: 'keys-organ',
    name: 'Orgue',
    family: 'Claviers',
    patch: make({
      osc1: { wave: 'sine', octave: 0, detune: 0, level: 0.6 },
      osc2: { wave: 'sine', octave: 1, detune: 2, level: 0.5 },
      filter: { type: 'lowpass', cutoff: 0.8, resonance: 0.7, envAmount: 0 },
      ampEnv: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.08 },
      lfo: { wave: 'sine', rate: 6, depth: 0.15, target: 'amp' },
      volume: 0.55,
    }),
  },
];

export function factoryPreset(key: string): FactoryPatch {
  const preset = FACTORY_PATCHES.find((p) => p.key === key);
  if (!preset) throw new Error(`Preset inconnu : ${key}`);
  return preset;
}

export function factoryPatch(key: string): SynthPatch {
  return factoryPreset(key).patch;
}

/** Presets d'usine regroupés par famille d'instruments, pour les menus. */
export const FACTORY_BY_FAMILY = FAMILIES.map((family) => ({
  family,
  presets: FACTORY_PATCHES.filter((p) => p.family === family),
}));
