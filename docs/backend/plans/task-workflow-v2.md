# Backend: task workflow v2

## Status: PLANNED (2026-09-23)

The model and the API are in [shared/plans/task-workflow-v2.md](../../shared/plans/task-workflow-v2.md)
— read it first. Related: [web frontend plan](../../frontend/plans/task-workflow-v2.md).

---

## Current state (verified 2026-09-23)

| What | Where |
|---|---|
| Enums `TaskStatus` (5 values), `TaskKind`, `TaskAction`; models `Task`, `TaskHistory` | `backend/prisma/schema.prisma` |
| All state changes go through one `PATCH` | `tasks.controller.ts` → `TasksService.update()`, which diffs the DTO and labels the row with `actionFor()` |
| Assignee guard keyed on `(kind, status)` | `TasksService.requiredCapability()` / `assertAssignable()` |
| Return target prefill, creator first | `TasksService.deriveReturnTo()` |
| "RETURNED needs a different assignee" | inline in `update()` |
| Publish closes REVIEW_PUBLISH tasks (OPEN/IN_PROGRESS/RETURNED) | `ItemsService.transition()`, observer inside the transaction |
| Directory capability for the guard | `UsersService.assignability()` → `{ isActive, canPublish, canWrite }` — reads the stored `scopes` column, so new capabilities need no migration |
| Tests | `backend/test/api-test-suite.sh` §18 (≈ lines 2295–2720), `tasks.service.spec.ts` |

---

## Changes

### 1. Schema + migration

`schema.prisma`:

```prisma
enum TaskStatus { OPEN  COMPLETED  CANCELLED }

enum TaskAction {
  CREATED  ASSIGNED  RETURNED  COMMENTED  UPDATED  CLOSED_ON_PUBLISH
  ADVANCED   // a stage was completed and handed to the next person/stage
  COMPLETED
  CANCELLED
  STATUS_CHANGED   // legacy rows only — no longer written
}

model Task {
  // … unchanged columns …
  /// [TaskHandoffStack] — [{ userId, kind | null }], bottom = requester, top = current holder.
  handoffs    Json       @default("[]")
  /// What the last handover was; drives the "returned to you" badge and ?returned=true.
  lastHandoff TaskAction @default(CREATED)
}
```

Migrations (three files, because Postgres cannot use a new enum value in the
transaction that added it, and Prisma runs each file in one transaction):

1. `…_task_actions_v2` — `ALTER TYPE "TaskAction" ADD VALUE 'ADVANCED' | 'COMPLETED' | 'CANCELLED'`.
2. `…_task_workflow_v2` —
   - add `handoffs`, `lastHandoff`;
   - `UPDATE tasks SET kind = 'FIX_METADATA' WHERE status = 'RETURNED' AND kind = 'REVIEW_PUBLISH'`
     (a returned review task *is* a fix task in v2);
   - `UPDATE tasks SET "lastHandoff" = 'RETURNED' WHERE status = 'RETURNED'`;
   - `UPDATE tasks SET status = 'OPEN' WHERE status IN ('IN_PROGRESS', 'RETURNED')`;
   - initialise `handoffs`: `[{creator, null}, {assignee, kind}]`, or
     `[{assignee, kind}]` when creator = assignee;
   - recreate `TaskStatus` without the two values (Prisma generates the
     rename-create-cast-drop sequence).
3. `…_one_open_task_per_item` —
   - a `DO $$ … RAISE EXCEPTION … $$` guard that aborts if any item has more
     than one `OPEN` task, printing the item ids (resolve by hand — cancelling
     someone's task automatically is not a migration's call);
   - `CREATE UNIQUE INDEX tasks_one_open_per_item ON tasks ("itemId") WHERE status = 'OPEN'`.

   **Verify first** that `prisma migrate dev` does not propose dropping an index
   it does not know about. If the installed Prisma 7 can declare a partial
   unique index in the schema, declare it there instead. If neither works
   cleanly, drop the index and enforce the rule in `create()` under
   `pg_advisory_xact_lock(hashtext(itemId))` — same guarantee, no Prisma drift.

