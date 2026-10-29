import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Signal,
  WritableSignal,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AudioEngineService, Voice } from '../../core/audio-engine.service';
import { defaultPatch, defaultPlaybackSettings } from '../../core/models';
import { SoundSpec, renderSound } from '../../core/presets/sound-design';
import { startSynthVoice } from '../../core/synth.service';
import { Knob } from '../../shared/knob';
import { Demo, DemoSample, HELP, HelpControl, HelpEntry } from './help-content';
import { Figure } from './help-figures';
import { HelpFigure } from './help-figure';

type KnobControl = Extract<HelpControl, { type: 'knob' }>;
type ChoiceControl = Extract<HelpControl, { type: 'choice' }>;

interface Item {
  entry: HelpEntry;
  knob?: KnobControl;
  choice?: ChoiceControl;
  value: WritableSignal<number>;
  figure: Signal<Figure>;
}

const DEMO_SOUNDS: Record<DemoSample, SoundSpec> = {
  chord: { kind: 'synth', preset: 'hiphop-keys', notes: [60, 63, 67, 70], hold: 0.9 },
  snare: { kind: 'snare', tone: 190, toneDecay: 0.12, noiseDecay: 0.25, noiseHP: 1200, snappy: 0.65 },
};

@Component({
  selector: 'app-help',
  imports: [Knob, HelpFigure],
  templateUrl: './help.html',
  styleUrl: './help.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpView {
  private readonly engine = inject(AudioEngineService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Chaque fiche a sa propre valeur de démo : seule sa figure est recalculée quand on tourne son potard. */
  protected readonly sections = HELP.map((section) => ({
    ...section,
    groups: section.groups.map((group) => ({
      ...group,
      items: group.entries.map((entry): Item => {
        const value = signal(entry.control.value);
        return {
          entry,
          knob: entry.control.type === 'knob' ? entry.control : undefined,
          choice: entry.control.type === 'choice' ? entry.control : undefined,
          value,
          figure: computed(() => entry.figure(value())),
        };
      }),
    })),
  }));
  protected readonly playing = signal<string | null>(null);

  private readonly buffers = new Map<DemoSample, Promise<AudioBuffer>>();
  private voices: Voice[] = [];
  private synthVoices: ReturnType<typeof startSynthVoice>[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  private readonly demo: Demo = {
    sample: (which, settings = {}, options = {}) => {
      void this.buffer(which).then((buffer) => {
        const play = () => {
          const voice = this.engine.playBuffer(
            buffer,
            { ...defaultPlaybackSettings(), volume: 0.9, ...settings },
            options.velocity ?? 1,
            options.pitch ?? 0,
          );
          this.voices.push(voice);
          if (options.holdFor !== undefined) {
            this.timers.push(setTimeout(() => voice.stop(options.release ?? 0.04), options.holdFor * 1000));
          }
        };
        if (options.delay) this.timers.push(setTimeout(play, options.delay * 1000));
        else play();
      });
    },
    synth: (change, options = {}) => {
      const patch = defaultPatch();
      change(patch);
      const t = this.engine.ctx.currentTime + 0.01;
      for (const midi of options.notes ?? [48]) {
        const voice = startSynthVoice(this.engine.ctx, this.engine.input, patch, midi, 0.9, t);
        voice.release(t + (options.hold ?? 0.7));
        this.synthVoices.push(voice);
      }
    },
  };

  constructor() {
    const fragment = inject(ActivatedRoute).snapshot.fragment;
    afterNextRender(() => fragment && this.scrollTo(fragment, 'instant'));
    inject(DestroyRef).onDestroy(() => this.stopDemos());
  }

  protected scrollTo(id: string, behavior: ScrollBehavior = 'smooth'): void {
    this.host.nativeElement.querySelector(`#help-${id}`)?.scrollIntoView({ behavior, block: 'start' });
  }

  protected listen(item: Item): void {
    this.stopDemos();
    this.playing.set(item.entry.id);
    item.entry.listen?.(this.demo, item.value());
    this.timers.push(setTimeout(() => this.playing.set(null), 1200));
  }

  private stopDemos(): void {
    this.timers.forEach(clearTimeout);
    this.voices.forEach((v) => v.stop(0.03));
    this.synthVoices.forEach((v) => v.kill());
    this.timers = [];
    this.voices = [];
    this.synthVoices = [];
  }

  private buffer(which: DemoSample): Promise<AudioBuffer> {
    let buffer = this.buffers.get(which);
    if (!buffer) {
      buffer = renderSound(DEMO_SOUNDS[which]);
      this.buffers.set(which, buffer);
    }
    return buffer;
  }
}
