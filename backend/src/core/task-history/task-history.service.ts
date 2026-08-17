import { Injectable } from '@nestjs/common';
import { TaskAction } from '../../../generated/prisma/enums';
import type { Prisma } from '../../../generated/prisma/client';
import type { Actor } from '../auth/actor.type';
import type { FieldChange } from '../types/revision.types';
import { PrismaService } from '../prisma/prisma.service';

/** The root client or a `$transaction` client — callers pass whichever they hold. */
type TaskHistoryWriter = PrismaService | Prisma.TransactionClient;

export interface TaskHistoryInput {
  taskId: string;
  /** Denormalised from the task so the row survives the task and the item. */
  itemId: string;
  action: TaskAction;
  /** What a human reads: the return reason, the comment body. */
  note?: string;
  changes?: FieldChange[];
  /** Id and display name travel together — the name is snapshotted, see {@link Actor}. */
  actor: Actor;
}

/**
 * Append-only log of what happened to a task.
 *
 * Deliberately mirrors {@link RevisionsService} down to the `tx` parameter,
 * because it is the same idea applied to a different row: current state in one
 * table, an immutable record of how it got there in another.
 *
 * There is no `update` and no `delete` on purpose, and no `recordDetached`
 * either — unlike file and relation writes, every task mutation is already
 * transactional, so a caller always has a `tx` to pass and never has cause to
 * write history outside one.
 */
@Injectable()
export class TaskHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append history rows.
   *
   * **Pass the transaction client.** History that is not written in the same
   * transaction as the change can disagree with it, and a log that disagrees
   * with the task is worse than no log — the same argument
   * `RevisionsService.record()` makes for items.
   */
  async record(
    inputs: TaskHistoryInput | TaskHistoryInput[],
    tx?: TaskHistoryWriter,
  ): Promise<void> {
    // `changes`/`note` are omitted rather than set to null when empty, which
    // keeps Prisma out of its DbNull/JsonNull dance on the JSON column.
    const rows = (Array.isArray(inputs) ? inputs : [inputs]).map((i) => ({
      taskId: i.taskId,
      itemId: i.itemId,
      action: i.action,
      ...(i.note ? { note: i.note } : {}),
      ...(i.changes && i.changes.length > 0 ? { changes: i.changes } : {}),
      userId: i.actor.userId,
      userName: i.actor.userName,
    }));
    if (rows.length === 0) return;

    await (tx ?? this.prisma).taskHistory.createMany({ data: rows });
  }

  /**
   * Append one row and return it.
   *
   * `createMany` cannot return the created rows, and a caller that needs the row
   * back — `POST /tasks/:id/comments` renders it in the response — would
   * otherwise have to re-query for "the most recent row by this author", which
   * is a race dressed up as a lookup.
   */
  async recordOne(input: TaskHistoryInput, tx?: TaskHistoryWriter) {
    return (tx ?? this.prisma).taskHistory.create({
      data: {
        taskId: input.taskId,
        itemId: input.itemId,
        action: input.action,
        ...(input.note ? { note: input.note } : {}),
        ...(input.changes && input.changes.length > 0 ? { changes: input.changes } : {}),
        userId: input.actor.userId,
        userName: input.actor.userName,
      },
    });
  }
}
