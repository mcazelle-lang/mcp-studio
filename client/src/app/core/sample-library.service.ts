import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AudioEngineService } from './audio-engine.service';
import { Sample, SampleSource } from './models';

const API = '/api/samples';

@Injectable({ providedIn: 'root' })
export class SampleLibraryService {
  private readonly http = inject(HttpClient);
  private readonly engine = inject(AudioEngineService);
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();

  readonly samples = signal<Sample[]>([]);
  readonly loaded = signal(false);
  readonly byId = computed(() => new Map(this.samples().map((s) => [s.id, s])));

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.samples.set(await firstValueFrom(this.http.get<Sample[]>(API)));
    } finally {
      this.loaded.set(true);
    }
  }

  audioUrl(id: string): string {
    return `${API}/${id}/audio`;
  }

  /** Décode (une seule fois) l'audio d'un sample. */
  getBuffer(id: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(id);
    if (!buffer) {
      buffer = firstValueFrom(this.http.get(this.audioUrl(id), { responseType: 'arraybuffer' })).then((data) =>
        this.engine.decode(data),
      );
      buffer.catch(() => this.buffers.delete(id));
      this.buffers.set(id, buffer);
    }
    return buffer;
  }

  async upload(
    file: Blob,
    options: { name: string; source: SampleSource; duration?: number; filename?: string; buffer?: AudioBuffer },
  ): Promise<Sample> {
    const form = new FormData();
    const ext = file.type.includes('wav') ? 'wav' : 'bin';
    form.append('name', options.name);
    form.append('source', options.source);
    if (options.duration != null) form.append('duration', String(options.duration));
    form.append('file', file, options.filename ?? `${options.name}.${ext}`);

    const sample = await firstValueFrom(this.http.post<Sample>(API, form));
    if (options.buffer) this.buffers.set(sample.id, Promise.resolve(options.buffer));
    this.samples.update((list) => [sample, ...list]);
    return sample;
  }

  async rename(id: string, name: string): Promise<void> {
    const updated = await firstValueFrom(this.http.patch<Sample>(`${API}/${id}`, { name }));
    this.samples.update((list) => list.map((s) => (s.id === id ? updated : s)));
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${API}/${id}`));
    this.buffers.delete(id);
    this.samples.update((list) => list.filter((s) => s.id !== id));
  }
}
