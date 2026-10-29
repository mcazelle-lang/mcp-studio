const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

/** Valeur normalisée 0..1 → fréquence 20 Hz .. 20 kHz sur une échelle logarithmique. */
export function cutoffToHz(normalized: number): number {
  return 20 * 1000 ** Math.min(1, Math.max(0, normalized));
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

export function formatSeconds(s: number): string {
  return s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(2)}s`;
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null) return '–';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m > 0 ? `${m}:${sec.toFixed(0).padStart(2, '0')}` : `${sec.toFixed(1)}s`;
}

/** Extrait la portion [start, end] (fractions 0..1) d'un AudioBuffer, avec un court fondu pour éviter les clics. */
export function sliceBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  start: number,
  end: number,
  normalize = false,
): AudioBuffer {
  const from = Math.floor(buffer.length * Math.max(0, start));
  const to = Math.max(from + 1, Math.floor(buffer.length * Math.min(1, end)));
  const out = ctx.createBuffer(buffer.numberOfChannels, to - from, buffer.sampleRate);
  const fade = Math.min(Math.floor(buffer.sampleRate * 0.003), Math.floor((to - from) / 2));

  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c).subarray(from, to);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  const gain = normalize && peak > 0 ? 0.98 / peak : 1;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c).subarray(from, to);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) {
      let fadeGain = 1;
      if (i < fade) fadeGain = i / fade;
      else if (i >= src.length - fade) fadeGain = (src.length - 1 - i) / fade;
      dst[i] = src[i] * gain * fadeGain;
    }
  }
  return out;
}

/** Encode un AudioBuffer en WAV PCM 16 bits. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + length));
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** Calcule les pics (min/max) d'un buffer pour l'affichage de la forme d'onde. */
export function computePeaks(buffer: AudioBuffer, columns: number): Float32Array {
  const peaks = new Float32Array(columns * 2);
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / columns));
  for (let col = 0; col < columns; col++) {
    let min = 0;
    let max = 0;
    const start = col * step;
    for (let i = start; i < Math.min(start + step, data.length); i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    peaks[col * 2] = min;
    peaks[col * 2 + 1] = max;
  }
  return peaks;
}
