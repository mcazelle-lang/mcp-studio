import { Injectable, signal } from '@angular/core';
import { DECAY_HOLD, PlaybackSettings } from './models';
import { cutoffToHz } from './audio-utils';

export interface Voice {
  /** Arrête la voix avec un fondu de `release` secondes, maintenant ou à l'instant audio `at`. */
  stop(release?: number, at?: number): void;
}

const MAX_VOICES = 48;
const MODE_KEY = 'mpc.audio.mode';

export type AudioMode = 'reactive' | 'stable';

function loadAudioMode(): AudioMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'stable' ? 'stable' : 'reactive';
  } catch {
    return 'reactive';
  }
}

/** Le mode n'est pris en compte qu'à la création du contexte audio : il faut recharger la page. */
export function saveAudioMode(mode: AudioMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* stockage indisponible */
  }
}

/** Courbe linéaire jusqu'à 0,8 puis arrondie vers 0,98 ; l'entrée du WaveShaper (−1..1) représente −2..2. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4096);
  for (let i = 0; i < curve.length; i++) {
    const s = ((i / (curve.length - 1)) * 2 - 1) * 2;
    const a = Math.abs(s);
    const y = a < 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18);
    curve[i] = Math.sign(s) * y;
  }
  return curve;
}

export function reverseBuffer(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const rev = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    rev.getChannelData(c).set(buffer.getChannelData(c).slice().reverse());
  }
  return rev;
}

/**
 * Joue un sample avec des réglages de pad dans n'importe quel contexte audio
 * (temps réel, ou OfflineAudioContext pour fabriquer un fichier), à l'instant `t`.
 */
export function startSampleVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  reverbSend: AudioNode | null,
  buffer: AudioBuffer,
  s: PlaybackSettings,
  velocity: number,
  pitchOffset: number,
  t: number,
  reversed?: AudioBuffer,
): { voice: Voice; source: AudioBufferSourceNode; output: AudioNode } {
  const src = ctx.createBufferSource();
  src.buffer = s.reverse ? (reversed ?? reverseBuffer(ctx, buffer)) : buffer;
  src.playbackRate.value = 2 ** ((s.pitch + pitchOffset) / 12);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoffToHz(s.cutoff);
  filter.Q.value = 0.8;

  const env = ctx.createGain();
  const level = s.volume * velocity;
  const attack = Math.max(0.002, s.attack);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + attack);

  const panner = ctx.createStereoPanner();
  panner.pan.value = s.pan;

  src.connect(filter).connect(env).connect(panner).connect(destination);
  const nodes: AudioNode[] = [src, filter, env, panner];
  if (reverbSend && s.reverb > 0) {
    const send = ctx.createGain();
    send.gain.value = s.reverb;
    panner.connect(send).connect(reverbSend);
    nodes.push(send);
  }
  // Un nœud qui reste branché n'est jamais libéré, et ceux branchés à la réverbe
  // seraient traités indéfiniment : on débranche toute la chaîne quand le son se termine.
  src.addEventListener('ended', () => nodes.forEach((n) => n.disconnect()));

  const offset = Math.min(0.95, s.start) * buffer.duration;
  src.start(t, offset);
  if (s.decay < DECAY_HOLD) {
    env.gain.setTargetAtTime(0, t + attack, s.decay / 4);
    // ≈ 6 constantes de temps : le son est inaudible quand la lecture s'arrête (pas de clic).
    src.stop(t + attack + s.decay * 1.5 + 0.05);
  }

  /** Niveau de l'enveloppe à un instant donné (calculé, pour pouvoir programmer un arrêt futur). */
  const levelAt = (when: number) => {
    const elapsed = when - t;
    if (elapsed <= 0) return 0;
    if (elapsed < attack) return (level * elapsed) / attack;
    return s.decay >= DECAY_HOLD ? level : level * Math.exp(-(elapsed - attack) / (s.decay / 4));
  };

  let stopped = false;
  const voice: Voice = {
    stop: (release = 0.03, at?: number) => {
      if (stopped) return;
      stopped = true;
      const when = Math.max(at ?? ctx.currentTime, t);
      env.gain.cancelScheduledValues(when);
      env.gain.setValueAtTime(levelAt(when), when);
      env.gain.linearRampToValueAtTime(0, when + release);
      try {
        src.stop(when + release + 0.01);
      } catch {
        /* déjà arrêtée */
      }
    },
  };
  return { voice, source: src, output: panner };
}

