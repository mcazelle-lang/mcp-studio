import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AudioEngineService, Voice } from '../../core/audio-engine.service';
import { encodeWav, formatDuration, sliceBuffer } from '../../core/audio-utils';
import { describeError } from '../../core/http-errors';
import { KitService } from '../../core/kit.service';
import { Sample, SampleSource, defaultPlaybackSettings, padLabel } from '../../core/models';
import { MAX_RECORDING_SECONDS, RecorderService } from '../../core/recorder.service';
import { SampleLibraryService } from '../../core/sample-library.service';
import { Waveform } from '../../shared/waveform';

interface Draft {
  buffer: AudioBuffer;
  source: SampleSource;
}

type Filter = 'all' | SampleSource;

@Component({
  selector: 'app-samples',
  imports: [Waveform],
  templateUrl: './samples.html',
  styleUrl: './samples.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SamplesView {
  protected readonly recorder = inject(RecorderService);
  protected readonly library = inject(SampleLibraryService);
  protected readonly kit = inject(KitService);
  private readonly engine = inject(AudioEngineService);

  protected readonly maxSeconds = MAX_RECORDING_SECONDS;
  protected readonly formatDuration = formatDuration;
  protected readonly selectedLabel = computed(() => padLabel(this.kit.selected()));

  protected readonly message = signal<{ text: string; error?: boolean } | null>(null);
  protected readonly busy = signal(false);

  // Éditeur (après un enregistrement ou pour retoucher un sample existant)
  protected readonly draft = signal<Draft | null>(null);
  protected readonly draftName = signal('');
  protected readonly trimStart = signal(0);
  protected readonly trimEnd = signal(1);
  protected readonly normalize = signal(true);
  protected readonly assignAfterSave = signal(true);
  protected readonly playhead = signal<number | null>(null);
  protected readonly draftDuration = computed(() => {
    const d = this.draft();
    return d ? d.buffer.duration * (this.trimEnd() - this.trimStart()) : 0;
  });

  // Bibliothèque
  protected readonly filter = signal<Filter>('all');
  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'recording', label: 'Micro' },
    { value: 'import', label: 'Imports' },
    { value: 'synth', label: 'Synthé' },
    { value: 'preset', label: 'Kits' },
    { value: 'take', label: 'Clavier' },
  ];
  protected readonly visibleSamples = computed(() => {
    const f = this.filter();
    return this.library.samples().filter((s) => f === 'all' || s.source === f);
  });
  protected readonly playingId = signal<string | null>(null);
  protected readonly renamingId = signal<string | null>(null);

  private voice?: Voice;
  private frame = 0;

  constructor() {
    this.recorder.onAutoStop = () => void this.toggleRecord();
    inject(DestroyRef).onDestroy(() => {
      this.stopPreview();
      if (this.recorder.recording()) void this.recorder.stop();
      this.recorder.onAutoStop = undefined;
    });
  }

  private notify(text: string, error = false): void {
    this.message.set({ text, error });
  }

  // ---------- Enregistrement ----------

  protected async toggleRecord(): Promise<void> {
    try {
      if (this.recorder.recording()) {
        const buffer = await this.recorder.stop();
        this.openDraft(buffer, 'recording', `Rec ${new Date().toLocaleTimeString('fr-FR')}`);
      } else {
        this.message.set(null);
        this.stopPreview();
        await this.recorder.start();
      }
    } catch (err) {
      this.notify(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Accès au micro refusé. Autorisez-le dans les réglages du navigateur.'
          : `Enregistrement impossible : ${(err as Error).message}`,
        true,
      );
    }
  }

  private openDraft(buffer: AudioBuffer, source: SampleSource, name: string): void {
    this.stopPreview();
    this.draft.set({ buffer, source });
    this.draftName.set(name);
    this.trimStart.set(0);
    this.trimEnd.set(1);
  }

  protected async editSample(sample: Sample): Promise<void> {
    try {
      const buffer = await this.library.getBuffer(sample.id);
      this.openDraft(buffer, sample.source, `${sample.name} (edit)`);
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      this.notify('Impossible de lire ce sample.', true);
    }
  }

  protected previewDraft(): void {
    const draft = this.draft();
    if (!draft) return;
    if (this.playingId() === 'draft') return this.stopPreview();
    this.stopPreview();

    const settings = { ...defaultPlaybackSettings(), volume: 1, start: this.trimStart() };
    const region = this.trimEnd() - this.trimStart();
    const seconds = draft.buffer.duration * region;
    this.voice = this.engine.playBuffer(draft.buffer, settings);
    this.playingId.set('draft');

    const t0 = this.engine.ctx.currentTime;
    const tick = () => {
      const progress = (this.engine.ctx.currentTime - t0) / seconds;
      if (progress >= 1) return this.stopPreview();
      this.playhead.set(this.trimStart() + progress * region);
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  protected async saveDraft(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.busy()) return;
    this.stopPreview();
    this.busy.set(true);
    try {
      const buffer = sliceBuffer(this.engine.ctx, draft.buffer, this.trimStart(), this.trimEnd(), this.normalize());
      const name = this.draftName().trim() || 'Sample';
      const sample = await this.library.upload(encodeWav(buffer), {
        name,
        source: draft.source,
        duration: buffer.duration,
        filename: `${name}.wav`,
        buffer,
      });
      if (this.assignAfterSave()) this.kit.assign(this.kit.selected(), sample.id);
      this.draft.set(null);
      this.notify(this.assignAfterSave() ? `« ${name} » enregistré sur le pad ${this.selectedLabel()}.` : `« ${name} » enregistré.`);
    } catch (err) {
      this.notify(`Sauvegarde impossible : ${describeError(err)}`, true);
    } finally {
      this.busy.set(false);
    }
  }

  protected discardDraft(): void {
    this.stopPreview();
    this.draft.set(null);
  }

  // ---------- Import ----------

  protected async importFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    this.busy.set(true);
    let imported = 0;
    const failed: string[] = [];
    let last: Sample | undefined;
    for (const file of files) {
      try {
        // On décode avant l'envoi pour vérifier que le navigateur sait lire ce format.
        const buffer = await this.engine.decode(await file.arrayBuffer());
        last = await this.library.upload(file, {
          name: file.name.replace(/\.[^.]+$/, ''),
          source: 'import',
          duration: buffer.duration,
          filename: file.name,
          buffer,
        });
        imported++;
      } catch {
        failed.push(file.name);
      }
    }
    this.busy.set(false);

    if (imported === 1 && last && this.assignAfterSave() && !this.kit.selectedPad().sampleId) {
      this.kit.assign(this.kit.selected(), last.id);
    }
    if (failed.length) this.notify(`Format non reconnu : ${failed.join(', ')}`, true);
    else this.notify(`${imported} sample${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}.`);
  }

  // ---------- Bibliothèque ----------

  protected async togglePlay(sample: Sample): Promise<void> {
    if (this.playingId() === sample.id) return this.stopPreview();
    this.stopPreview();
    try {
      const buffer = await this.library.getBuffer(sample.id);
      this.voice = this.engine.playBuffer(buffer, { ...defaultPlaybackSettings(), volume: 1 });
      this.playingId.set(sample.id);
      const id = sample.id;
      setTimeout(() => this.playingId() === id && this.playingId.set(null), buffer.duration * 1000);
    } catch {
      this.notify('Impossible de lire ce sample.', true);
    }
  }

  private stopPreview(): void {
    cancelAnimationFrame(this.frame);
    this.voice?.stop();
    this.voice = undefined;
    this.playingId.set(null);
    this.playhead.set(null);
  }

  protected assignToPad(sample: Sample): void {
    this.kit.assign(this.kit.selected(), sample.id);
    this.notify(`« ${sample.name} » affecté au pad ${this.selectedLabel()}.`);
  }

  protected async commitRename(sample: Sample, name: string): Promise<void> {
    this.renamingId.set(null);
    if (!name.trim() || name.trim() === sample.name) return;
    try {
      await this.library.rename(sample.id, name.trim());
    } catch {
      this.notify('Renommage impossible.', true);
    }
  }

  protected async remove(sample: Sample): Promise<void> {
    if (!confirm(`Supprimer « ${sample.name} » ?`)) return;
    if (this.playingId() === sample.id) this.stopPreview();
    try {
      await this.library.remove(sample.id);
      this.kit.unassignSample(sample.id);
    } catch {
      this.notify('Suppression impossible.', true);
    }
  }

  protected padsUsing(sample: Sample): string {
    return this.kit
      .kit()
      .pads.map((p, i) => (p.sampleId === sample.id ? padLabel(i) : null))
      .filter(Boolean)
      .join(' ');
  }

  protected sourceLabel(source: SampleSource): string {
    return { recording: 'Micro', import: 'Import', synth: 'Synthé', preset: 'Kit', take: 'Clavier' }[source];
  }
}
