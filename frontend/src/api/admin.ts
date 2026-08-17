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
  params: {
    visibilityStatus?: VisibilityStatus;
    metadata?: Partial<RecordMetadata>;
    expectedVersion: number;
  },
): Promise<{ version: number } | undefined> {
  const { data } = await api.patch<{ version: number } | ''>(`/items/${id}`, params);
  // The backend returns an empty body when the payload contained no changes.
  return data && typeof data === 'object' ? data : undefined;
}

export function isVersionConflict(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 409;
}

/** Extract the server's current version from a 409 message ("expected 2, current 3"). */
export function conflictCurrentVersion(err: unknown): number | undefined {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data
    ?.message;
  const match = /current (\d+)/.exec(String(message ?? ''));
  return match ? Number(match[1]) : undefined;
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
// History + statistics — mirrors backend items.controller.ts / stats.controller.ts
// All four endpoints share the /admin guard (records:view:hidden + drafts:view:hidden).
// ---------------------------------------------------------------------------

export type ChangeAction =
  | 'CREATE'
  | 'UPDATE'
  | 'PUBLISH'
  | 'UNPUBLISH'
  | 'VISIBILITY_CHANGE'
  | 'FILE_ADDED'
  | 'FILE_REMOVED'
  | 'RELATION_ADDED'
  | 'RELATION_REMOVED'
  | 'DELETE';

export type MetricKind = 'VIEW' | 'DOWNLOAD';

export interface FieldChange {
  /** Metadata path (`title`, `authors[0].familyName`) or a synthetic one (`files[<id>]`, `children[<id>]`, `visibilityStatus`, `itemType`). */
  path: string;
  before: unknown;
  after: unknown;
}

export interface ItemRevision {
  id: string;
  itemId: string;
  /** Item version AFTER the change. Two revisions can share one (file/relation writes don't bump it) — never key or order by it. */
  version: number;
  action: ChangeAction;
  /** null for CREATE and DELETE. */
  changes: FieldChange[] | null;
  /** Raw Keycloak sub, or the literal "system" for COBISS imports. */
  userId: string;
  /** Display-name snapshot, written at the time of the change. */
  userName: string;
  createdAt: string;
}

export interface ItemHistory {
  itemId: string;
  total: number;
  limit: number;
  offset: number;
  revisions: ItemRevision[];
}

/** Days with no activity are absent from a series, not zero — charts must fill the gaps. */
export interface DayCount {
  day: string;
  count: number;
}

/** Inclusive UTC day window, YYYY-MM-DD. Echoed back so a caller relying on defaults knows what it got. */
export interface StatsRange {
  from: string;
  to: string;
}

export interface StatsOverview {
  range: StatsRange;
  /** Current snapshot — ignores the date range. */
  totals: ItemStats;
  activity: {
    totals: { created: number; published: number; updated: number; deleted: number };
    created: DayCount[];
    published: DayCount[];
    updated: DayCount[];
    deleted: DayCount[];
  };
  usage: {
    totals: { views: number; downloads: number };
    views: DayCount[];
    downloads: DayCount[];
  };
}

export interface UserTotals {
  userId: string;
  /** The user's name *now*, resolved from the directory (not the snapshot). */
  displayName: string;
  created: number;
  published: number;
  /** Everything else — metadata edits, visibility flips, file and relation writes. */
  edited: number;
  deleted: number;
  total: number;
}

export interface UserStats {
  range: StatsRange;
  limit: number;
  users: UserTotals[];
}

export interface TopItem {
  itemId: string;
  /** null when the item has since been deleted — the counts are still real. */
  title: string | null;
  itemType: ItemType | null;
  count: number;
}

export interface TopFile {
  fileId: string;
  itemId: string;
  /** null when the attachment has since been deleted. */
  filename: string | null;
  count: number;
}

export interface TopItems {
  range: StatsRange;
  limit: number;
  mostViewed: TopItem[];
  mostDownloaded: TopItem[];
  /** Only populated for DOWNLOAD (or when `metric` is omitted). */
  topFiles: TopFile[];
}

export async function getItemHistory(
  itemId: string,
  params?: { limit?: number; offset?: number },
): Promise<ItemHistory> {
  const { data } = await api.get<ItemHistory>(`/items/${itemId}/history`, { params });
  return data;
}

/** An out-of-range request (from > to, wider than 366 days, bad format) is a 400, not an empty result. */
export async function getStatsOverview(params?: {
  from?: string;
  to?: string;
}): Promise<StatsOverview> {
  const { data } = await api.get<StatsOverview>('/stats/overview', { params });
  return data;
}

export async function getUserStats(params?: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<UserStats> {
  const { data } = await api.get<UserStats>('/stats/users', { params });
  return data;
}

export async function getTopItems(params?: {
  from?: string;
  to?: string;
  metric?: MetricKind;
  limit?: number;
}): Promise<TopItems> {
  const { data } = await api.get<TopItems>('/stats/items/top', { params });
  return data;
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