/**
 * Moteur audio unique de l'application (un seul AudioContext, partagé par
 * les pads, le clavier, le synthé et l'enregistreur).
 */
@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  readonly mode: AudioMode = loadAudioMode();
  /** « Réactif » = latence minimale ; « Stable » = mémoire tampon plus grande, moins de coupures sur un appareil chargé. */
  readonly ctx = new AudioContext({ latencyHint: this.mode === 'stable' ? 'balanced' : 'interactive' });
  readonly running = signal(false);

  /** Entrée commune de tous les sons, avant le volume master. */
  readonly input: GainNode;
  /** Entrée de la réverbe (envois des pads). */
  readonly reverbSend: GainNode;

  private readonly master: GainNode;
  private readonly voices: Voice[] = [];
  private readonly reversed = new WeakMap<AudioBuffer, AudioBuffer>();

  constructor() {
    const ctx = this.ctx;
    this.input = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;

    // Limiteur pour éviter la saturation quand plusieurs sons se superposent.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    this.reverbSend = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = this.createImpulse(2.4);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.7;

    // Écrêteur doux après le limiteur : ce qui dépasse encore est arrondi au lieu d'être coupé net
    // (une coupure nette s'entend comme un grésillement).
    const clipper = ctx.createWaveShaper();
    clipper.curve = softClipCurve();
    const toCurveRange = ctx.createGain();
    toCurveRange.gain.value = 0.5;

    this.input.connect(this.master);
    this.reverbSend.connect(convolver).connect(reverbReturn).connect(this.master);
    this.master.connect(limiter).connect(toCurveRange).connect(clipper).connect(ctx.destination);

    this.running.set(ctx.state === 'running');
    ctx.addEventListener('statechange', () => this.running.set(ctx.state === 'running'));
  }

  /** Doit être appelé dans un geste utilisateur (exigence des navigateurs mobiles). */
  unlock(): void {
    // iOS : joue même lorsque le bouton silencieux est activé (Safari 16.4+).
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /**
   * Latence annoncée par le navigateur, en ms : traitement Web Audio (`baseLatency`)
   * et sortie jusqu'aux haut-parleurs (`outputLatency`, null si le navigateur ne la connaît pas).
   */
  latency(): { processing: number; output: number | null; sampleRate: number } {
    const ctx = this.ctx as AudioContext & { outputLatency?: number };
    const output = ctx.outputLatency;
    return {
      processing: Math.round((ctx.baseLatency ?? 0) * 1000),
      output: output ? Math.round(output * 1000) : null,
      sampleRate: ctx.sampleRate,
    };
  }

  /** Nombre de coupures audio (le moteur n'a pas fourni le son à temps), si le navigateur le mesure (Chrome). */
  underruns(): number | null {
    const stats = (this.ctx as AudioContext & { playbackStats?: { underrunEvents: number } }).playbackStats;
    return stats ? stats.underrunEvents : null;
  }

  setMasterVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  /** Joue un sample avec les réglages d'un pad (ou du clavier), maintenant ou à l'instant audio `when`. */
  playBuffer(buffer: AudioBuffer, s: PlaybackSettings, velocity = 1, pitchOffset = 0, when?: number): Voice {
    const t = Math.max(when ?? 0, this.ctx.currentTime);
    const { voice, source } = startSampleVoice(
      this.ctx,
      this.input,
      this.reverbSend,
      buffer,
      s,
      velocity,
      pitchOffset,
      t,
      s.reverse ? this.getReversed(buffer) : undefined,
    );
    source.addEventListener('ended', () => this.forget(voice));
    this.track(voice);
    return voice;
  }

  /** Enregistre une voix « externe » (synthé) dans la gestion de polyphonie. */
  track(voice: Voice): void {
    this.voices.push(voice);
    if (this.voices.length > MAX_VOICES) this.voices.shift()?.stop(0.02);
  }

  forget(voice: Voice): void {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
  }

  stopAll(): void {
    [...this.voices].forEach((v) => v.stop(0.05));
    this.voices.length = 0;
  }

  private getReversed(buffer: AudioBuffer): AudioBuffer {
    let rev = this.reversed.get(buffer);
    if (!rev) {
      rev = reverseBuffer(this.ctx, buffer);
      this.reversed.set(buffer, rev);
    }
    return rev;
  }

  /** Réponse impulsionnelle synthétique (bruit à décroissance exponentielle). */
  private createImpulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const impulse = this.ctx.createBuffer(2, Math.floor(rate * seconds), rate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
      }
    }
    return impulse;
  }
}
