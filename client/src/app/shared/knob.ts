import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

const SWEEP = 270;
const DRAG_PIXELS = 160;

/**
 * Potard rotatif tactile : glisser verticalement pour tourner,
 * double-tap pour revenir à la valeur par défaut.
 */
@Component({
  selector: 'app-knob',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="knob"
      role="slider"
      tabindex="0"
      [attr.aria-label]="label()"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuemax]="max()"
      [attr.aria-valuenow]="value()"
      (pointerdown)="onDown($event)"
      (pointermove)="onMove($event)"
      (pointerup)="onUp($event)"
      (pointercancel)="onUp($event)"
      (dblclick)="reset()"
      (wheel)="onWheel($event)"
      (keydown)="onKey($event)"
    >
      <svg viewBox="0 0 64 64">
        <path class="track" [attr.d]="arc(-135, 135)" />
        <path class="fill" [attr.d]="fillPath()" />
        <circle class="cap" cx="32" cy="32" r="17" />
        <line class="pointer" x1="32" y1="32" x2="32" y2="18" [attr.transform]="'rotate(' + angle() + ' 32 32)'" />
      </svg>
    </div>
    <span class="value">{{ display() }}</span>
    <span class="label">{{ label() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      user-select: none;
      -webkit-user-select: none;
      min-width: 0;
    }
    .knob {
      width: var(--knob-size, 56px);
      height: var(--knob-size, 56px);
      touch-action: none;
      cursor: ns-resize;
      border-radius: 50%;
      outline: none;
    }
    .knob:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
    svg { width: 100%; height: 100%; display: block; }
    .track, .fill { fill: none; stroke-width: 5; stroke-linecap: round; }
    .track { stroke: var(--knob-track); }
    .fill { stroke: var(--knob-color, var(--accent)); }
    .cap { fill: var(--knob-cap); stroke: var(--line); stroke-width: 1; }
    .pointer { stroke: var(--text); stroke-width: 3; stroke-linecap: round; }
    .value { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text); line-height: 1.1; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); line-height: 1.1; text-align: center; }
  `,
})
export class Knob {
  readonly value = model.required<number>();
  readonly min = input(0);
  readonly max = input(1);
  readonly step = input(0);
  readonly label = input('');
  /** Valeur restaurée au double-tap. */
  readonly defaultValue = input<number | undefined>(undefined);
  /** Centre l'arc sur zéro (pan, pitch…). */
  readonly bipolar = input(false);
  readonly format = input<(v: number) => string>((v) => (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(0)));

  private drag?: { pointerId: number; y: number; start: number };

  protected readonly ratio = computed(() => (this.value() - this.min()) / (this.max() - this.min() || 1));
  protected readonly angle = computed(() => -135 + this.ratio() * SWEEP);
  protected readonly display = computed(() => this.format()(this.value()));
  protected readonly fillPath = computed(() => {
    const from = this.bipolar() ? 0 : -135;
    const to = this.angle();
    return Math.abs(to - from) < 0.5 ? '' : this.arc(Math.min(from, to), Math.max(from, to));
  });

  protected arc(fromDeg: number, toDeg: number): string {
    const r = 27;
    const pt = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return `${32 + r * Math.cos(rad)} ${32 + r * Math.sin(rad)}`;
    };
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${pt(fromDeg)} A ${r} ${r} 0 ${large} 1 ${pt(toDeg)}`;
  }

  private set(v: number): void {
    const step = this.step();
    let next = Math.min(this.max(), Math.max(this.min(), v));
    if (step > 0) next = Math.round(next / step) * step;
    if (next !== this.value()) this.value.set(next);
  }

  protected onDown(e: PointerEvent): void {
    (e.target as Element).closest('.knob')?.setPointerCapture(e.pointerId);
    this.drag = { pointerId: e.pointerId, y: e.clientY, start: this.value() };
    e.preventDefault();
  }

  protected onMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const fine = e.shiftKey ? 0.2 : 1;
    const delta = ((this.drag.y - e.clientY) / DRAG_PIXELS) * (this.max() - this.min()) * fine;
    this.set(this.drag.start + delta);
  }

  protected onUp(e: PointerEvent): void {
    if (this.drag?.pointerId === e.pointerId) this.drag = undefined;
  }

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.set(this.value() - Math.sign(e.deltaY) * this.nudge());
  }

  protected onKey(e: KeyboardEvent): void {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (dir) {
      e.preventDefault();
      this.set(this.value() + dir * this.nudge());
    }
  }

  protected reset(): void {
    const def = this.defaultValue();
    if (def !== undefined) this.value.set(def);
  }

  private nudge(): number {
    return this.step() || (this.max() - this.min()) / 100;
  }
}
