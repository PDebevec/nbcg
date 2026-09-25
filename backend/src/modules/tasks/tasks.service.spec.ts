/**
 * TasksService, task workflow v2 — run against an in-memory fake of the few
 * Prisma calls it makes. End-to-end coverage (real DB, real tokens) is §18 of
 * api-test-suite.sh; these pin the rules that are easy to "simplify" into a bug
 * and run without a stack.
 *
 * The stack arithmetic itself is in task-workflow.spec.ts.
 */

// Loading the real modules would pull in the Prisma client, SeaweedFS, OpenSearch…
jest.mock('../../core/prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../core/task-history/task-history.service', () => ({ TaskHistoryService: class {} }));
jest.mock('../users/users.service', () => ({ UsersService: class {} }));
jest.mock('../items/items.service', () => ({ ItemsService: class {} }));

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TaskAction, TaskKind, TaskStatus } from '../../../generated/prisma/enums';
import type { Principal } from '../../core/auth/principal.type';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { TaskHandoffStack } from '../../core/types/task.types';
import { ReturnTaskDto } from './dto/return-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

// ─── Personas (directory facts, as UsersService.assignability() reports them) ─

const PUBLISHER = { isActive: true, canPublish: true, canWrite: true, canEditDrafts: true, canEditRecords: true };
const CATALOGUER = { isActive: true, canPublish: false, canWrite: true, canEditDrafts: true, canEditRecords: false };
const READER = { isActive: true, canPublish: false, canWrite: false, canEditDrafts: false, canEditRecords: false };
/** Not a real persona — pins that FIX_METADATA on a draft really asks for drafts:manage. */
const RECORDS_ONLY = { isActive: true, canPublish: false, canWrite: true, canEditDrafts: false, canEditRecords: true };

const DIRECTORY: Record<string, typeof PUBLISHER> = {
  editor: PUBLISHER,
  admin: PUBLISHER,
  editor2: PUBLISHER,
  cataloguer: CATALOGUER,
  cataloguer2: CATALOGUER,
  reader: READER,
  recordsOnly: RECORDS_ONLY,
  departed: { ...PUBLISHER, isActive: false },
};

const SCOPES: Record<string, string[]> = {
  editor: ['drafts:manage', 'records:manage'],
  editor2: ['drafts:manage', 'records:manage'],
  admin: ['drafts:manage', 'records:manage'],
  cataloguer: ['drafts:manage'],
  cataloguer2: ['drafts:manage'],
};

function as(user: string): Principal {
  return {
    sub: user,
    username: user,
    displayName: `name:${user}`,
    scopes: new Set(SCOPES[user] ?? []),
    isAnonymous: false,
  };
}

// ─── An in-memory world ───────────────────────────────────────────────────────

interface FakeTask {
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
  handoffs: TaskHandoffStack;
  lastHandoff: TaskAction;
}