No `task_history` rows are rewritten: old `IN_PROGRESS`/`RETURNED`/
`STATUS_CHANGED` values stay in `changes` and `action` forever. The migration
writes no history rows (there is no system actor, by design).

Before running in production: `SELECT status, kind, count(*) FROM tasks GROUP BY 1, 2`
and the duplicate query, so the outcome is known in advance.

### 2. Guard — keyed on `(kind, itemType)`

Replace `requiredCapability(kind, status)` with:

| kind | item | required |
|---|---|---|
| GENERAL | any | `canWrite` |
| FIX_METADATA | DRAFT | `canEditDrafts` |
| FIX_METADATA | RECORD | `canEditRecords` |
| REVIEW_PUBLISH | any | `canPublish` |

`UsersService.assignability()` gains `canEditDrafts` (`drafts:manage` in
`scopes`) and `canEditRecords` (`records:manage`) — no migration, no resync.
`GET /api/users?capability=` gains `drafts` and `records` for the pickers.
Still advisory, same error text with the "run `POST /api/users/sync`" hint.

### 3. Service — one method per action

Replace `update()`'s diff-and-label logic with explicit methods, each in one
transaction that writes exactly one history row:

| Method | Checks | Writes |
|---|---|---|
| `create()` | + one-open-task rule → `ConflictException({ code: 'ITEM_HAS_OPEN_TASK', taskId })` | stack init, `CREATED` |
| `complete(id, dto, principal)` | caller is assignee or `records:manage`; per-stage body rules from the contract; `next` assignee through the guard | GENERAL w/o next → `COMPLETED`; with next / FIX → `ADVANCED` + push; REVIEW → see below |
| `returnTask()` | note required; stack depth ≥ 2; target via guard for the popped stage | pop (+ person override), `RETURNED` with `changes` for `kind` and `assignedToUserId`; `lastHandoff = RETURNED` |
| `reassign()` | caller is assignee, creator or `records:manage`; target ≠ caller, ≠ current assignee; guard | push, `ASSIGNED` |
| `cancel()` | assignee, creator or `records:manage` | `CANCELLED` |
| `updateDetails()` (PATCH) | as today | `UPDATED`; rejects `status`/`kind`/`assignedToUserId` with a 400 pointing at the action routes |

Keep `diff()`/`FieldChange` for the `changes` column; delete `actionFor()`,
`deriveReturnTo()` and the RETURNED special case. Add `returnTarget(task)` —
reads the stack, resolves the name, returns `{ userId, displayName, kind }` or
`null`; for the creator entry apply the rule "REVIEW_PUBLISH → FIX_METADATA,
otherwise same stage".

**Complete on REVIEW_PUBLISH**:

- item is a DRAFT → `assertCanTransition(principal)` (the JWT, not the
  directory), then `ItemsService.transition([itemId], RECORD, actor, { note })`.
  The existing observer closes the task and logs `CLOSED_ON_PUBLISH` by the real
  publisher — so there is exactly one closing path whether the publish came from
  the task or not. Pass the optional `note` through to that row.
  Publish validation (metadata schema v2, B6) runs inside `transition()`; its
  400 reaches the task dialog unchanged.
- item is already a RECORD → `COMPLETED` with a `changes` entry noting
  "reviewed, already published".

`TasksService` then depends on `ItemsService` — check for a module cycle
(`ItemsModule` does not import `TasksModule` today; it writes tasks through
Prisma + `TaskHistoryService`, which is fine).

### 4. Observer in `transition()`

Status filter becomes `status: 'OPEN'` (the other two values no longer exist).
Everything else stays: REVIEW_PUBLISH only, same transaction, attributed to the
publisher, RECORD → DRAFT does not reopen.

### 5. Controller + DTOs

- Routes `POST /tasks/:id/complete | return | reassign | cancel`.
- DTOs `CompleteTaskDto { note?, next?: { kind, assignedToUserId } }`,
  `ReturnTaskDto { note (1–5000), assignedToUserId? }`,
  `ReassignTaskDto { assignedToUserId, note? }`, `CancelTaskDto { note? }`.
