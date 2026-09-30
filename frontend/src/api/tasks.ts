import { api } from 'src/boot/axios';
import type { FieldChange, ItemType } from './admin';

// ---------------------------------------------------------------------------
// Task delegation — mirrors backend tasks.controller.ts / tasks.service.ts.
// Task workflow v2 (docs/shared/plans/task-workflow-v2.md).
//
// A task is a handoff between members of staff about one item. It is OPEN
// until it ends (COMPLETED or CANCELLED, both final); its `kind` is the STAGE
// it is in, and one task follows the item through the stages:
//
//   GENERAL → FIX_METADATA → REVIEW_PUBLISH
//
// State moves only through one route per action (complete / return / reassign
// / cancel); PATCH edits details. An item has at most one open task.
//
// There is deliberately no `expectedVersion` on tasks — two people editing one
// task is not a real collision — so none of the 409 handling from admin.ts
// applies here.
// ---------------------------------------------------------------------------

export type TaskKind = 'REVIEW_PUBLISH' | 'FIX_METADATA' | 'GENERAL';
export type TaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';
/** What last moved the task to its current holder. `RETURNED` = it came back. */
export type TaskHandoff = 'CREATED' | 'ADVANCED' | 'RETURNED' | 'ASSIGNED';
export type TaskAction =
  | 'CREATED'
  | 'ADVANCED'
  | 'ASSIGNED'
  | 'RETURNED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'COMMENTED'
  | 'UPDATED'
  | 'CLOSED_ON_PUBLISH'
  /** Legacy (v1) rows only — they stay in the log forever. */
  | 'STATUS_CHANGED';

/** In stage order. */
export const TASK_KINDS: TaskKind[] = ['GENERAL', 'FIX_METADATA', 'REVIEW_PUBLISH'];
export const TASK_STATUSES: TaskStatus[] = ['OPEN', 'COMPLETED', 'CANCELLED'];

/** Which stages "complete with next" may move to from each stage. */
export const NEXT_STAGES: Record<TaskKind, TaskKind[]> = {
  GENERAL: ['FIX_METADATA', 'REVIEW_PUBLISH'],
  FIX_METADATA: ['REVIEW_PUBLISH'],
  REVIEW_PUBLISH: [],
};

export interface TaskHistoryEntry {
  id: string;
  action: TaskAction;
  /** The return reason, the comment body, or the note given with an action. */
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
  /** The stage the task is in. */
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
  /** Set on COMPLETED, not on CANCELLED. */
  completedAt: string | null;
  lastHandoff: TaskHandoff;
}

/** Where Return would send the task: person AND stage. */
export interface ReturnTarget {
  userId: string;
  displayName: string;
  kind: TaskKind;
}

export interface TaskDetail extends Task {
  /** Oldest first; comments and system events interleaved in one stream. */
  history: TaskHistoryEntry[];
  /**
   * `null` when there is nobody to return to (the holder filed it for
   * themselves, or the task is closed). Not checked for eligibility: if that
   * person has since left, the return is a 400 and the dialog's person
   * override is the way out. It can be the caller.
   */
  returnTarget: ReturnTarget | null;
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
  /** Comma-separated, max 200 — feeds the "has an open task" marker. */
  itemIds?: string;
  status?: TaskStatus;
  kind?: TaskKind;
  /** `true` = came back (`lastHandoff` is RETURNED), `false` = anything else. */
  returned?: boolean;
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

/** Details only — a `status`, `kind`, `assignedToUserId` or `note` is a 400. */
export interface PatchTaskParams {
  title?: string;
  description?: string | null;
  dueAt?: string | null;
}

export interface CompleteTaskParams {
  note?: string;
  /**
   * Hand the same task on to the next stage instead of finishing it. Required
   * for FIX_METADATA, optional for GENERAL, a 400 for REVIEW_PUBLISH. The
   * assignee may be the caller.
   */
  next?: { kind: TaskKind; assignedToUserId: string };
}

// ---------------------------------------------------------------------------
// The assignee rule, keyed on (stage, item type). A cataloguer can fix a draft
// but cannot edit a published record, and only a publisher can hold a review.
// The server enforces the same rule; this only shapes the picker so the user
// does not meet a 400. For a return, pass the stage the task LANDS in.
// ---------------------------------------------------------------------------

export type PickerCapability = 'publish' | 'staff' | 'drafts' | 'records';

export function pickerCapability(kind: TaskKind, itemType: ItemType | null): PickerCapability {
  switch (kind) {
    case 'REVIEW_PUBLISH':
      return 'publish';
    case 'FIX_METADATA':
      return itemType === 'RECORD' ? 'records' : 'drafts';
    default:
      return 'staff';
  }
}

// ---------------------------------------------------------------------------
// Calls. All paths are relative to the axios baseURL of /api.
// ---------------------------------------------------------------------------

/** A `409 ITEM_HAS_OPEN_TASK` carries the blocking `taskId` — see `openTaskConflict()` in errors.ts. */
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

/** Title, description, due date. A PATCH that changes nothing is a 200 with no history row. */
export async function patchTask(id: string, params: PatchTaskParams): Promise<Task> {
  const { data } = await api.patch<Task>(`/tasks/${id}`, params);
  return data;
}

// The four actions answer with the task view, without `history` or
// `returnTarget` — reload the detail afterwards. On a COMPLETED / CANCELLED
// task each is a 400.

/**
 * Finish the current stage. Completing a REVIEW_PUBLISH task on a DRAFT
 * publishes the item (answer: `status: COMPLETED`, `itemType: RECORD`); the
 * save check runs first and a failure comes back as
 * `400 METADATA_VALIDATION_FAILED` with the task still open.
 */
export async function completeTask(id: string, params: CompleteTaskParams = {}): Promise<Task> {
  const { data } = await api.post<Task>(`/tasks/${id}/complete`, params);
  return data;
}

/** Back one step. `note` is required; `assignedToUserId` overrides the person, not the stage. */
export async function returnTask(
  id: string,
  params: { note: string; assignedToUserId?: string },
): Promise<Task> {
  const { data } = await api.post<Task>(`/tasks/${id}/return`, params);
  return data;
}

/** Same stage, different person — never the caller, never the current holder. */
export async function reassignTask(
  id: string,
  params: { assignedToUserId: string; note?: string },
): Promise<Task> {
  const { data } = await api.post<Task>(`/tasks/${id}/reassign`, params);
  return data;
}

/** Final: a cancelled task cannot be reopened. */
export async function cancelTask(id: string, params: { note?: string } = {}): Promise<Task> {
  const { data } = await api.post<Task>(`/tasks/${id}/cancel`, params);
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

export { apiErrorMessage } from './errors';
