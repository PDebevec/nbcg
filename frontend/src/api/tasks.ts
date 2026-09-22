import { api } from 'src/boot/axios';
import type { FieldChange, ItemType } from './admin';

// ---------------------------------------------------------------------------
// Task delegation — mirrors backend tasks.controller.ts / tasks.service.ts
//
// A task is a handoff between two members of staff about one item: "this is
// ready, please publish it", "the author field is wrong". One task ping-pongs
// for its whole life (returning it reassigns the same task, it never opens a
// second one) and everything that happens to it lands in an append-only log.
//
// There is deliberately no `expectedVersion` on tasks — two people editing one
// task is not a real collision — so none of the 409 handling from admin.ts
// applies here.
// ---------------------------------------------------------------------------

export type TaskKind = 'REVIEW_PUBLISH' | 'FIX_METADATA' | 'GENERAL';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'RETURNED' | 'COMPLETED' | 'CANCELLED';
export type TaskAction =
  | 'CREATED'
  | 'ASSIGNED'
  | 'STATUS_CHANGED'
  | 'RETURNED'
  | 'COMMENTED'
  | 'UPDATED'
  | 'CLOSED_ON_PUBLISH';

export const TASK_KINDS: TaskKind[] = ['REVIEW_PUBLISH', 'FIX_METADATA', 'GENERAL'];
export const TASK_STATUSES: TaskStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'RETURNED',
  'COMPLETED',
  'CANCELLED',
];

/** Statuses in which a task still sits in someone's inbox. */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'RETURNED'];

export interface TaskHistoryEntry {
  id: string;
  action: TaskAction;
  /** The return reason or the comment body. */
  note: string | null;
  /** Same shape as item revision diffs. `assignedToUserId` changes carry raw user ids. */
  changes: FieldChange[] | null;
  userId: string;
  /**
   * A SNAPSHOT, frozen at write time. Render as-is and never re-resolve it
   * through the directory: "Ana returned this" must keep saying that after a
   * rename. The backend has a test asserting this stays frozen.
   */
  userName: string;
  createdAt: string;
}

/** An entry from the per-item audit view, which spans every task ever filed against the item. */
export interface ItemTaskHistoryEntry extends TaskHistoryEntry {
  taskId: string;
}

export interface Task {
  id: string;
  itemId: string;
  /** Resolved server-side at read time. `null` only if the item vanished outside the normal delete path. */
  itemType: ItemType | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignedToUserId: string;
  /** CURRENT name from the directory, re-resolved on every read — safe to display. */
  assignedToName: string;
  createdByUserId: string;
  createdByName: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskDetail extends Task {
  /** Oldest first; comments and system events interleaved in one stream. */
  history: TaskHistoryEntry[];
  /** Prefill for "return with notes": the requester, or null if there is nobody sensible. */
  returnTo: { userId: string; displayName: string } | null;
}

export interface TaskListResult {
  total: number;
  /** Sorted by createdAt descending. */
  tasks: Task[];
}

export interface ItemTaskHistoryResult {
  total: number;
  /** Sorted by createdAt descending. */
  history: ItemTaskHistoryEntry[];
}

export interface TaskListParams {
  /** A user id, or the literal `me`. A filter, not a wall: all staff see all tasks. */
  assignedTo?: string;
  createdBy?: string;
  itemId?: string;
  /** Comma-separated, max 200 — feeds the "has an open task" badge. */
  itemIds?: string;
  status?: TaskStatus;
  kind?: TaskKind;
  /** Default 50, max 200. */
  limit?: number;
  offset?: number;
}

export interface CreateTaskParams {
  itemId: string;
  /** Defaults to GENERAL server-side if omitted. */
  kind: TaskKind;
  /** 1–200 chars. */
  title: string;
  /** ≤ 5000 chars. */
  description?: string;
  assignedToUserId: string;
  dueAt?: string | null;
}

export interface PatchTaskParams {
  status?: TaskStatus;
  kind?: TaskKind;
  /** Required alongside `status: 'RETURNED'` — the server rejects either alone. */
  assignedToUserId?: string;
  title?: string;
  description?: string | null;
  dueAt?: string | null;
  /** Goes onto the history row this PATCH writes, not onto the task. This is how a return reason is recorded. */
  note?: string;
}

// ---------------------------------------------------------------------------
// The assignee rule, keyed on (kind, status) — the one rule the UI can get
// backwards. A REVIEW_PUBLISH task needs a publisher while it is with the
// reviewer, but once RETURNED it goes to whoever must fix it, who usually
// cannot publish. The server enforces the same rule; this only shapes the
// picker so the user does not meet a 400.
// ---------------------------------------------------------------------------

export type PickerCapability = 'publish' | 'staff';

export function pickerCapability(kind: TaskKind, status: TaskStatus): PickerCapability {
  const needsPublisher =
    kind === 'REVIEW_PUBLISH' && (status === 'OPEN' || status === 'IN_PROGRESS');
  return needsPublisher ? 'publish' : 'staff';
}

// ---------------------------------------------------------------------------
// Calls. All paths are relative to the axios baseURL of /api.
// ---------------------------------------------------------------------------

export async function createTask(params: CreateTaskParams): Promise<Task> {
  const { data } = await api.post<Task>('/tasks', params);
  return data;
}

export async function listTasks(params?: TaskListParams): Promise<TaskListResult> {
  const { data } = await api.get<TaskListResult>('/tasks', { params });
  return data;
}

export async function getTask(id: string): Promise<TaskDetail> {
  const { data } = await api.get<TaskDetail>(`/tasks/${id}`);
  return data;
}

/**
 * Returns the updated task without `history`/`returnTo` — re-fetch the detail
 * if you need them. A PATCH that changes nothing is a 200 with no history row.
 */
export async function patchTask(id: string, params: PatchTaskParams): Promise<Task> {
  const { data } = await api.patch<Task>(`/tasks/${id}`, params);
  return data;
}

/** Returns the new history entry — append it to the local `history[]`, no need to re-fetch. */
export async function addTaskComment(id: string, body: string): Promise<TaskHistoryEntry> {
  const { data } = await api.post<TaskHistoryEntry>(`/tasks/${id}/comments`, { body });
  return data;
}

/**
 * Every task-history entry ever written against an item, including entries
 * of tasks that no longer exist. Gated like item history (records:view:hidden
 * AND drafts:view:hidden), which every /admin visitor already holds.
 */
export async function getItemTaskHistory(
  itemId: string,
  params?: { limit?: number; offset?: number },
): Promise<ItemTaskHistoryResult> {
  const { data } = await api.get<ItemTaskHistoryResult>(`/tasks/item/${itemId}/history`, {
    params,
  });
  return data;
}

/** The backend's 400/403 messages are written for the user — surface them verbatim. */
export function apiErrorMessage(err: unknown): string | undefined {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
    ?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message ? String(message) : undefined;
}
