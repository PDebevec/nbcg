/**
 * Unit tests for the task assignee guard.
 *
 * The matrix is also covered end-to-end in §18 of api-test-suite.sh, but it
 * lives here too because it is the one rule in this feature that is easy to
 * "simplify" into a bug: the obvious `kind`-only version — REVIEW_PUBLISH means
 * the assignee must be able to publish — silently breaks the return flow, where
 * a REVIEW_PUBLISH task is deliberately parked with a cataloguer who needs to
 * fix it. These run without a stack, so there is no excuse for not noticing.
 */

// Same reason as search.service.spec.ts: mock the generated enums so the .js
// import resolution in the real module does not have to run.
jest.mock('../../../generated/prisma/enums', () => ({
  ItemType: { DRAFT: 'DRAFT', RECORD: 'RECORD' },
  TaskKind: { REVIEW_PUBLISH: 'REVIEW_PUBLISH', FIX_METADATA: 'FIX_METADATA', GENERAL: 'GENERAL' },
  TaskStatus: {
    OPEN: 'OPEN',
    IN_PROGRESS: 'IN_PROGRESS',
    RETURNED: 'RETURNED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  },
  TaskAction: {
    CREATED: 'CREATED',
    ASSIGNED: 'ASSIGNED',
    STATUS_CHANGED: 'STATUS_CHANGED',
    RETURNED: 'RETURNED',
    COMMENTED: 'COMMENTED',
    UPDATED: 'UPDATED',
    CLOSED_ON_PUBLISH: 'CLOSED_ON_PUBLISH',
  },
}));
jest.mock('../../core/prisma/prisma.service');
jest.mock('../../core/task-history/task-history.service');
jest.mock('../users/users.service');

import { BadRequestException } from '@nestjs/common';
import { TaskAction, TaskKind, TaskStatus } from '../../../generated/prisma/enums';
import { TasksService } from './tasks.service';

/** The three personas the whole feature turns on. */
const PUBLISHER = { isActive: true, canPublish: true, canWrite: true }; // editor, admin
const WRITER = { isActive: true, canPublish: false, canWrite: true }; // cataloguer
const READER = { isActive: true, canPublish: false, canWrite: false }; // reader

function serviceFor(who: typeof PUBLISHER | null) {
  const users = { assignability: jest.fn().mockResolvedValue(who) };
  // Prisma and the history writer are never reached: the guard runs before any
  // write, which is the point of testing it in isolation.
  return new TasksService({} as never, users as never, {} as never);
}

/** `assertAssignable` is private; the matrix is the contract, not the signature. */
function assertAssignable(
  service: TasksService,
  kind: TaskKind,
  status: TaskStatus,
): Promise<void> {
  return (
    service as unknown as {
      assertAssignable(userId: string, kind: TaskKind, status: TaskStatus): Promise<void>;
    }
  ).assertAssignable('some-user-id', kind, status);
}

describe('TasksService – the (kind, status) assignee guard', () => {
  describe('REVIEW_PUBLISH while it is someone\'s to publish', () => {
    for (const status of [TaskStatus.OPEN, TaskStatus.IN_PROGRESS]) {
      it(`accepts a publisher in ${status}`, async () => {
        await expect(
          assertAssignable(serviceFor(PUBLISHER), TaskKind.REVIEW_PUBLISH, status),
        ).resolves.toBeUndefined();
      });

      it(`rejects a cataloguer in ${status} — the task would be unfinishable`, async () => {
        await expect(
          assertAssignable(serviceFor(WRITER), TaskKind.REVIEW_PUBLISH, status),
        ).rejects.toThrow(BadRequestException);
      });
    }
  });

  describe('REVIEW_PUBLISH once it has been RETURNED', () => {
    // THE regression test. `kind` is the goal ("get this published"); `status`
    // plus assignee is where it currently sits. A returned task is parked with
    // whoever must fix it, so requiring canPublish here would 400 the return.
    it('accepts a cataloguer — the goal is still publication, the next step is not', async () => {
      await expect(
        assertAssignable(serviceFor(WRITER), TaskKind.REVIEW_PUBLISH, TaskStatus.RETURNED),
      ).resolves.toBeUndefined();
    });

    it('still rejects a reader, who cannot fix it either', async () => {
      await expect(
        assertAssignable(serviceFor(READER), TaskKind.REVIEW_PUBLISH, TaskStatus.RETURNED),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('the kinds that only need someone who writes', () => {
    for (const kind of [TaskKind.FIX_METADATA, TaskKind.GENERAL]) {
      it(`accepts a cataloguer for ${kind}`, async () => {
        await expect(
          assertAssignable(serviceFor(WRITER), kind, TaskStatus.OPEN),
        ).resolves.toBeUndefined();
      });

      it(`rejects a reader for ${kind}`, async () => {
        await expect(
          assertAssignable(serviceFor(READER), kind, TaskStatus.OPEN),
        ).rejects.toThrow(BadRequestException);
      });
    }
  });

  describe('directory preconditions, which apply to every kind', () => {
    it('rejects someone the directory has never seen, and says how to fix it', async () => {
      await expect(
        assertAssignable(serviceFor(null), TaskKind.GENERAL, TaskStatus.OPEN),
      ).rejects.toThrow(/users\/sync/);
    });

    it('rejects a disabled or departed user even if their scopes would allow it', async () => {
      const departed = { isActive: false, canPublish: true, canWrite: true };
      await expect(
        assertAssignable(serviceFor(departed), TaskKind.REVIEW_PUBLISH, TaskStatus.OPEN),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

// ---------------------------------------------------------------------------

/** `actionFor` is pure; reach it the same way. */
function actionFor(service: TasksService, existing: unknown, dto: unknown, changes: unknown) {
  return (
    service as unknown as {
      actionFor(e: unknown, d: unknown, c: unknown): TaskAction | null;
    }
  ).actionFor(existing, dto, changes);
}

describe('TasksService – one user action, one history row', () => {
  const service = serviceFor(WRITER);
  const OPEN = { status: TaskStatus.OPEN };

  it('labels a return RETURNED even though it also moves the assignee', () => {
    // The case the "most specific wins" rule exists for. Labelling this
    // STATUS_CHANGED or splitting it into two rows would record something that
    // did not happen: the API forces status and assignee to move together.
    const changes = [
      { path: 'status', before: 'OPEN', after: 'RETURNED' },
      { path: 'assignedToUserId', before: 'a', after: 'b' },
    ];
    expect(actionFor(service, OPEN, { status: TaskStatus.RETURNED }, changes)).toBe(
      TaskAction.RETURNED,
    );
  });

  it('labels a plain handover ASSIGNED, not RETURNED', () => {
    const changes = [{ path: 'assignedToUserId', before: 'a', after: 'b' }];
    expect(actionFor(service, OPEN, {}, changes)).toBe(TaskAction.ASSIGNED);
  });

  it('labels any other status move STATUS_CHANGED', () => {
    const changes = [{ path: 'status', before: 'OPEN', after: 'COMPLETED' }];
    expect(actionFor(service, OPEN, { status: TaskStatus.COMPLETED }, changes)).toBe(
      TaskAction.STATUS_CHANGED,
    );
  });

  it('labels a field edit UPDATED', () => {
    const changes = [{ path: 'title', before: 'old', after: 'new' }];
    expect(actionFor(service, OPEN, {}, changes)).toBe(TaskAction.UPDATED);
  });

  it('writes nothing at all for a PATCH that changes nothing', () => {
    // The GUI sends idempotent saves; an audit log of non-events is noise.
    expect(actionFor(service, OPEN, {}, [])).toBeNull();
  });

  it('treats a bare note as a comment made through PATCH', () => {
    expect(actionFor(service, OPEN, { note: 'just a thought' }, [])).toBe(TaskAction.COMMENTED);
  });
});

// ---------------------------------------------------------------------------

const CATALOGUER = 'user-cataloguer';
const EDITOR = 'user-editor';
const OTHER_EDITOR = 'user-editor-2';
const ADMIN = 'user-admin';

/** Directory facts keyed by id, so returnTo's eligibility check has something real to read. */
const DIRECTORY: Record<string, { isActive: boolean; canPublish: boolean; canWrite: boolean }> = {
  [CATALOGUER]: WRITER,
  [EDITOR]: PUBLISHER,
  [OTHER_EDITOR]: PUBLISHER,
  [ADMIN]: PUBLISHER,
};

function serviceForReturnTo() {
  const users = {
    assignability: jest.fn(async (id: string) => DIRECTORY[id] ?? null),
    resolveNames: jest.fn(async (ids: string[]) => new Map(ids.map((i) => [i, `name:${i}`]))),
  };
  return new TasksService({} as never, users as never, {} as never);
}

function deriveReturnTo(service: TasksService, task: unknown, history: unknown) {
  return (
    service as unknown as {
      deriveReturnTo(t: unknown, h: unknown): Promise<{ userId: string } | null>;
    }
  ).deriveReturnTo(task, history);
}

describe('TasksService – returnTo, the prefill for "return with notes"', () => {
  it('is the creator — RETURNED means "sent back to the requester"', async () => {
    const task = { assignedToUserId: EDITOR, createdByUserId: CATALOGUER };
    const history = [
      {
        userId: CATALOGUER,
        changes: [{ path: 'assignedToUserId', before: null, after: EDITOR }],
      },
    ];
    await expect(deriveReturnTo(serviceForReturnTo(), task, history)).resolves.toMatchObject({
      userId: CATALOGUER,
    });
  });

  it('is still the creator after an admin reroutes the task, NOT the admin', async () => {
    // The case that decides the ordering, and the reason this is derived in the
    // backend at all. An admin unsticking a task is "who handed it to me", so
    // last-handover-first would prefill the admin — but the person who fixes the
    // author field is the cataloguer who asked for it to be published.
    const task = { assignedToUserId: OTHER_EDITOR, createdByUserId: CATALOGUER };
    const history = [
      { userId: CATALOGUER, changes: [{ path: 'assignedToUserId', before: null, after: EDITOR }] },
      { userId: ADMIN, changes: [{ path: 'assignedToUserId', before: EDITOR, after: OTHER_EDITOR }] },
    ];
    await expect(deriveReturnTo(serviceForReturnTo(), task, history)).resolves.toMatchObject({
      userId: CATALOGUER,
    });
  });

  it('falls back to the last handover when the creator has left', async () => {
    const task = { assignedToUserId: OTHER_EDITOR, createdByUserId: 'user-departed' };
    const history = [
      { userId: EDITOR, changes: [{ path: 'assignedToUserId', before: null, after: OTHER_EDITOR }] },
    ];
    await expect(deriveReturnTo(serviceForReturnTo(), task, history)).resolves.toMatchObject({
      userId: EDITOR,
    });
  });

  it('falls back to the last handover when the creator is the one holding it', async () => {
    const task = { assignedToUserId: CATALOGUER, createdByUserId: CATALOGUER };
    const history = [
      { userId: EDITOR, changes: [{ path: 'assignedToUserId', before: EDITOR, after: CATALOGUER }] },
    ];
    await expect(deriveReturnTo(serviceForReturnTo(), task, history)).resolves.toMatchObject({
      userId: EDITOR,
    });
  });

  it('is null when nobody is eligible, so the GUI shows an empty picker', async () => {
    const task = { assignedToUserId: CATALOGUER, createdByUserId: CATALOGUER };
    await expect(deriveReturnTo(serviceForReturnTo(), task, [])).resolves.toBeNull();
  });

  it('never suggests returning a task to the person already holding it', async () => {
    const task = { assignedToUserId: CATALOGUER, createdByUserId: CATALOGUER };
    const history = [
      {
        userId: CATALOGUER,
        changes: [{ path: 'assignedToUserId', before: EDITOR, after: CATALOGUER }],
      },
    ];
    await expect(deriveReturnTo(serviceForReturnTo(), task, history)).resolves.toBeNull();
  });
});
