import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemType, TaskAction, TaskKind, TaskStatus } from '../../../generated/prisma/enums';
import type { Prisma } from '../../../generated/prisma/client';
import { actorOf } from '../../core/auth/actor.type';
import type { Principal } from '../../core/auth/principal.type';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TaskHistoryService } from '../../core/task-history/task-history.service';
import type { FieldChange } from '../../core/types/revision.types';
import { UsersService } from '../users/users.service';
import type { CreateCommentDto } from './dto/create-comment.dto';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { TasksQueryDto } from './dto/tasks-query.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';

export interface TaskHistoryView {
  id: string;
  action: TaskAction;
  note: string | null;
  changes: FieldChange[] | null;
  userId: string;
  /**
   * Straight off the row — a **snapshot**, never a directory lookup. A history
   * entry that changed its name when someone was renamed would be a bug.
   */
  userName: string;
  createdAt: Date;
}

export interface TaskView {
  id: string;
  itemId: string;
  /**
   * Resolved at read time, never stored — a stored copy would go stale on the
   * very transition the task exists to request. `null` only if the item vanished
   * without going through delete(), which the cascade makes unreachable.
   */
  itemType: ItemType | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignedToUserId: string;
  /** Resolved LIVE from the directory — current state shows who someone is now. */
  assignedToName: string;
  createdByUserId: string;
  createdByName: string;
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  /** Detail read only. Oldest first; comments and events interleaved. */
  history?: TaskHistoryView[];
  /** Detail read only. See {@link TasksService.deriveReturnTo}. */
  returnTo?: { userId: string; displayName: string } | null;
}