function world(opts: { task?: Partial<FakeTask>; itemType?: 'DRAFT' | 'RECORD' } = {}) {
  const itemType = opts.itemType ?? 'DRAFT';
  let task: FakeTask | null = opts.task
    ? {
        id: 't1',
        itemId: 'item-1',
        kind: TaskKind.GENERAL,
        title: 'T',
        description: null,
        status: TaskStatus.OPEN,
        assignedToUserId: 'editor',
        createdByUserId: 'cataloguer',
        dueAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        handoffs: [],
        lastHandoff: TaskAction.CREATED,
        ...opts.task,
      }
    : null;
  const history: Array<{ action: TaskAction; note?: string; changes?: unknown[] }> = [];

  const db = {
    task: {
      findUnique: jest.fn(async () => (task ? { ...task } : null)),
      findFirst: jest.fn(async () => (task && task.status === TaskStatus.OPEN ? { id: task.id } : null)),
      create: jest.fn(async ({ data }: { data: Partial<FakeTask> }) => {
        task = { ...(data as FakeTask), id: 'new', status: TaskStatus.OPEN, createdAt: new Date() };
        return { ...task };
      }),
      update: jest.fn(async ({ data }: { data: Partial<FakeTask> }) => {
        task = { ...task!, ...data };
        return { ...task };
      }),
    },
    draft: {
      findUnique: jest.fn(async () => (itemType === 'DRAFT' ? { id: 'item-1' } : null)),
      findMany: jest.fn(async () => (itemType === 'DRAFT' ? [{ id: 'item-1' }] : [])),
    },
    record: {
      findUnique: jest.fn(async () => (itemType === 'RECORD' ? { id: 'item-1' } : null)),
      findMany: jest.fn(async () => (itemType === 'RECORD' ? [{ id: 'item-1' }] : [])),
    },
    taskHistory: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  const historyWriter = {
    record: jest.fn(async (rows: unknown) => {
      history.push(...([rows].flat() as typeof history));
    }),
  };
  const users = {
    assignability: jest.fn(async (id: string) => DIRECTORY[id] ?? null),
    resolveNames: jest.fn(async (ids: string[]) => new Map(ids.map((i) => [i, `name:${i}`]))),
  };
  // Stands in for transition() + its observer: publish, close the task.
  const items = {
    transition: jest.fn(async () => {
      if (task) task = { ...task, status: TaskStatus.COMPLETED, completedAt: new Date() };
      return [];
    }),
  };

  const service = new TasksService(
    db as never,
    users as never,
    historyWriter as never,
    items as never,
    new ResourceAccessService(db as never),
  );
  return {
    service,
    db,
    items,
    history,
    get task() {
      return task!;
    },
  };
}

/** `assertAssignable` is private; the matrix is the contract, not the signature. */
function assertAssignable(userId: string, kind: TaskKind, itemType: 'DRAFT' | 'RECORD') {
  const { service } = world();
  return (
    service as unknown as {
      assertAssignable(u: string, k: TaskKind, t: string): Promise<void>;
    }
  ).assertAssignable(userId, kind, itemType);
}

// ─── The guard ────────────────────────────────────────────────────────────────

describe('the (kind, itemType) assignee guard', () => {
  it.each([
    // [who, kind, item, ok]
    ['editor', TaskKind.REVIEW_PUBLISH, 'DRAFT', true],
    ['cataloguer', TaskKind.REVIEW_PUBLISH, 'DRAFT', false], // unfinishable: cannot publish
    ['cataloguer', TaskKind.REVIEW_PUBLISH, 'RECORD', false],
    ['cataloguer', TaskKind.FIX_METADATA, 'DRAFT', true],
    ['cataloguer', TaskKind.FIX_METADATA, 'RECORD', false], // cannot edit a published record
    ['editor', TaskKind.FIX_METADATA, 'RECORD', true],
    ['recordsOnly', TaskKind.FIX_METADATA, 'DRAFT', false],
    ['recordsOnly', TaskKind.FIX_METADATA, 'RECORD', true],
    ['cataloguer', TaskKind.GENERAL, 'RECORD', true],
    ['reader', TaskKind.GENERAL, 'DRAFT', false],
    ['reader', TaskKind.FIX_METADATA, 'DRAFT', false],
  ] as const)('%s for %s on a %s → %s', async (who, kind, item, ok) => {
    const result = assertAssignable(who, kind, item);
    if (ok) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow(BadRequestException);
  });

  it('says what is missing and how to fix a stale directory', async () => {
    await expect(assertAssignable('cataloguer', TaskKind.FIX_METADATA, 'RECORD')).rejects.toThrow(
      /edit published records \(records:manage\).*users\/sync/,
    );
    await expect(assertAssignable('nobody', TaskKind.GENERAL, 'DRAFT')).rejects.toThrow(/users\/sync/);
  });

  it('rejects a disabled or departed user even if their scopes would allow it', async () => {
    await expect(assertAssignable('departed', TaskKind.GENERAL, 'DRAFT')).rejects.toThrow(/not active/);
  });
});

// ─── Create ───────────────────────────────────────────────────────────────────

describe('create — one open task per item', () => {
  const dto = { itemId: 'item-1', title: 'T', assignedToUserId: 'editor', kind: TaskKind.REVIEW_PUBLISH };

  it('409 ITEM_HAS_OPEN_TASK naming the task in the way', async () => {
    const w = world({ task: { id: 'existing' } });
    const error = await w.service.create(dto, as('cataloguer')).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'ITEM_HAS_OPEN_TASK', taskId: 'existing' });
  });

  it('a lost race on the unique index is the same 409', async () => {
    const w = world();
    // Pre-check sees nothing; the insert then hits tasks_one_open_per_item.
    w.db.task.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' } as never);
    w.db.task.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    const error = await w.service.create(dto, as('cataloguer')).catch((e) => e);
    expect(error.getResponse()).toMatchObject({ code: 'ITEM_HAS_OPEN_TASK', taskId: 'winner' });
  });

  it('initialises the stack and lastHandoff, and writes one CREATED row', async () => {
    const w = world();
    const view = await w.service.create(dto, as('cataloguer'));
    expect(w.task.handoffs).toEqual([
      { userId: 'cataloguer', kind: null },
      { userId: 'editor', kind: TaskKind.REVIEW_PUBLISH },
    ]);
    expect(view.lastHandoff).toBe(TaskAction.CREATED);
    expect(w.history.map((h) => h.action)).toEqual([TaskAction.CREATED]);
  });
});

