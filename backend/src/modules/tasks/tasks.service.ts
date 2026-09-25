import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ItemType, TaskAction, TaskKind, TaskStatus } from '../../../generated/prisma/enums';
import type { Prisma, Task } from '../../../generated/prisma/client';
import { actorOf } from '../../core/auth/actor.type';
import type { Principal } from '../../core/auth/principal.type';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TaskHistoryService } from '../../core/task-history/task-history.service';
import type { FieldChange } from '../../core/types/revision.types';
import { ItemsService } from '../items/items.service';
import { UsersService } from '../users/users.service';
import type { CancelTaskDto } from './dto/cancel-task.dto';
import type { CompleteTaskDto } from './dto/complete-task.dto';
import type { CreateCommentDto } from './dto/create-comment.dto';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { ReassignTaskDto } from './dto/reassign-task.dto';
import type { ReturnTaskDto } from './dto/return-task.dto';
import type { TasksQueryDto } from './dto/tasks-query.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import {
  CAPABILITY_TEXT,
  initialStack,
  NEXT_STAGES,
  popForReturn,
  push,
  requiredCapability,
  stackOf,
} from './task-workflow';

/** The root client or a `$transaction` client. */
type Db = PrismaService | Prisma.TransactionClient;

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

/** Who and which stage "Return" would send the task to. */
export interface ReturnTarget {
  userId: string;
  displayName: string;
  kind: TaskKind;
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
  /** The current stage. */
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
  /** How the task reached its holder: CREATED, ADVANCED, RETURNED or ASSIGNED. */
  lastHandoff: TaskAction;
  /** Detail read only. Oldest first; comments and events interleaved. */
  history?: TaskHistoryView[];
  /** Detail read only. `null` = Return is not possible. See {@link TasksService.returnTarget}. */
  returnTarget?: ReturnTarget | null;
}

