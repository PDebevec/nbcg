/**
 * The pure half of task workflow v2: the handoff stack and the (kind, itemType)
 * assignee rule. Contract: docs/shared/plans/task-workflow-v2.md.
 */
import { ItemType, TaskKind } from '../../../generated/prisma/enums';
import type { TaskHandoffStack } from '../../core/types/task.types';
import {
  initialStack,
  NEXT_STAGES,
  popForReturn,
  push,
  requiredCapability,
  returnStage,
  stackOf,
} from './task-workflow';

const { GENERAL, FIX_METADATA: FIX, REVIEW_PUBLISH: REVIEW } = TaskKind;

describe('requiredCapability — keyed on (kind, itemType)', () => {
  it.each([
    [GENERAL, ItemType.DRAFT, 'canWrite'],
    [GENERAL, ItemType.RECORD, 'canWrite'],
    [FIX, ItemType.DRAFT, 'canEditDrafts'],
    // A cataloguer cannot edit a published record, so cannot hold this.
    [FIX, ItemType.RECORD, 'canEditRecords'],
    [REVIEW, ItemType.DRAFT, 'canPublish'],
    [REVIEW, ItemType.RECORD, 'canPublish'],
  ])('%s on a %s needs %s', (kind, itemType, capability) => {
    expect(requiredCapability(kind, itemType)).toBe(capability);
  });
});

describe('NEXT_STAGES — what "complete with next" may move to', () => {
  it('GENERAL → FIX_METADATA or REVIEW_PUBLISH; FIX_METADATA → REVIEW_PUBLISH; REVIEW_PUBLISH → nothing', () => {
    expect(NEXT_STAGES[GENERAL]).toEqual([FIX, REVIEW]);
    expect(NEXT_STAGES[FIX]).toEqual([REVIEW]);
    expect(NEXT_STAGES[REVIEW]).toEqual([]);
  });
});

describe('initialStack', () => {
  it('A files for B: the requester at the bottom with no stage, B on top', () => {
    expect(initialStack('A', 'B', GENERAL)).toEqual([
      { userId: 'A', kind: null },
      { userId: 'B', kind: GENERAL },
    ]);
  });

  it('A files for A: one entry — there is nobody to return it to', () => {
    expect(initialStack('A', 'A', REVIEW)).toEqual([{ userId: 'A', kind: REVIEW }]);
  });
});

describe('stackOf — the stored stack, made safe to act on', () => {
  const task = { createdByUserId: 'A', assignedToUserId: 'B', kind: FIX };

  it('keeps a stack whose top is the current holder in the current stage', () => {
    const handoffs = [{ userId: 'A', kind: null }, { userId: 'B', kind: FIX }];
    expect(stackOf({ ...task, handoffs })).toEqual(handoffs);
  });

  it('rebuilds an empty or garbage column from creator and assignee', () => {
    const expected = [{ userId: 'A', kind: null }, { userId: 'B', kind: FIX }];
    expect(stackOf({ ...task, handoffs: [] })).toEqual(expected);
    expect(stackOf({ ...task, handoffs: null })).toEqual(expected);
    expect(stackOf({ ...task, handoffs: [{ nope: 1 }] })).toEqual(expected);
  });

  it('puts the current holder back on top when the stack disagrees with the row', () => {
    const handoffs = [{ userId: 'A', kind: null }, { userId: 'C', kind: GENERAL }];
    expect(stackOf({ ...task, handoffs })).toEqual([...handoffs, { userId: 'B', kind: FIX }]);
  });
});

describe('returnStage', () => {
  it('a stored stage wins: the previous holder gets it back in the stage they had it', () => {
    expect(returnStage({ userId: 'B', kind: GENERAL }, REVIEW)).toBe(GENERAL);
  });

  it('to the requester (no stage) from REVIEW_PUBLISH → FIX_METADATA: they fix what the reviewer found', () => {
    expect(returnStage({ userId: 'A', kind: null }, REVIEW)).toBe(FIX);
  });

  it('to the requester from any other stage → that stage', () => {
    expect(returnStage({ userId: 'A', kind: null }, GENERAL)).toBe(GENERAL);
    expect(returnStage({ userId: 'A', kind: null }, FIX)).toBe(FIX);
  });
});

describe('popForReturn', () => {
  it('is null on a one-entry stack — there is nobody to return it to', () => {
    expect(popForReturn([{ userId: 'A', kind: GENERAL }], GENERAL)).toBeNull();
    expect(popForReturn([], GENERAL)).toBeNull();
  });

  it('an override replaces the person, never the stage', () => {
    const stack = [{ userId: 'A', kind: null }, { userId: 'C', kind: FIX }, { userId: 'D', kind: REVIEW }];
    expect(popForReturn(stack, REVIEW, 'X')).toEqual({
      userId: 'X',
      kind: FIX,
      stack: [{ userId: 'A', kind: null }, { userId: 'X', kind: FIX }],
    });
  });

  it('writes the resolved stage into the requester entry, so a later return lands in the stage they held', () => {
    // A files GENERAL for B; B returns it → A holds GENERAL.
    let stack: TaskHandoffStack = initialStack('A', 'B', GENERAL);
    const first = popForReturn(stack, GENERAL)!;
    expect(first).toMatchObject({ userId: 'A', kind: GENERAL });
    stack = first.stack;
    expect(stack).toEqual([{ userId: 'A', kind: GENERAL }]);

    // A hands it on for fixing; C returns it → A again, in GENERAL (not FIX).
    stack = push(stack, 'C', FIX);
    expect(popForReturn(stack, FIX)).toMatchObject({ userId: 'A', kind: GENERAL });
  });

  it('the worked example from the contract, step by step', () => {
    let stack: TaskHandoffStack;
    let kind: TaskKind;
    const back = () => {
      const r = popForReturn(stack, kind)!;
      stack = r.stack;
      kind = r.kind;
      return { userId: r.userId, kind: r.kind };
    };

    // A creates GENERAL for B
    stack = initialStack('A', 'B', GENERAL);
    kind = GENERAL;
    // B completes → FIX_METADATA for C
    stack = push(stack, 'C', FIX);
    kind = FIX;
    // C completes → REVIEW_PUBLISH for D
    stack = push(stack, 'D', REVIEW);
    kind = REVIEW;
    // D returns → C, FIX_METADATA
    expect(back()).toEqual({ userId: 'C', kind: FIX });
    expect(stack.map((h) => h.userId)).toEqual(['A', 'B', 'C']);
    // C completes → REVIEW_PUBLISH for D; D reassigns to E
    stack = push(stack, 'D', REVIEW);
    kind = REVIEW;
    stack = push(stack, 'E', REVIEW);
    expect(stack.slice(-2)).toEqual([
      { userId: 'D', kind: REVIEW },
      { userId: 'E', kind: REVIEW },
    ]);

    // …and unwinding it all the way: E → D → C → B → A.
    expect(back()).toEqual({ userId: 'D', kind: REVIEW });
    expect(back()).toEqual({ userId: 'C', kind: FIX });
    expect(back()).toEqual({ userId: 'B', kind: GENERAL });
    expect(back()).toEqual({ userId: 'A', kind: GENERAL });
    expect(popForReturn(stack, kind)).toBeNull();
  });

  it('returning a review straight to the requester makes it their fix task', () => {
    const stack = initialStack('cataloguer', 'editor', REVIEW);
    expect(popForReturn(stack, REVIEW)).toEqual({
      userId: 'cataloguer',
      kind: FIX,
      stack: [{ userId: 'cataloguer', kind: FIX }],
    });
  });
});
