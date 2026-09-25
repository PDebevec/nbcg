/**
 * Task workflow v2 — the pure part: the handoff stack and who may hold which
 * stage. No I/O, so every rule here is unit-tested without a database
 * (task-workflow.spec.ts). Contract: docs/shared/plans/task-workflow-v2.md.
 */
import { ItemType, TaskKind } from '../../../generated/prisma/enums';
import type { TaskHandoff, TaskHandoffStack } from '../../core/types/task.types';

// ─── Who can hold which stage ───────────────────────────────────────────────

/** What the holder of a stage must be able to do. Keys of `Assignability`. */
export type Capability = 'canWrite' | 'canEditDrafts' | 'canEditRecords' | 'canPublish';

/** For the 400 message: what the assignee is missing, in words and scopes. */
export const CAPABILITY_TEXT: Record<Capability, string> = {
  canWrite: 'edit (drafts:manage or records:manage)',
  canEditDrafts: 'edit drafts (drafts:manage)',
  canEditRecords: 'edit published records (records:manage)',
  canPublish: 'publish (records:manage and drafts:manage)',
};

/**
 * What the holder of a stage must be able to do, for the item as it is NOW.
 *
 * Keyed on `(kind, itemType)`. v1 keyed it on `(kind, status)` because a
 * RETURNED review task sat with a cataloguer; in v2 a returned review task
 * becomes FIX_METADATA, so the status no longer matters but the item does: a
 * cataloguer can fix a draft but cannot edit a published record.
 */
export function requiredCapability(kind: TaskKind, itemType: ItemType): Capability {
  switch (kind) {
    case TaskKind.REVIEW_PUBLISH:
      return 'canPublish';
    case TaskKind.FIX_METADATA:
      return itemType === ItemType.RECORD ? 'canEditRecords' : 'canEditDrafts';
    default:
      return 'canWrite';
  }
}

/** Which stages "complete with next" may move to from each stage. */
export const NEXT_STAGES: Record<TaskKind, TaskKind[]> = {
  [TaskKind.GENERAL]: [TaskKind.FIX_METADATA, TaskKind.REVIEW_PUBLISH],
  [TaskKind.FIX_METADATA]: [TaskKind.REVIEW_PUBLISH],
  [TaskKind.REVIEW_PUBLISH]: [],
};

// ─── The handoff stack ──────────────────────────────────────────────────────

/**
 * A new task's stack: `[{creator, —}, {assignee, kind}]`, or just
 * `[{assignee, kind}]` when someone files a task for themselves.
 */
export function initialStack(
  createdByUserId: string,
  assignedToUserId: string,
  kind: TaskKind,
): TaskHandoffStack {
  const holder: TaskHandoff = { userId: assignedToUserId, kind };
  return createdByUserId === assignedToUserId
    ? [holder]
    : [{ userId: createdByUserId, kind: null }, holder];
}

/**
 * The stored stack, made safe to act on. The top must be the current holder in
 * the current stage; if it is not (an empty column, a hand-edited row), the
 * current holder is put back on top rather than letting a return send the task
 * somewhere the stack never agreed to.
 */
export function stackOf(task: {
  handoffs: unknown;
  createdByUserId: string;
  assignedToUserId: string;
  kind: TaskKind;
}): TaskHandoffStack {
  const stored = Array.isArray(task.handoffs)
    ? (task.handoffs as TaskHandoff[]).filter(
        (h) => typeof h?.userId === 'string' && (h.kind === null || typeof h.kind === 'string'),
      )
    : [];
  if (stored.length === 0) {
    return initialStack(task.createdByUserId, task.assignedToUserId, task.kind);
  }

  const top = stored[stored.length - 1];
  if (top.userId !== task.assignedToUserId || top.kind !== task.kind) {
    return [...stored, { userId: task.assignedToUserId, kind: task.kind }];
  }
  return stored;
}

/** Complete-with-next and reassign: the new holder goes on top. */
export function push(stack: TaskHandoffStack, userId: string, kind: TaskKind): TaskHandoffStack {
  return [...stack, { userId, kind }];
}

/**
 * The stage a return lands in. A stored stage wins — the previous holder gets
 * the task back in the stage they had it. The requester's bottom entry has no
 * stage (they asked for the work, never held it): REVIEW_PUBLISH becomes
 * FIX_METADATA there (the requester must fix what the reviewer found), anything
 * else stays.
 */
export function returnStage(entry: TaskHandoff, currentKind: TaskKind): TaskKind {
  if (entry.kind) return entry.kind;
  return currentKind === TaskKind.REVIEW_PUBLISH ? TaskKind.FIX_METADATA : currentKind;
}

/**
 * Where a return goes: pop the current holder; the new top is the target,
 * person AND stage. `overrideUserId` replaces the person but not the stage.
 * The resolved stage is written into the new top, so a later return to the
 * requester lands in the stage they actually held.
 *
 * `null` when the stack has one entry — there is nobody to return it to.
 */
export function popForReturn(
  stack: TaskHandoffStack,
  currentKind: TaskKind,
  overrideUserId?: string,
): { stack: TaskHandoffStack; userId: string; kind: TaskKind } | null {
  if (stack.length < 2) return null;

  const rest = stack.slice(0, -1);
  const top = rest[rest.length - 1];
  const userId = overrideUserId ?? top.userId;
  const kind = returnStage(top, currentKind);
  return { stack: [...rest.slice(0, -1), { userId, kind }], userId, kind };
}