/**
 * Task workflow v2 — docs/shared/plans/task-workflow-v2.md.
 *
 * A task is OPEN until it ends; its `kind` is the stage it is in. Every state
 * change has its own method (complete / return / reassign / cancel), each one
 * transaction writing exactly one history row labelled with that action. PATCH
 * edits details only. The stack arithmetic and the assignee rule live in
 * `task-workflow.ts`, which has no I/O.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly history: TaskHistoryService,
    private readonly items: ItemsService,
    private readonly access: ResourceAccessService,
  ) {}

  /**
   * ADVISORY. Reads `user_profiles`, which lags Keycloak by up to one sync
   * interval, so it can reject an assignment the assignee's own token would
   * permit — hence the hint in the message. It must never be the thing standing
   * between someone and an action they are entitled to: the authoritative check
   * at publish time is assertCanTransition(), reading the JWT.
   */
  private async assertAssignable(userId: string, kind: TaskKind, itemType: ItemType): Promise<void> {
    const who = await this.users.assignability(userId);
    if (!who) {
      throw new BadRequestException(
        `Not a known user: ${userId}. If they were just added to Keycloak, run POST /api/users/sync.`,
      );
    }
    if (!who.isActive) {
      throw new BadRequestException(`User is not active and cannot be assigned work: ${userId}`);
    }

    const required = requiredCapability(kind, itemType);
    if (!who[required]) {
      throw new BadRequestException(
        `A ${kind} task on a ${itemType} needs an assignee who can ${CAPABILITY_TEXT[required]}. ` +
          `If their roles changed recently, run POST /api/users/sync.`,
      );
    }
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(dto: CreateTaskDto, principal: Principal): Promise<TaskView> {
    const kind = dto.kind ?? TaskKind.GENERAL;
    await this.assertNoOpenTask(dto.itemId);
    await this.assertAssignable(dto.assignedToUserId, kind, await this.itemTypeOf(dto.itemId));

    let task: Task;
    try {
      task = await this.prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            itemId: dto.itemId,
            kind,
            title: dto.title,
            description: dto.description,
            assignedToUserId: dto.assignedToUserId,
            createdByUserId: principal.sub,
            dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
            handoffs: initialStack(principal.sub, dto.assignedToUserId, kind),
            lastHandoff: TaskAction.CREATED,
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
    } catch (e) {
      // Lost the race to `tasks_one_open_per_item`: answer exactly like the
      // pre-check would have, naming the task that won.
      if (isUniqueViolation(e)) await this.assertNoOpenTask(dto.itemId);
      throw e;
    }

    const [view] = await this.toViews([task]);
    return view;
  }

  /**
   * At most one open task per item. The partial unique index enforces it; this
   * turns the common case into a 409 that names the task in the way.
   */
  private async assertNoOpenTask(itemId: string): Promise<void> {
    const open = await this.prisma.task.findFirst({
      where: { itemId, status: TaskStatus.OPEN },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ITEM_HAS_OPEN_TASK',
        message: 'This item already has an open task. Finish, reassign or cancel it first.',
        taskId: open.id,
      });
    }
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

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
        ...(dto.returned === true ? [{ lastHandoff: TaskAction.RETURNED }] : []),
        ...(dto.returned === false ? [{ lastHandoff: { not: TaskAction.RETURNED } }] : []),
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

    // No history and no returnTarget on a list: a list is for triage, and
    // neither is free — history is a second query and returnTarget a directory
    // lookup on top.
    return { total, tasks: await this.toViews(rows) };
  }

  async get(id: string): Promise<TaskView> {
    const task = await this.findOrThrow(id);

    const history = await this.prisma.taskHistory.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    });

    const [view] = await this.toViews([task]);
    return {
      ...view,
      history: history.map(toHistoryView),
      returnTarget: await this.returnTarget(task),
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

  /**
   * Where "Return" would send the task: the next entry down the handoff stack,
   * person and stage (`popForReturn`). Read straight off the stack — the
   * derivation from history that v1 needed is gone. `null` when the task is not
   * open or was never handed over, which is exactly when POST /return is a 400.
   *
   * No eligibility check: if the previous holder has since left, the return
   * itself says so, and the dialog lets the caller pick someone else.
   */
  private async returnTarget(task: Task): Promise<ReturnTarget | null> {
    if (task.status !== TaskStatus.OPEN) return null;
    const target = popForReturn(stackOf(task), task.kind);
    if (!target) return null;

    const names = await this.users.resolveNames([target.userId]);
    return { userId: target.userId, displayName: names.get(target.userId)!, kind: target.kind };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Finish the current stage. What that means depends on the stage:
   *
   * - GENERAL without `next` → COMPLETED. With `next` → moves to `next.kind`
   *   (FIX_METADATA or REVIEW_PUBLISH) with `next.assignedToUserId`, who may be
   *   the caller → ADVANCED.
   * - FIX_METADATA → `next` required, REVIEW_PUBLISH only → ADVANCED.
   * - REVIEW_PUBLISH on a DRAFT → publishes it through ItemsService.transition(),
   *   the same path and checks as any publish (the save check included).
   *   The transition's observer closes this task and writes CLOSED_ON_PUBLISH
   *   with the note, so a task-driven publish and any other publish share one
   *   closing path. Any failure rolls the whole thing back: the task stays OPEN.
   * - REVIEW_PUBLISH on a RECORD → COMPLETED as "reviewed" (typically after a
   *   FIX_METADATA on a published record): nothing to publish.
   *
   * Assignee or `records:manage`. Publishing additionally needs the caller's
   * OWN token to allow it — the directory is not asked.
   */
  async complete(id: string, dto: CompleteTaskDto, principal: Principal): Promise<TaskView> {
    const task = await this.findOrThrow(id);
    assertOpen(task);
    assertMayWork(task, principal, 'complete');

    assertNextAllowed(task.kind, dto);

    if (task.kind === TaskKind.REVIEW_PUBLISH) {
      if ((await this.itemTypeOf(task.itemId)) === ItemType.DRAFT) {
        this.access.assertCanTransition(principal);
        await this.items.transition([task.itemId], ItemType.RECORD, actorOf(principal), {
          note: dto.note,
        });
        return this.view(await this.findOrThrow(id));
      }
    }

    return this.act(id, principal, async (tx, current) => {
      assertMayWork(current, principal, 'complete');
      assertNextAllowed(current.kind, dto);

      const reviewedOnly = current.kind === TaskKind.REVIEW_PUBLISH;
      if (reviewedOnly && (await this.itemTypeOf(current.itemId, tx)) !== ItemType.RECORD) {
        // Became a review of a draft since the read above: completing it now
        // would skip the publish.
        throw new ConflictException('The task changed while you were completing it. Reload and try again.');
      }

      if (!dto.next) {
        // GENERAL with nothing to hand on, or REVIEW_PUBLISH on a published record.
        return {
          data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
          action: TaskAction.COMPLETED,
          note: dto.note,
          changes: [
            { path: 'status', before: current.status, after: TaskStatus.COMPLETED },
            // Tells the log apart from a publish: the item was already a record.
            ...(reviewedOnly ? [{ path: 'outcome', before: null, after: 'ALREADY_PUBLISHED' }] : []),
          ],
        };
      }

      const next = dto.next;
      await this.assertAssignable(
        next.assignedToUserId,
        next.kind,
        await this.itemTypeOf(current.itemId, tx),
      );
      return {
        data: {
          kind: next.kind,
          assignedToUserId: next.assignedToUserId,
          handoffs: push(stackOf(current), next.assignedToUserId, next.kind),
          lastHandoff: TaskAction.ADVANCED,
        },
        action: TaskAction.ADVANCED,
        note: dto.note,
        changes: moved(current, next.kind, next.assignedToUserId),
      };
    });
  }

  /**
   * Back one step: the previous holder gets the task back, in the stage they
   * had it (see `popForReturn`). `assignedToUserId` overrides the person, not
   * the stage. The note is required by the DTO.
   *
   * Assignee or `records:manage`.
   */
  async returnTask(id: string, dto: ReturnTaskDto, principal: Principal): Promise<TaskView> {
    return this.act(id, principal, async (tx, current) => {
      assertMayWork(current, principal, 'return');

      const target = popForReturn(stackOf(current), current.kind, dto.assignedToUserId);
      if (!target) {
        throw new BadRequestException(
          'This task was never handed over, so there is nobody to return it to. Cancel or complete it instead.',
        );
      }
      if (target.userId === current.assignedToUserId && target.kind === current.kind) {
        throw new BadRequestException('Returning it there would leave the task where it is.');
      }
      await this.assertAssignable(target.userId, target.kind, await this.itemTypeOf(current.itemId, tx));

      return {
        data: {
          kind: target.kind,
          assignedToUserId: target.userId,
          handoffs: target.stack,
          lastHandoff: TaskAction.RETURNED,
        },
        action: TaskAction.RETURNED,
        note: dto.note,
        changes: moved(current, target.kind, target.userId),
      };
    });
  }

  /**
   * Same stage, different person — never the caller, never the current holder.
   * Pushes, so a return from the new holder comes back to whoever handed it on.
   *
   * Assignee, creator or `records:manage`.
   */
  async reassign(id: string, dto: ReassignTaskDto, principal: Principal): Promise<TaskView> {
    return this.act(id, principal, async (tx, current) => {
      assertMayManage(current, principal, 'reassign');

      if (dto.assignedToUserId === principal.sub) {
        throw new BadRequestException('You cannot reassign a task to yourself.');
      }
      if (dto.assignedToUserId === current.assignedToUserId) {
        throw new BadRequestException('The task is already assigned to that person.');
      }
      await this.assertAssignable(
        dto.assignedToUserId,
        current.kind,
        await this.itemTypeOf(current.itemId, tx),
      );

      return {
        data: {
          assignedToUserId: dto.assignedToUserId,
          handoffs: push(stackOf(current), dto.assignedToUserId, current.kind),
          lastHandoff: TaskAction.ASSIGNED,
        },
        action: TaskAction.ASSIGNED,
        note: dto.note,
        changes: moved(current, current.kind, dto.assignedToUserId),
      };
    });
  }

  /** CANCELLED is terminal. Assignee, creator or `records:manage`. */
  async cancel(id: string, dto: CancelTaskDto, principal: Principal): Promise<TaskView> {
    return this.act(id, principal, async (_tx, current) => {
      assertMayManage(current, principal, 'cancel');
      return {
        data: { status: TaskStatus.CANCELLED },
        action: TaskAction.CANCELLED,
        note: dto.note,
        changes: [{ path: 'status', before: current.status, after: TaskStatus.CANCELLED }],
      };
    });
  }

  /**
   * One action = one transaction = one history row. Locks the task row first:
   * two people returning the same task at once must not both pop the stack.
   */
  private async act(
    id: string,
    principal: Principal,
    decide: (
      tx: Prisma.TransactionClient,
      current: Task,
    ) => Promise<{
      data: Prisma.TaskUpdateInput;
      action: TaskAction;
      note?: string;
      changes: FieldChange[];
    }>,
  ): Promise<TaskView> {
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "tasks" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.task.findUnique({ where: { id } });
      if (!current) throw new NotFoundException(`Task not found: ${id}`);
      assertOpen(current);

      const { data, action, note, changes } = await decide(tx, current);
      const updated = await tx.task.update({ where: { id }, data });
      await this.history.record(
        { taskId: id, itemId: current.itemId, action, note, changes, actor: actorOf(principal) },
        tx,
      );
      return updated;
    });

    return this.view(task);
  }

  // ─── Details and comments ─────────────────────────────────────────────────

  /**
   * Title, description, due date. Where the task is (status, stage, assignee)
   * moves only through the action routes — the DTO rejects those fields with a
   * pointer to them.
   */
  async updateDetails(id: string, dto: UpdateTaskDto, principal: Principal): Promise<TaskView> {
    const existing = await this.findOrThrow(id);
    assertMayManage(existing, principal, 'edit');

    const changes = diffDetails(existing, dto);

    const task = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
        },
      });

      // A PATCH that changes nothing writes no history — an audit log of
      // non-events is noise, and the GUI sends idempotent saves.
      if (changes.length > 0) {
        await this.history.record(
          {
            taskId: id,
            itemId: existing.itemId,
            action: TaskAction.UPDATED,
            changes,
            actor: actorOf(principal),
          },
          tx,
        );
      }

      return updated;
    });

    return this.view(task);
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findOrThrow(id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException(`Task not found: ${id}`);
    return task;
  }

  /** DRAFT or RECORD, as it is now. Tasks die with their item, so a miss is a 404. */
  private async itemTypeOf(itemId: string, db: Db = this.prisma): Promise<ItemType> {
    const [draft, record] = await Promise.all([
      db.draft.findUnique({ where: { id: itemId }, select: { id: true } }),
      db.record.findUnique({ where: { id: itemId }, select: { id: true } }),
    ]);
    if (draft) return ItemType.DRAFT;
    if (record) return ItemType.RECORD;
    throw new NotFoundException(`Item not found: ${itemId}`);
  }

  private async view(task: Task): Promise<TaskView> {
    const [view] = await this.toViews([task]);
    return view;
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
  private async toViews(rows: Task[]): Promise<TaskView[]> {
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
      lastHandoff: r.lastHandoff,
    }));
  }
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** Which `next` the current stage allows — see CompleteTaskDto. */
function assertNextAllowed(kind: TaskKind, dto: CompleteTaskDto): void {
  if (kind === TaskKind.REVIEW_PUBLISH && dto.next) {
    throw new BadRequestException(
      'A REVIEW_PUBLISH task has no next stage: completing it publishes the item. Leave out next.',
    );
  }
  if (kind === TaskKind.FIX_METADATA && !dto.next) {
    throw new BadRequestException(
      'Completing a FIX_METADATA task hands it on for publishing: send next: { kind: "REVIEW_PUBLISH", assignedToUserId }.',
    );
  }
  if (dto.next && !NEXT_STAGES[kind].includes(dto.next.kind)) {
    throw new BadRequestException(
      `A ${kind} task can move on to ${NEXT_STAGES[kind].join(' or ')}, not ${dto.next.kind}.`,
    );
  }
}

