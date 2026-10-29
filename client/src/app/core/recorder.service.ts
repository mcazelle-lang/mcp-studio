import { Injectable, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export const MAX_RECORDING_SECONDS = 120;

/** Enregistrement micro : MediaRecorder + vu-mètre, puis décodage en AudioBuffer. */
@Injectable({ providedIn: 'root' })
export class RecorderService {
  private readonly engine = inject(AudioEngineService);

  readonly recording = signal(false);
  readonly elapsed = signal(0);
  readonly level = signal(0);

  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private analyser?: AnalyserNode;
  private source?: MediaStreamAudioSourceNode;
  private frame = 0;
  private startedAt = 0;
  private result?: Promise<AudioBuffer>;

  get supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  async start(): Promise<void> {
    if (this.recording()) return;
    this.engine.unlock();
    // Pour la musique on désactive les traitements « visio » du navigateur.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.result = new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          resolve(await this.engine.decode(await blob.arrayBuffer()));
        } catch (err) {
          reject(err);
        }
      };
    });
    recorder.start();
    this.recorder = recorder;

    this.source = this.engine.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.engine.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);

    this.startedAt = performance.now();
    this.recording.set(true);
    this.tick();
  }

  /** Arrête l'enregistrement et renvoie l'audio décodé. */
  async stop(): Promise<AudioBuffer> {
    if (!this.recorder || !this.result) throw new Error('Aucun enregistrement en cours');
    cancelAnimationFrame(this.frame);
    this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.recording.set(false);
    this.level.set(0);
    const result = this.result;
    this.recorder = undefined;
    this.result = undefined;
    return result;
  }

  private tick = () => {
    if (!this.analyser) return;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    this.level.set(Math.max(peak, this.level() * 0.85));
    const seconds = (performance.now() - this.startedAt) / 1000;
    this.elapsed.set(seconds);
    if (seconds >= MAX_RECORDING_SECONDS) {
      this.onAutoStop?.();
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Appelé quand la durée maximale est atteinte. */
  onAutoStop?: () => void;
}
