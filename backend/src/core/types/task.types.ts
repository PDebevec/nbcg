import type { TaskKind } from '../../../generated/prisma/enums';

/**
 * One entry of `tasks.handoffs`: someone who held the task, and in which stage.
 *
 * `kind` is `null` only on the bottom entry of a task someone filed for a
 * colleague — the requester asked for the work but never held a stage. A return
 * to them resolves a stage then (REVIEW_PUBLISH becomes FIX_METADATA, anything
 * else stays) and writes it here.
 */
export interface TaskHandoff {
  userId: string;
  kind: TaskKind | null;
}

/** Bottom = the requester, top = the current holder. See docs/shared/plans/task-workflow-v2.md. */
export type TaskHandoffStack = TaskHandoff[];
