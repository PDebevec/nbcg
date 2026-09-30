import type { Task, TaskHistoryEntry, TaskKind } from 'src/api/tasks';

// ---------------------------------------------------------------------------
// Who may do what to a task — mirrors the backend's table (reference.md →
// Tasks). UI shaping only: the API's 403 stays the authority.
//
//   complete, return          assignee · records:manage
//   reassign, cancel, details assignee · creator · records:manage
// ---------------------------------------------------------------------------

export interface TaskPermissions {
  /** The task is OPEN — nothing can be done to a completed or cancelled one. */
  open: boolean;
  canComplete: boolean;
  canReturn: boolean;
  /** Reassign, cancel, edit details. */
  canManage: boolean;
}

export function taskPermissions(
  task: Pick<Task, 'status' | 'assignedToUserId' | 'createdByUserId'> | null | undefined,
  me: string | undefined,
  canManageRecords: boolean,
): TaskPermissions {
  if (!task || task.status !== 'OPEN') {
    return { open: false, canComplete: false, canReturn: false, canManage: false };
  }
  const isAssignee = !!me && task.assignedToUserId === me;
  const isCreator = !!me && task.createdByUserId === me;
  return {
    open: true,
    canComplete: isAssignee || canManageRecords,
    canReturn: isAssignee || canManageRecords,
    canManage: isAssignee || isCreator || canManageRecords,
  };
}

/** What the Complete button does in each stage — the i18n key suffix under `admin.tasks.complete.label`. */
export type CompleteMode = 'general' | 'handOn' | 'publish' | 'confirm';

export function completeMode(task: Pick<Task, 'kind' | 'itemType'>): CompleteMode {
  if (task.kind === 'GENERAL') return 'general';
  if (task.kind === 'FIX_METADATA') return 'handOn';
  return task.itemType === 'RECORD' ? 'confirm' : 'publish';
}

/** The stage a history row moved the task to, when it changed one. */
export function kindChange(entry: TaskHistoryEntry): TaskKind | undefined {
  const change = entry.changes?.find((c) => c.path === 'kind');
  return typeof change?.after === 'string' ? (change.after as TaskKind) : undefined;
}

/** The user a history row moved the task to, when it changed hands. */
export function assigneeChange(entry: TaskHistoryEntry): string | undefined {
  const change = entry.changes?.find((c) => c.path === 'assignedToUserId');
  return typeof change?.after === 'string' ? change.after : undefined;
}

/** The note a returned task came back with: the latest RETURNED row, if that is how the task got here. */
export function returnNote(
  task: Pick<Task, 'status' | 'lastHandoff'>,
  history: TaskHistoryEntry[],
): TaskHistoryEntry | undefined {
  if (task.status !== 'OPEN' || task.lastHandoff !== 'RETURNED') return undefined;
  return [...history].reverse().find((entry) => entry.action === 'RETURNED');
}
