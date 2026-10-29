import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { isBlackKey, noteName } from '../core/audio-utils';

/**
 * Touches physiques → demi-tons (rangée du milieu = touches blanches, comme un piano).
 * `KeyboardEvent.code` ne dépend pas de la disposition : en AZERTY, c'est la rangée Q S D F G H J K.
 */
export const PIANO_KEY_CODES: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

/** Touches physiques pour changer d'octave (W / X en AZERTY, Z / X en QWERTY). */
export const OCTAVE_KEY_CODES: Record<string, number> = { KeyZ: -1, KeyX: 1 };

/** Ignore les touches tapées dans un champ de saisie ou avec un modificateur. */
export function isPlayableKeyEvent(e: KeyboardEvent): boolean {
  return !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target as HTMLElement).closest('input, select, textarea');
}

interface Key {
  midi: number;
  black: boolean;
  /** Position horizontale en nombre de touches blanches. */
  x: number;
  label: string;
}

/**
 * Clavier multi-touch : chaque doigt joue sa note, et glisser d'une touche
 * à l'autre fait un glissando.
 */
@Component({
  selector: 'app-piano',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="keys"
      (pointerdown)="down($event)"
      (pointermove)="move($event)"
      (pointerup)="up($event)"
      (pointercancel)="up($event)"
      (lostpointercapture)="up($event)"
      (contextmenu)="$event.preventDefault()"
    >
      @for (key of keys(); track key.midi) {
        <div
          class="key"
          [class.black]="key.black"
          [class.on]="pressed().has(key.midi)"
          [attr.data-midi]="key.midi"
          [style.left.%]="(key.black ? key.x - 0.32 : key.x) * whiteWidth()"
          [style.width.%]="(key.black ? 0.64 : 1) * whiteWidth()"
        >
          @if (!key.black && showLabels()) {
            <span>{{ key.label }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; height: var(--piano-height, 180px); }
    .keys {
      position: relative; height: 100%; touch-action: none;
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    }
    .key {
      position: absolute; top: 0; bottom: 0;
      background: linear-gradient(#f4f4f0, #dcdcd6);
      border: 1px solid #222; border-radius: 0 0 6px 6px;
      display: flex; align-items: flex-end; justify-content: center;
      padding-bottom: 6px; font-size: 10px; color: #666;
      box-sizing: border-box;
    }
    .key.black {
      bottom: 38%; z-index: 1;
      background: linear-gradient(#333, #111);
      border-color: #000; border-radius: 0 0 4px 4px;
    }
    .key.on { background: var(--accent); color: #fff; }
    .key.black.on { background: var(--accent-strong); }
  `,
})
export class Piano {
  /** Première note (idéalement un Do). */
  readonly startNote = input(48);
  readonly octaves = input(2);
  readonly showLabels = input(true);
  readonly noteOn = output<number>();
  readonly noteOff = output<number>();

  /** Notes allumées depuis l'extérieur (clavier d'ordinateur). */
  readonly highlighted = input<ReadonlySet<number>>(new Set());

  private readonly pointers = new Map<number, number>();
  private readonly touched = signal<ReadonlySet<number>>(new Set());
  protected readonly pressed = computed(() => new Set([...this.touched(), ...this.highlighted()]));

  protected readonly keys = computed<Key[]>(() => {
    const keys: Key[] = [];
    let white = 0;
    const last = this.startNote() + this.octaves() * 12;
    for (let midi = this.startNote(); midi <= last; midi++) {
      const black = isBlackKey(midi);
      keys.push({ midi, black, x: white, label: midi % 12 === 0 ? noteName(midi) : '' });
      if (!black) white++;
    }
    return keys;
  });

  protected readonly whiteWidth = computed(() => 100 / this.keys().filter((k) => !k.black).length);

  private noteAt(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-midi]');
    return el ? Number(el.dataset['midi']) : null;
  }

  private sync(): void {
    this.touched.set(new Set(this.pointers.values()));
  }

  protected down(e: PointerEvent): void {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const midi = this.noteAt(e);
    if (midi === null) return;
    this.pointers.set(e.pointerId, midi);
    this.noteOn.emit(midi);
    this.sync();
  }

  protected move(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    const midi = this.noteAt(e);
    const current = this.pointers.get(e.pointerId)!;
    if (midi === null || midi === current) return;
    this.pointers.set(e.pointerId, midi);
    if (![...this.pointers.values()].includes(current)) this.noteOff.emit(current);
    this.noteOn.emit(midi);
    this.sync();
  }

  protected up(e: PointerEvent): void {
    const midi = this.pointers.get(e.pointerId);
    if (midi === undefined) return;
    this.pointers.delete(e.pointerId);
    // Une autre touche du même doigt… ou d'un autre doigt peut encore tenir cette note.
    if (![...this.pointers.values()].includes(midi)) this.noteOff.emit(midi);
    this.sync();
  }
}
