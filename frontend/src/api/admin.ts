import { api } from 'src/boot/axios';
import type { FileAttachment, RecordMetadata } from './search';

// ---------------------------------------------------------------------------
// Shared enums (mirror backend prisma enums)
// ---------------------------------------------------------------------------

export type VisibilityStatus = 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
export type ItemType = 'RECORD' | 'DRAFT';

export const VISIBILITY_STATUSES: VisibilityStatus[] = ['PUBLIC', 'PRIVATE', 'HIDDEN'];

// ---------------------------------------------------------------------------
// Items — mirrors backend items.controller.ts
// ---------------------------------------------------------------------------

export interface ItemStats {
  records: Record<VisibilityStatus, number>;
  drafts: Record<VisibilityStatus, number>;
}

export async function getItemStats(): Promise<ItemStats> {
  const { data } = await api.get<ItemStats>('/items/stats');
  return data;
}

export async function createItem(params: {
  visibilityStatus: VisibilityStatus;
  targetState: ItemType;
  metadata?: Partial<RecordMetadata>;
}): Promise<void> {
  await api.post('/items', params);
}

export async function updateItem(
  id: string,
  params: { visibilityStatus?: VisibilityStatus; metadata?: Partial<RecordMetadata> },
): Promise<void> {
  await api.patch(`/items/${id}`, params);
}

export async function deleteItems(ids: string[]): Promise<void> {
  await api.delete('/items', { data: { ids } });
}

export async function transitionItems(ids: string[], targetState: ItemType): Promise<void> {
  await api.post('/items/transition', { ids, targetState });
}

// ---------------------------------------------------------------------------
// Files — mirrors backend files.controller.ts
// ---------------------------------------------------------------------------

export async function listFiles(itemId: string): Promise<FileAttachment[]> {
  const { data } = await api.get<FileAttachment[]>(`/files/${itemId}`);
  return data;
}

export async function uploadFiles(itemId: string, files: File[]): Promise<unknown> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const { data } = await api.post(`/files/upload/${itemId}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteFile(fileId: string): Promise<void> {
  await api.delete(`/files/${fileId}`);
}

export async function downloadFile(fileId: string, filename: string): Promise<void> {
  const { data } = await api.get<Blob>(`/files/${fileId}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Import — mirrors backend cobiss-import.controller.ts / import.controller.ts
// ---------------------------------------------------------------------------

export interface ImportJobProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: { id: string; reason: string }[];
}

export interface ImportJobStatus {
  jobId: string;
  source: string;
  state: string;
  requestedAt: string;
  progress: ImportJobProgress | null;
  failedReason: string | null;
  finishedAt: string | null;
}

export async function importCobiss(params: {
  ids: string[];
  target: ItemType;
  visibilityStatus: VisibilityStatus;
}): Promise<{ jobId: string }> {
  const { data } = await api.post<{ jobId: string }>('/import/cobiss', params);
  return data;
}

export async function getImportJobStatus(jobId: string): Promise<ImportJobStatus> {
  const { data } = await api.get<ImportJobStatus>(`/import/jobs/${jobId}`);
  return data;
}