/** What the assignee must be able to do for a task to be finishable by them. */
type RequiredCapability = 'publish' | 'write';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly history: TaskHistoryService,
  ) {}

  /**
   * What the assignee of a task in this state must be able to do.
   *
   * Keyed on the PAIR, not on `kind` alone. `kind` is the goal ("get this
   * published"); `status` plus assignee is where it currently sits. A RETURNED
   * REVIEW_PUBLISH task is parked with a cataloguer who needs to *fix* it, and
   * the naive kind-only rule would reject the return with a 400 — see the
   * return-flow tests in §18 and in tasks.service.spec.ts, which exist to catch
   * exactly that regression if someone "tidies" this back to a switch on `kind`.
   */
  private requiredCapability(kind: TaskKind, status: TaskStatus): RequiredCapability {
    if (kind === TaskKind.REVIEW_PUBLISH) {
      return status === TaskStatus.OPEN || status === TaskStatus.IN_PROGRESS ? 'publish' : 'write';
    }
    return 'write';
  }

  /**
   * ADVISORY. Reads `user_profiles`, which lags Keycloak by up to one sync
   * interval, so it can reject an assignment the assignee's own token would
   * permit — hence the hint in the message. It must never be the thing standing
   * between someone and an action they are entitled to: the authoritative check
   * at publish time is assertCanTransition(), reading the JWT.
   */
  private async assertAssignable(
    userId: string,
    kind: TaskKind,
    status: TaskStatus,
  ): Promise<void> {
    const who = await this.users.assignability(userId);
    if (!who) {
      throw new BadRequestException(
        `Not a known user: ${userId}. If they were just added to Keycloak, run POST /api/users/sync.`,
      );
    }
    if (!who.isActive) {
      throw new BadRequestException(`User is not active and cannot be assigned work: ${userId}`);
    }

    const required = this.requiredCapability(kind, status);
    if (required === 'publish' && !who.canPublish) {
      throw new BadRequestException(
        `A ${kind} task in status ${status} needs an assignee who can publish (records:manage and drafts:manage). ` +
          `If their roles changed recently, run POST /api/users/sync.`,
      );
    }
    if (required === 'write' && !who.canWrite) {
      throw new BadRequestException(
        `A ${kind} task needs an assignee who can edit (drafts:manage or records:manage). ` +
          `If their roles changed recently, run POST /api/users/sync.`,
      );
    }
  }

  async create(dto: CreateTaskDto, principal: Principal): Promise<TaskView> {
    const kind = dto.kind ?? TaskKind.GENERAL;
    await this.assertAssignable(dto.assignedToUserId, kind, TaskStatus.OPEN);

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          itemId: dto.itemId,
          kind,
          title: dto.title,
          description: dto.description,
          assignedToUserId: dto.assignedToUserId,
          createdByUserId: principal.sub,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        },
      });

      await this.history.record(
        {
          taskId: created.id,
          itemId: created.itemId,
          action: TaskAction.CREATED,
          // Copied onto the log rather than referenced, so a later edit to the
          // task's description does not rewrite what was originally asked for.
          note: dto.description,
          changes: [
            { path: 'kind', before: null, after: kind },
            { path: 'assignedToUserId', before: null, after: dto.assignedToUserId },
          ],
          actor: actorOf(principal),
        },
        tx,
      );

      return created;
    });

    const [view] = await this.toViews([task]);
    return view;
  }

  async list(
    dto: TasksQueryDto,
    principal: Principal,
  ): Promise<{ total: number; tasks: TaskView[] }> {
    // All staff see all tasks: `assignedTo=me` is a filter, not a wall. This is
    // a small internal tool where the point is being able to see who a draft is
    // waiting on.
    //
    // An AND array rather than spread fragments: `itemId` and `itemIds` both
    // want the same key, and spreading would silently drop one instead of
    // applying both. Any number of fragments compose here.
    const where: Prisma.TaskWhereInput = {
      AND: [
        ...(dto.assignedTo ? [{ assignedToUserId: this.resolveMe(dto.assignedTo, principal) }] : []),
        ...(dto.createdBy ? [{ createdByUserId: this.resolveMe(dto.createdBy, principal) }] : []),
        ...(dto.itemId ? [{ itemId: dto.itemId }] : []),
        ...(dto.itemIds && dto.itemIds.length > 0 ? [{ itemId: { in: dto.itemIds } }] : []),
        ...(dto.status ? [{ status: dto.status }] : []),
        ...(dto.kind ? [{ kind: dto.kind }] : []),
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: dto.limit ?? 50,
        skip: dto.offset ?? 0,
      }),
    ]);

    // No history and no returnTo on a list: a list is for triage, and neither is
    // free — history is a second query and returnTo a directory lookup on top.
    return { total, tasks: await this.toViews(rows) };
  }

  async get(id: string): Promise<TaskView> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException(`Task not found: ${id}`);

    const history = await this.prisma.taskHistory.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    });

    const [view] = await this.toViews([task]);
    return {
      ...view,
      history: history.map(toHistoryView),
      returnTo: await this.deriveReturnTo(task, history),
    };
  }

  /**
   * What happened around an item, including tasks that no longer exist.
   *
   * This is the query the delete asymmetry exists to make possible: `tasks` dies
   * with the item, `task_history` does not, and its rows carry `itemId` so they
   * stay answerable afterwards.
   */
  async historyForItem(
    itemId: string,
    limit: number,
    offset: number,
  ): Promise<{ total: number; history: Array<TaskHistoryView & { taskId: string }> }> {
    const where = { itemId };
    const [total, rows] = await Promise.all([
      this.prisma.taskHistory.count({ where }),
      this.prisma.taskHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return { total, history: rows.map((r) => ({ ...toHistoryView(r), taskId: r.taskId })) };
  }

  async update(id: string, dto: UpdateTaskDto, principal: Principal): Promise<TaskView> {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Task not found: ${id}`);

    // Assignee and creator are the two people the task is *about*; records:manage
    // is the unstick-it-when-someone-is-on-leave escape hatch.
    const mayEdit =
      existing.assignedToUserId === principal.sub ||
      existing.createdByUserId === principal.sub ||
      principal.scopes.has('records:manage');
    if (!mayEdit) {
      throw new ForbiddenException('Only the assignee, the creator or records:manage may edit a task');
    }

    const nextStatus = dto.status ?? existing.status;
    const nextKind = dto.kind ?? existing.kind;
    const nextAssignee = dto.assignedToUserId ?? existing.assignedToUserId;

    // CANCELLED is the "never mind" state and is terminal: reopening it would
    // hide that something was abandoned. COMPLETED deliberately is NOT terminal
    // — COMPLETED -> RETURNED is a real workflow when a publish went out wrong.
    if (existing.status === TaskStatus.CANCELLED && nextStatus !== existing.status) {
      throw new BadRequestException('A cancelled task cannot change status. Open a new task instead.');
    }

    // RETURNED means "handed back to someone else with notes", so it is
    // meaningless without a new assignee. This does NOT fall out of the
    // capability guard below — a publisher also holds write, so returning a task
    // to yourself would otherwise pass. Stated explicitly for that reason.
    if (nextStatus === TaskStatus.RETURNED && existing.status !== TaskStatus.RETURNED) {
      if (!dto.assignedToUserId || dto.assignedToUserId === existing.assignedToUserId) {
        throw new BadRequestException(
          'Returning a task must reassign it: send status and assignedToUserId together.',
        );
      }
    }

    // Re-run against the RESULTING triple, not the incoming fields — promoting a
    // GENERAL task to REVIEW_PUBLISH while it sits with a cataloguer is a 400 for
    // the same reason creating it that way is.
    if (dto.assignedToUserId || dto.status || dto.kind) {
      await this.assertAssignable(nextAssignee, nextKind, nextStatus);
    }

    const changes = this.diff(existing, dto);
    const action = this.actionFor(existing, dto, changes);

    const enteringCompleted =
      nextStatus === TaskStatus.COMPLETED && existing.status !== TaskStatus.COMPLETED;
    const leavingCompleted =
      nextStatus !== TaskStatus.COMPLETED && existing.status === TaskStatus.COMPLETED;

    const task = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.kind ? { kind: dto.kind } : {}),
          ...(dto.assignedToUserId ? { assignedToUserId: dto.assignedToUserId } : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
          ...(enteringCompleted ? { completedAt: new Date() } : {}),
          ...(leavingCompleted ? { completedAt: null } : {}),
        },
      });

      // A PATCH that changes nothing writes no history — an audit log of
      // non-events is noise, and the GUI sends idempotent saves.
      if (action) {
        await this.history.record(
          {
            taskId: id,
            itemId: existing.itemId,
            action,
            note: dto.note,
            changes,
            actor: actorOf(principal),
          },
          tx,
        );
      }

      return updated;
    });

    const [view] = await this.toViews([task]);
    return view;
  }

  async addComment(
    id: string,
    dto: CreateCommentDto,
    principal: Principal,
  ): Promise<TaskHistoryView> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, itemId: true },
    });
    if (!task) throw new NotFoundException(`Task not found: ${id}`);

    // A comment is not a kind of object, it is one of the things that can happen
    // to a task — so it lands in the same log as everything else, and the detail
    // read interleaves it with the events chronologically.
    const row = await this.history.recordOne({
      taskId: id,
      itemId: task.itemId,
      action: TaskAction.COMMENTED,
      note: dto.body,
      actor: actorOf(principal),
    });
    return toHistoryView(row);
  }

  /**
   * Who the "return with notes" dialog should prefill as the next assignee.
   *
   * Derived, never stored: it is a fact about the history, and a column would be
   * one more thing to keep in step.
   *
   *  1. **the creator**, because RETURNED means "sent back to the requester"
   *     and the requester is whoever filed the task;
   *  2. failing that, whoever last handed the task to its current holder;
   *  3. failing that, `null` — the GUI shows an empty picker rather than a
   *     wrong default.
   *
   * Each candidate is skipped unless they are active, can write, and are not
   * already holding the task.
   *
   * **The creator comes first, and that ordering is the whole point.** An admin
   * unsticking a task — reassigning it between two publishers — is "who handed
   * it to me", but returning a REVIEW_PUBLISH task *to the admin* is wrong: the
   * person who fixes the author field is the cataloguer who asked for it to be
   * published. Ordering by last-handover instead would prefill the admin, which
   * is why this is computed in the backend rather than left to each client to
   * rediscover.
   *
   * Last-handover survives as a fallback for the case the creator cannot take it
   * back — they have left, or they are the one currently holding it.
   */
  private async deriveReturnTo(
    task: { assignedToUserId: string; createdByUserId: string },
    history: Array<{ userId: string; changes: unknown }>,
  ): Promise<{ userId: string; displayName: string } | null> {
    const handover = [...history]
      .reverse()
      .find((h) => fieldChangesOf(h.changes).some(
        (c) => c.path === 'assignedToUserId' && c.after === task.assignedToUserId,
      ));

    for (const candidate of [task.createdByUserId, handover?.userId]) {
      // Returning to the person already holding it is a no-op the API rejects.
      if (!candidate || candidate === task.assignedToUserId) continue;
      const who = await this.users.assignability(candidate);
      if (!who || !who.isActive || !who.canWrite) continue;

      const names = await this.users.resolveNames([candidate]);
      return { userId: candidate, displayName: names.get(candidate)! };
    }

    return null;
  }

  /** Every field this PATCH actually moves, for the history row's `changes`. */
  private diff(
    existing: {
      status: TaskStatus;
      kind: TaskKind;
      assignedToUserId: string;
      title: string;
      description: string | null;
      dueAt: Date | null;
    },
    dto: UpdateTaskDto,
  ): FieldChange[] {
    const changes: FieldChange[] = [];
    const add = (path: string, before: unknown, after: unknown) => {
      if (before !== after) changes.push({ path, before, after });
    };

    if (dto.status) add('status', existing.status, dto.status);
    if (dto.kind) add('kind', existing.kind, dto.kind);
    if (dto.assignedToUserId) add('assignedToUserId', existing.assignedToUserId, dto.assignedToUserId);
    if (dto.title !== undefined) add('title', existing.title, dto.title);
    if (dto.description !== undefined) add('description', existing.description, dto.description);
    if (dto.dueAt !== undefined) {
      add('dueAt', existing.dueAt?.toISOString() ?? null, dto.dueAt ?? null);
    }
    return changes;
  }

  /**
   * The single action that describes what the caller did.
   *
   * One user action produces one history row, so when a PATCH moves several
   * things at once the most specific label wins: a return is RETURNED, not
   * STATUS_CHANGED plus ASSIGNED. Everything that moved is in `changes` either
   * way, so nothing is lost by labelling it once.
   */
  private actionFor(
    existing: { status: TaskStatus },
    dto: UpdateTaskDto,
    changes: FieldChange[],
  ): TaskAction | null {
    if (changes.length === 0 && !dto.note) return null;

    const statusChanged = changes.some((c) => c.path === 'status');
    if (statusChanged && dto.status === TaskStatus.RETURNED) return TaskAction.RETURNED;
    if (statusChanged) return TaskAction.STATUS_CHANGED;
    if (changes.some((c) => c.path === 'assignedToUserId')) return TaskAction.ASSIGNED;
    if (changes.length > 0) return TaskAction.UPDATED;

    // A note with no field change is a comment made through PATCH.
    return TaskAction.COMMENTED;
  }

  private resolveMe(value: string, principal: Principal): string {
    return value === 'me' ? principal.sub : value;
  }

  /**
   * Build views for a batch of task rows.
   *
   * Two things are deliberately batched across the WHOLE response rather than
   * done per row, because either one per-row is an N+1 that no test would catch:
   *
   *  - names: one resolveNames() for every assignee and creator
   *  - itemType: two findMany calls, NOT resolveCollection() per row (2 queries each)
   *
   * Names here are LIVE, unlike the snapshots on task_history. A live work item
   * should show who someone *is now* — a renamed assignee showing their old name
   * on an open task is a bug, where on a history row it is the whole point. The
   * governing rule: snapshot for a specific row, directory for a group of rows.
   */
  private async toViews(
    rows: Array<{
      id: string;
      itemId: string;
      kind: TaskKind;
      title: string;
      description: string | null;
      status: TaskStatus;
      assignedToUserId: string;
      createdByUserId: string;
      dueAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      completedAt: Date | null;
    }>,
  ): Promise<TaskView[]> {
    const userIds = [
      ...rows.map((r) => r.assignedToUserId),
      ...rows.map((r) => r.createdByUserId),
    ];
    const itemIds = [...new Set(rows.map((r) => r.itemId))];

    const [names, drafts, records] = await Promise.all([
      this.users.resolveNames(userIds),
      this.prisma.draft.findMany({ where: { id: { in: itemIds } }, select: { id: true } }),
      this.prisma.record.findMany({ where: { id: { in: itemIds } }, select: { id: true } }),
    ]);

    const itemTypes = new Map<string, ItemType>();
    for (const d of drafts) itemTypes.set(d.id, ItemType.DRAFT);
    for (const r of records) itemTypes.set(r.id, ItemType.RECORD);

    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemType: itemTypes.get(r.itemId) ?? null,
      kind: r.kind,
      title: r.title,
      description: r.description,
      status: r.status,
      assignedToUserId: r.assignedToUserId,
      assignedToName: names.get(r.assignedToUserId)!,
      createdByUserId: r.createdByUserId,
      createdByName: names.get(r.createdByUserId)!,
      dueAt: r.dueAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      completedAt: r.completedAt,
    }));
  }
}

/** `changes` is JSON on the way out of Prisma; narrow it once, here. */
function fieldChangesOf(changes: unknown): FieldChange[] {
  return Array.isArray(changes) ? (changes as FieldChange[]) : [];
}

function toHistoryView(row: {
  id: string;
  action: TaskAction;
  note: string | null;
  changes: unknown;
  userId: string;
  userName: string;
  createdAt: Date;
}): TaskHistoryView {
  return {
    id: row.id,
    action: row.action,
    note: row.note,
    changes: row.changes === null ? null : fieldChangesOf(row.changes),
    userId: row.userId,
    // Off the row. Never resolveNames() — see the interface comment.
    userName: row.userName,
    createdAt: row.createdAt,
  };
}
