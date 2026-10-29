import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { computePeaks } from '../core/audio-utils';

/** Affiche la forme d'onde d'un AudioBuffer, avec poignées de découpe optionnelles. */
@Component({
  selector: 'app-waveform',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas></canvas>
    @if (trimmable()) {
      <div class="shade" [style.left.%]="0" [style.width.%]="start() * 100"></div>
      <div class="shade" [style.left.%]="end() * 100" [style.right.%]="0"></div>
      <div class="handle start" [style.left.%]="start() * 100" (pointerdown)="grab($event, 'start')">
        <span></span>
      </div>
      <div class="handle end" [style.left.%]="end() * 100" (pointerdown)="grab($event, 'end')">
        <span></span>
      </div>
    }
    @if (playhead() !== null) {
      <div class="playhead" [style.left.%]="playhead()! * 100"></div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      height: var(--wave-height, 120px);
      background: var(--surface-2);
      border-radius: 10px;
      overflow: hidden;
      touch-action: none;
    }
    canvas { width: 100%; height: 100%; display: block; }
    .shade { position: absolute; top: 0; bottom: 0; background: rgb(0 0 0 / .55); pointer-events: none; }
    .handle {
      position: absolute; top: 0; bottom: 0; width: 36px; margin-left: -18px;
      display: flex; justify-content: center; cursor: ew-resize; touch-action: none;
    }
    .handle span { width: 3px; height: 100%; background: var(--accent); border-radius: 2px; }
    .handle::after {
      content: ''; position: absolute; top: 50%; width: 14px; height: 28px; margin-top: -14px;
      background: var(--accent); border-radius: 4px;
    }
    .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text); pointer-events: none; }
  `,
  host: {
    '(pointermove)': 'move($event)',
    '(pointerup)': 'drop()',
    '(pointercancel)': 'drop()',
  },
})
export class Waveform {
  readonly buffer = input<AudioBuffer | null>(null);
  readonly trimmable = input(false);
  readonly start = model(0);
  readonly end = model(1);
  readonly playhead = input<number | null>(null);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private dragging: 'start' | 'end' | null = null;

  private readonly width = signal(0);

  constructor(private readonly host: ElementRef<HTMLElement>) {
    const observer = new ResizeObserver(([entry]) => this.width.set(Math.round(entry.contentRect.width)));
    observer.observe(host.nativeElement);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
    afterRenderEffect(() => {
      this.width();
      this.draw(this.buffer());
    });
  }

  private draw(buffer: AudioBuffer | null): void {
    const canvas = this.canvas().nativeElement;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!buffer) return;

    const color = getComputedStyle(this.host.nativeElement).getPropertyValue('--wave-color').trim() || '#ff6a2b';
    const columns = Math.floor(canvas.width / ratio);
    const peaks = computePeaks(buffer, columns);
    const mid = canvas.height / 2;
    g.fillStyle = color;
    for (let x = 0; x < columns; x++) {
      const min = peaks[x * 2];
      const max = peaks[x * 2 + 1];
      const top = mid - max * mid * 0.95;
      const h = Math.max(ratio, (max - min) * mid * 0.95);
      g.fillRect(x * ratio, top, ratio, h);
    }
  }

  protected grab(e: PointerEvent, which: 'start' | 'end'): void {
    this.dragging = which;
    this.host.nativeElement.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  protected move(e: PointerEvent): void {
    if (!this.dragging) return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const minGap = 0.01;
    if (this.dragging === 'start') this.start.set(Math.min(x, this.end() - minGap));
    else this.end.set(Math.max(x, this.start() + minGap));
  }

  protected drop(): void {
    this.dragging = null;
  }
}
