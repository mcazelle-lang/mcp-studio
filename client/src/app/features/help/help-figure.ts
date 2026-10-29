import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Figure, H, W } from './help-figures';

@Component({
  selector: 'app-help-figure',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="none" aria-hidden="true">
      @for (shade of figure().shades ?? []; track $index) {
        <rect class="shade" [attr.x]="shade[0]" y="0" [attr.width]="shade[1] - shade[0]" [attr.height]="height" />
      }
      @for (p of figure().paths; track $index) {
        <path [attr.d]="p.d" [attr.class]="p.style" />
      }
    </svg>
    @for (label of figure().labels ?? []; track $index) {
      <span
        class="label"
        [style.left.%]="(label.x / width) * 100"
        [style.top.%]="(label.y / height) * 100"
        [attr.data-anchor]="label.anchor ?? 'start'"
      >{{ label.text }}</span>
    }
  `,
  styles: `
    :host {
      position: relative; display: block; height: 72px;
      background: var(--surface-2); border-radius: 8px; overflow: hidden;
    }
    svg { width: 100%; height: 100%; display: block; }
    path { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
    .main { stroke: var(--accent); stroke-width: 2; }
    .ghost { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: .6; }
    .soft { stroke: none; fill: var(--accent); opacity: .18; }
    .fill { stroke: none; fill: var(--accent); opacity: .85; }
    .shade { fill: rgb(255 255 255 / .05); }
    .label {
      position: absolute; transform: translateY(-80%); font-size: 10px; color: var(--muted);
      white-space: nowrap; pointer-events: none;
    }
    .label[data-anchor='middle'] { transform: translate(-50%, -80%); }
    .label[data-anchor='end'] { transform: translate(-100%, -80%); }
  `,
})
export class HelpFigure {
  readonly figure = input.required<Figure>();
  protected readonly width = W;
  protected readonly height = H;
}