/** COMPLETED and CANCELLED are terminal — there is no reopen in v2. */
function assertOpen(task: { status: TaskStatus }): void {
  if (task.status !== TaskStatus.OPEN) {
    throw new BadRequestException(
      `This task is ${task.status} and can no longer change. File a new task instead.`,
    );
  }
}

/**
 * Complete and return: the work is the assignee's. `records:manage` is the
 * unstick-it-when-someone-is-on-leave escape hatch.
 */
function assertMayWork(task: { assignedToUserId: string }, principal: Principal, verb: string): void {
  if (task.assignedToUserId !== principal.sub && !principal.scopes.has('records:manage')) {
    throw new ForbiddenException(`Only the assignee or records:manage may ${verb} a task`);
  }
}

/**
 * Reassign, cancel and edit: assignee and creator are the two people the task
 * is *about*; `records:manage` is the escape hatch.
 */
function assertMayManage(
  task: { assignedToUserId: string; createdByUserId: string },
  principal: Principal,
  verb: string,
): void {
  const may =
    task.assignedToUserId === principal.sub ||
    task.createdByUserId === principal.sub ||
    principal.scopes.has('records:manage');
  if (!may) {
    throw new ForbiddenException(`Only the assignee, the creator or records:manage may ${verb} a task`);
  }
}

/** The `changes` of a handover: whichever of stage and holder actually moved. */
function moved(
  current: { kind: TaskKind; assignedToUserId: string },
  kind: TaskKind,
  assignedToUserId: string,
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (kind !== current.kind) changes.push({ path: 'kind', before: current.kind, after: kind });
  if (assignedToUserId !== current.assignedToUserId) {
    changes.push({ path: 'assignedToUserId', before: current.assignedToUserId, after: assignedToUserId });
  }
  return changes;
}

/** Every detail this PATCH actually moves, for the history row's `changes`. */
function diffDetails(
  existing: { title: string; description: string | null; dueAt: Date | null },
  dto: UpdateTaskDto,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const add = (path: string, before: unknown, after: unknown) => {
    if (before !== after) changes.push({ path, before, after });
  };

  if (dto.title !== undefined) add('title', existing.title, dto.title);
  if (dto.description !== undefined) add('description', existing.description, dto.description);
  if (dto.dueAt !== undefined) {
    add('dueAt', existing.dueAt?.toISOString() ?? null, dto.dueAt ?? null);
  }
  return changes;
}

/** Prisma's unique-constraint violation, without importing the runtime error class. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
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