// ─── Complete ─────────────────────────────────────────────────────────────────

describe('complete — by stage', () => {
  it('GENERAL without next → COMPLETED, one COMPLETED row', async () => {
    const w = world({ task: { kind: TaskKind.GENERAL, assignedToUserId: 'cataloguer' } });
    const view = await w.service.complete('t1', { note: 'done' }, as('cataloguer'));
    expect(view.status).toBe(TaskStatus.COMPLETED);
    expect(view.completedAt).not.toBeNull();
    expect(w.history).toEqual([
      expect.objectContaining({ action: TaskAction.COMPLETED, note: 'done' }),
    ]);
  });

  it('GENERAL with next to yourself → moves stage, pushes, ADVANCED with only the kind change', async () => {
    const w = world({
      task: { kind: TaskKind.GENERAL, assignedToUserId: 'editor', createdByUserId: 'cataloguer' },
    });
    const view = await w.service.complete(
      't1',
      { next: { kind: TaskKind.FIX_METADATA, assignedToUserId: 'editor' } },
      as('editor'),
    );
    expect(view).toMatchObject({ status: 'OPEN', kind: 'FIX_METADATA', lastHandoff: 'ADVANCED' });
    expect(w.task.handoffs.slice(-2)).toEqual([
      { userId: 'editor', kind: TaskKind.GENERAL },
      { userId: 'editor', kind: TaskKind.FIX_METADATA },
    ]);
    expect(w.history).toEqual([
      expect.objectContaining({
        action: TaskAction.ADVANCED,
        changes: [{ path: 'kind', before: 'GENERAL', after: 'FIX_METADATA' }],
      }),
    ]);
  });

  it('FIX_METADATA without next → 400', async () => {
    const w = world({ task: { kind: TaskKind.FIX_METADATA, assignedToUserId: 'cataloguer' } });
    await expect(w.service.complete('t1', {}, as('cataloguer'))).rejects.toThrow(/REVIEW_PUBLISH/);
    expect(w.history).toEqual([]);
  });

  it('FIX_METADATA → REVIEW_PUBLISH for a non-publisher → 400 (the guard)', async () => {
    const w = world({ task: { kind: TaskKind.FIX_METADATA, assignedToUserId: 'cataloguer' } });
    await expect(
      w.service.complete(
        't1',
        { next: { kind: TaskKind.REVIEW_PUBLISH, assignedToUserId: 'cataloguer2' } },
        as('cataloguer'),
      ),
    ).rejects.toThrow(/publish/);
  });

  it('refuses a next stage the current one does not lead to', async () => {
    const general = world({ task: { kind: TaskKind.GENERAL } });
    await expect(
      general.service.complete('t1', { next: { kind: TaskKind.GENERAL, assignedToUserId: 'admin' } }, as('editor')),
    ).rejects.toThrow(BadRequestException);
    const fix = world({ task: { kind: TaskKind.FIX_METADATA } });
    await expect(
      fix.service.complete('t1', { next: { kind: TaskKind.FIX_METADATA, assignedToUserId: 'admin' } }, as('editor')),
    ).rejects.toThrow(BadRequestException);
    const review = world({ task: { kind: TaskKind.REVIEW_PUBLISH } });
    await expect(
      review.service.complete('t1', { next: { kind: TaskKind.REVIEW_PUBLISH, assignedToUserId: 'admin' } }, as('editor')),
    ).rejects.toThrow(/publishes the item/);
  });

  it('REVIEW_PUBLISH on a DRAFT publishes through transition(), carrying the note — and writes no row itself', async () => {
    const w = world({ task: { kind: TaskKind.REVIEW_PUBLISH, assignedToUserId: 'editor' } });
    const view = await w.service.complete('t1', { note: 'Looks good.' }, as('editor'));
    expect(w.items.transition).toHaveBeenCalledWith(
      ['item-1'],
      'RECORD',
      { userId: 'editor', userName: 'name:editor' },
      { note: 'Looks good.' },
    );
    // CLOSED_ON_PUBLISH is the observer's, inside transition(): one closing path.
    expect(w.history).toEqual([]);
    expect(view.status).toBe(TaskStatus.COMPLETED);
  });

  it('REVIEW_PUBLISH on a DRAFT: the caller\'s own token must allow publishing, even as the assignee', async () => {
    // The directory would never let a cataloguer hold this; a stale one might.
    const w = world({ task: { kind: TaskKind.REVIEW_PUBLISH, assignedToUserId: 'cataloguer' } });
    await expect(w.service.complete('t1', {}, as('cataloguer'))).rejects.toThrow(ForbiddenException);
    expect(w.items.transition).not.toHaveBeenCalled();
  });

  it('REVIEW_PUBLISH on a RECORD → COMPLETED as "reviewed", nothing published', async () => {
    const w = world({ itemType: 'RECORD', task: { kind: TaskKind.REVIEW_PUBLISH, assignedToUserId: 'editor' } });
    const view = await w.service.complete('t1', {}, as('editor'));
    expect(view.status).toBe(TaskStatus.COMPLETED);
    expect(w.items.transition).not.toHaveBeenCalled();
    expect(w.history).toEqual([
      expect.objectContaining({
        action: TaskAction.COMPLETED,
        changes: [
          { path: 'status', before: 'OPEN', after: 'COMPLETED' },
          { path: 'outcome', before: null, after: 'ALREADY_PUBLISHED' },
        ],
      }),
    ]);
  });

  it('only the assignee or records:manage may complete', async () => {
    const w = world({ task: { kind: TaskKind.GENERAL, assignedToUserId: 'cataloguer', createdByUserId: 'editor' } });
    await expect(w.service.complete('t1', {}, as('cataloguer2'))).rejects.toThrow(ForbiddenException);
    await expect(w.service.complete('t1', {}, as('admin'))).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('COMPLETED and CANCELLED are terminal', async () => {
    for (const status of [TaskStatus.COMPLETED, TaskStatus.CANCELLED]) {
      const w = world({ task: { status } });
      await expect(w.service.complete('t1', {}, as('editor'))).rejects.toThrow(/no longer change/);
      await expect(w.service.cancel('t1', {}, as('editor'))).rejects.toThrow(/no longer change/);
    }
  });
});

// ─── Return ───────────────────────────────────────────────────────────────────

describe('return — back one step', () => {
  const reviewFromCataloguer = {
    kind: TaskKind.REVIEW_PUBLISH,
    assignedToUserId: 'editor',
    createdByUserId: 'cataloguer',
    handoffs: [
      { userId: 'cataloguer', kind: null },
      { userId: 'editor', kind: TaskKind.REVIEW_PUBLISH },
    ],
  };

  it('to the requester from REVIEW_PUBLISH → their FIX_METADATA task; one RETURNED row with the note', async () => {
    const w = world({ task: reviewFromCataloguer });
    const view = await w.service.returnTask('t1', { note: 'Author is wrong.' }, as('editor'));
    expect(view).toMatchObject({
      assignedToUserId: 'cataloguer',
      kind: 'FIX_METADATA',
      lastHandoff: 'RETURNED',
      status: 'OPEN',
    });
    expect(w.task.handoffs).toEqual([{ userId: 'cataloguer', kind: TaskKind.FIX_METADATA }]);
    expect(w.history).toEqual([
      {
        taskId: 't1',
        itemId: 'item-1',
        action: TaskAction.RETURNED,
        note: 'Author is wrong.',
        changes: [
          { path: 'kind', before: 'REVIEW_PUBLISH', after: 'FIX_METADATA' },
          { path: 'assignedToUserId', before: 'editor', after: 'cataloguer' },
        ],
        actor: { userId: 'editor', userName: 'name:editor' },
      },
    ]);
  });

  it('locks the task row before reading it', async () => {
    const w = world({ task: reviewFromCataloguer });
    await w.service.returnTask('t1', { note: 'x' }, as('editor'));
    expect(String(w.db.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
  });

  it('with a person override: that person, the previous stage', async () => {
    const w = world({ task: reviewFromCataloguer });
    const view = await w.service.returnTask(
      't1',
      { note: 'Ana is on leave.', assignedToUserId: 'cataloguer2' },
      as('editor'),
    );
    expect(view).toMatchObject({ assignedToUserId: 'cataloguer2', kind: 'FIX_METADATA' });
  });

  it('a task that was never handed over cannot be returned', async () => {
    const w = world({
      task: { assignedToUserId: 'editor', createdByUserId: 'editor', handoffs: [{ userId: 'editor', kind: TaskKind.GENERAL }] },
    });
    await expect(w.service.returnTask('t1', { note: 'x' }, as('editor'))).rejects.toThrow(/never handed over/);
  });

  it('the target still has to pass the guard for the stage it lands in', async () => {
    const w = world({ task: reviewFromCataloguer });
    await expect(
      w.service.returnTask('t1', { note: 'x', assignedToUserId: 'reader' }, as('editor')),
    ).rejects.toThrow(BadRequestException);
    expect(w.history).toEqual([]);
  });

  it('only the assignee or records:manage may return — not the creator', async () => {
    const w = world({ task: { ...reviewFromCataloguer, assignedToUserId: 'editor2' } });
    await expect(w.service.returnTask('t1', { note: 'x' }, as('cataloguer'))).rejects.toThrow(ForbiddenException);
  });

  it('the note is required and must not be blank', async () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(ReturnTaskDto, body))).map((e) => e.property);
    expect(await errors({})).toContain('note');
    expect(await errors({ note: '   ' })).toContain('note');
    expect(await errors({ note: 'Author is wrong.' })).toEqual([]);
  });
});

// ─── returnTarget ─────────────────────────────────────────────────────────────

describe('returnTarget — what the Return dialog prefills', () => {
  const returnTarget = (w: ReturnType<typeof world>) =>
    (w.service as unknown as { returnTarget(t: unknown): Promise<unknown> }).returnTarget(w.task);

  it('is the next entry down the stack: person, name and stage', async () => {
    const w = world({
      task: {
        kind: TaskKind.REVIEW_PUBLISH,
        assignedToUserId: 'editor',
        handoffs: [
          { userId: 'cataloguer', kind: null },
          { userId: 'cataloguer2', kind: TaskKind.FIX_METADATA },
          { userId: 'editor', kind: TaskKind.REVIEW_PUBLISH },
        ],
      },
    });
    await expect(returnTarget(w)).resolves.toEqual({
      userId: 'cataloguer2',
      displayName: 'name:cataloguer2',
      kind: TaskKind.FIX_METADATA,
    });
  });

  it('is null when Return is not possible', async () => {
    const lone = world({ task: { createdByUserId: 'editor', assignedToUserId: 'editor', handoffs: [] } });
    await expect(returnTarget(lone)).resolves.toBeNull();
    const done = world({ task: { status: TaskStatus.COMPLETED } });
    await expect(returnTarget(done)).resolves.toBeNull();
  });
});

// ─── Reassign and cancel ──────────────────────────────────────────────────────

describe('reassign — same stage, other person', () => {
  const review = { kind: TaskKind.REVIEW_PUBLISH, assignedToUserId: 'editor', createdByUserId: 'cataloguer' };

  it('pushes, keeps the stage, writes one ASSIGNED row', async () => {
    const w = world({ task: review });
    const view = await w.service.reassign('t1', { assignedToUserId: 'editor2', note: 'Holiday.' }, as('editor'));
    expect(view).toMatchObject({ assignedToUserId: 'editor2', kind: 'REVIEW_PUBLISH', lastHandoff: 'ASSIGNED' });
    expect(w.task.handoffs.slice(-2)).toEqual([
      { userId: 'editor', kind: TaskKind.REVIEW_PUBLISH },
      { userId: 'editor2', kind: TaskKind.REVIEW_PUBLISH },
    ]);
    expect(w.history).toEqual([expect.objectContaining({ action: TaskAction.ASSIGNED, note: 'Holiday.' })]);
  });

  it('never to yourself, never to the current holder, never past the guard', async () => {
    const w = world({ task: review });
    await expect(w.service.reassign('t1', { assignedToUserId: 'admin' }, as('admin'))).rejects.toThrow(/yourself/);
    await expect(w.service.reassign('t1', { assignedToUserId: 'editor' }, as('admin'))).rejects.toThrow(/already/);
    await expect(w.service.reassign('t1', { assignedToUserId: 'cataloguer2' }, as('editor'))).rejects.toThrow(/publish/);
  });

  it('the creator may reassign; an unrelated colleague may not', async () => {
    const w = world({ task: review });
    await expect(w.service.reassign('t1', { assignedToUserId: 'editor2' }, as('cataloguer2'))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(w.service.reassign('t1', { assignedToUserId: 'editor2' }, as('cataloguer'))).resolves.toBeDefined();
  });
});

describe('cancel', () => {
  it('CANCELLED, one CANCELLED row; the creator may do it', async () => {
    const w = world({ task: { assignedToUserId: 'editor', createdByUserId: 'cataloguer' } });
    const view = await w.service.cancel('t1', { note: 'Not needed.' }, as('cataloguer'));
    expect(view.status).toBe(TaskStatus.CANCELLED);
    expect(w.history).toEqual([
      expect.objectContaining({
        action: TaskAction.CANCELLED,
        note: 'Not needed.',
        changes: [{ path: 'status', before: 'OPEN', after: 'CANCELLED' }],
      }),
    ]);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH — details only', () => {
  const errors = async (body: object) =>
    (await validate(plainToInstance(UpdateTaskDto, body))).map((e) => [e.property, Object.values(e.constraints ?? {})[0]]);

  it('rejects status, kind and assignedToUserId with a pointer to the action routes', async () => {
    for (const body of [{ status: 'COMPLETED' }, { kind: 'GENERAL' }, { assignedToUserId: 'x' }]) {
      const [[, message]] = await errors(body);
      expect(message).toMatch(/POST \/api\/tasks\/:id\/complete/);
    }
    expect((await errors({ note: 'hi' }))[0][1]).toMatch(/comments/);
  });

  it('accepts title, description and dueAt', async () => {
    expect(await errors({ title: 'New', description: 'd', dueAt: '2026-10-01' })).toEqual([]);
  });

  it('a change writes one UPDATED row; a no-op writes none', async () => {
    const w = world({ task: { title: 'Old' } });
    await w.service.updateDetails('t1', { title: 'New' }, as('editor'));
    await w.service.updateDetails('t1', { title: 'New' }, as('editor'));
    expect(w.history).toEqual([
      expect.objectContaining({
        action: TaskAction.UPDATED,
        changes: [{ path: 'title', before: 'Old', after: 'New' }],
      }),
    ]);
  });
});