- `UpdateTaskDto` loses `status`, `kind`, `assignedToUserId`, `note`.
- `TasksQueryDto`: `status` enum shrinks; add `returned?: boolean`
  (`lastHandoff = RETURNED`).
- `TaskView`: add `lastHandoff`; detail replaces `returnTo` with
  `returnTarget`.

### 6. Docs

`docs/backend/reference.md` → "Tasks (delegation)" rewritten from the shared
contract once shipped (the banner there points at this plan until then).

---

## Tests

`api-test-suite.sh` §18 — rewrite the status-driven parts; keep the directory,
attribution, snapshot-name and item-delete tests as they are.

Remove / replace:
- `PATCH {"status":"IN_PROGRESS"}` (≈ line 2475) → now 400.
- The `RETURNED` PATCH tests (≈ 2502–2530) → replaced by `/return` tests.
- The observer block creates **several REVIEW tasks on one item** (≈ 2576) —
  illegal now; give each its own draft.

Add, per persona where it matters (anonymous 401, reader 403 on all):
- One open task per item: second `POST /tasks` on the same item → 409 with
  `taskId`; after the first is cancelled → 201.
- Stage flow from the contract's worked example (cataloguer / editor / admin):
  GENERAL → complete with next FIX → complete with next REVIEW → return →
  back to FIX with the fixer → complete → REVIEW → complete publishes: item is
  now a RECORD, task COMPLETED, last row `CLOSED_ON_PUBLISH` by the editor.
- GENERAL complete without next → COMPLETED; with next to **self** → 200.
- FIX complete without `next` → 400; with a non-publisher as REVIEW assignee → 400.
- REVIEW complete by a cataloguer (cannot publish, even if assignee) → 403, item
  still a draft.
- REVIEW complete on an item missing required metadata → 400
  `PUBLISH_VALIDATION_FAILED`, task still OPEN.
- Return without note → 400; return on a fresh task (stack depth 1) → 400;
  return to creator from REVIEW → stage FIX_METADATA; return with override
  person → that person, previous stage.
- Reassign to self → 400; to current assignee → 400; to a cataloguer on a
  REVIEW task → 400.
- FIX_METADATA on a RECORD assigned to a cataloguer → 400; to an editor → 201.
- PATCH with `status` → 400; PATCH title → 200, one `UPDATED` row.
- `?returned=true` lists the returned task; `lastHandoff` in list rows.
- Publishing outside the task still closes it (keep the existing observer test).

`tasks.service.spec.ts` — replace the `(kind, status)` guard tests with
`(kind, itemType)`, add stack push/pop unit tests, remove `deriveReturnTo` tests.

---

## Impact on the other side

| Change | Web frontend |
|---|---|
| `IN_PROGRESS`, `RETURNED` gone | status filters, badges, `ACTIVE_TASK_STATUSES` (dashboard, items page, inbox) |
| PATCH no longer moves status/assignee | every button on the task detail page switches to the action routes |
| `returnTo` → `returnTarget` | return dialog prefill + shows the target stage |
| 409 `ITEM_HAS_OPEN_TASK` | "Assign task" dialog + bulk-assign idea (A9 in nice-to-have) |
| Complete REVIEW = publish | new dialog, must render `PUBLISH_VALIDATION_FAILED` |
| `lastHandoff` | "Returned" chip in inbox/dashboard |
| New history actions | `TaskHistoryList` icons/labels; legacy ones stay |

Deploy backend and frontend **together** — the current frontend's Start /
Return / Reopen buttons all send PATCHes that v2 rejects.

## Estimate

Migration S · guard + directory S · service/controller M · tests M.

## Key files

- `backend/prisma/schema.prisma`, new migrations
- `backend/src/modules/tasks/*`
- `backend/src/modules/users/users.service.ts`, `dto/users-query.dto.ts`
- `backend/src/modules/items/items.service.ts` (observer filter, optional `note`)
- `backend/test/api-test-suite.sh` §18, `tasks.service.spec.ts`
