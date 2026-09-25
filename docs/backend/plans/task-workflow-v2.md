# Backend: task workflow v2

## Status: DONE (2026-09-25) · not deployed — ships together with the web frontend

Everything in "Changes" is built and tested. **Do not deploy it alone**: the
current web frontend's Start / Return / Reopen buttons send PATCHes that v2
rejects — see [Deploy notes](#deploy-notes). Everything below "Current state"
is the original plan, each part marked with what was actually done.

The model and the API are in [shared/plans/task-workflow-v2.md](../../shared/plans/task-workflow-v2.md)
— read it first. Related: [web frontend plan](../../frontend/plans/task-workflow-v2.md).
The deployed behaviour is documented in [reference.md → Tasks](../reference.md#tasks-delegation).

---

## Done — what was built (2026-09-25)

### Decisions made while building

No product question came up that the contract did not answer. The small
calls below were made in code and are recorded in the contract too.

| Question | Decision |
|---|---|
| Partial unique index in the schema or by hand? | **In the schema**: Prisma 7.7 has a `partialIndexes` preview feature — `@@unique([itemId], map: "tasks_one_open_per_item", where: { status: "OPEN" })`. `migrate diff` generates exactly the planned SQL and shows no drift afterwards, so no advisory lock was needed. Catch: the generated client now offers `findUnique({ where: { itemId } })`, which is wrong for a partial index — warned about in `schema.prisma`. |
| The requester's bottom entry has no stage. What is stored after a return to them? | The **resolved stage is written into that entry**. Without it, "A files GENERAL for B → B returns → A hands on as FIX to C → C returns" would land with A in FIX (the "same stage" rule) although A held it in GENERAL. With it, the rule "back to the stage they had it" holds everywhere. |
| A return that would leave the task where it is (override person = current holder, same stage) | **400.** A return to yourself that *changes the stage* (you completed with `next` to yourself, then step back) is allowed. |
| What does the "reviewed, already published" `changes` entry look like? | `[{ path: "status", before: "OPEN", after: "COMPLETED" }, { path: "outcome", before: null, after: "ALREADY_PUBLISHED" }]` on a `COMPLETED` row. |
| Status code of the action routes | **200** with the task view (no history, no `returnTarget`) — they change an existing task, they create nothing. |
| Actions on a COMPLETED / CANCELLED task | **400** "can no longer change". PATCH details and comments on a closed task stay allowed, as in v1. |
| `completedAt` on cancel | Not set, as in v1 (`completedAt` means "finished"). |
| `note` on PATCH | **400** pointing at `/comments` (v1 turned it into a COMMENTED row). |
| `returned=false` | Also supported: `lastHandoff` is anything but RETURNED. |
| Order of checks on create | The 409 comes before the assignee guard: an item with an open task is the more fundamental "no". |

Local dev data: the one item with two open tasks (test data from 2026-09-23)
was resolved before migrating by cancelling the older FIX_METADATA task through
the v1 API as admin, as the plan prescribes.

### Where it is

| File | What |
|---|---|
| `prisma/schema.prisma` | `TaskStatus` (3 values), `TaskAction` (+ ADVANCED, COMPLETED, CANCELLED), `Task.handoffs`, `Task.lastHandoff`, the partial unique index; `previewFeatures = ["partialIndexes"]` |
| `prisma/migrations/20260925140809_task_actions_v2` | The three `ADD VALUE`s |
| `prisma/migrations/20260925141500_task_workflow_v2` | Columns, data conversion, stack init, `TaskStatus` recreate — one explicit transaction |
| `prisma/migrations/20260925142000_one_open_task_per_item` | Duplicate guard (`RAISE EXCEPTION` naming the items) + the index |
| `src/core/types/task.types.ts` | `TaskHandoff`, `TaskHandoffStack` (the `[TaskHandoffStack]` JSON type) |
| `src/modules/tasks/task-workflow.ts` | **Pure**: `requiredCapability`, `NEXT_STAGES`, `initialStack`, `stackOf`, `push`, `returnStage`, `popForReturn` |
| `src/modules/tasks/tasks.service.ts` | `create`, `complete`, `returnTask`, `reassign`, `cancel`, `updateDetails`, `returnTarget`; one `act()` wrapper = lock row + one update + one history row |
| `src/modules/tasks/dto/` | `CompleteTaskDto` (+ `NextStageDto`), `ReturnTaskDto`, `ReassignTaskDto`, `CancelTaskDto`; `UpdateTaskDto` details-only; `TasksQueryDto.returned` |
| `src/modules/tasks/tasks.controller.ts` | `POST :id/complete \| return \| reassign \| cancel` |
| `src/modules/users/` | `Assignability` + `canEditDrafts` / `canEditRecords`; `?capability=drafts \| records` |
| `src/modules/items/items.service.ts` | Observer filter `status: OPEN`; `transition(…, { note })` puts the note on `CLOSED_ON_PUBLISH` |

### Deviations from the plan below, and why

- **Migration 2 wraps everything in one `BEGIN … COMMIT`.** Prisma does not wrap
  a migration file in a transaction (its own generated enum swap carries an
  explicit `BEGIN/COMMIT`), so without it a failure half-way would leave v1
  data half-converted.
- **`UpdateTaskDto` still declares `status`, `kind`, `assignedToUserId` and
  `note`** — as `@IsEmpty()` fields whose message points at the right route.
  The global `ValidationPipe` is `whitelist: true` without
  `forbidNonWhitelisted`, so simply removing them would make a v1 client's
  "complete" PATCH return 200 having silently done nothing.
- **The stack is read through `stackOf()`**, which rebuilds an empty/garbled
  column from creator + assignee and puts the current holder back on top if the
  stack disagrees with the row — a hand-edited row cannot send a return
  somewhere the stack never agreed to.
- **Every action locks the task row** (`SELECT … FOR UPDATE`) and re-checks
  status and permissions under the lock, so two simultaneous returns cannot both
  pop. Complete-REVIEW-on-a-draft cannot run inside that lock (`transition()`
  opens its own transaction); if a race turns the task into a review of a draft
  between the read and the lock, the locked path answers **409** instead of
  completing it without publishing.
- **`returnTarget` has no eligibility check** (v1's `returnTo` skipped inactive
  candidates). The stack says who; if that person has left, the return itself
  says so with a 400 and the dialog lets the caller override the person.
- **The guard's error names the item type** — "A FIX_METADATA task on a RECORD
  needs an assignee who can edit published records (records:manage)" — plus the
  `POST /api/users/sync` hint.
- Not run: `prisma format` — it realigns unrelated models; the schema diff is
  kept to the task models.

### Tests

- Jest: `task-workflow.spec.ts` (20 — the guard matrix, stack init/normalise,
  `returnStage`, the contract's worked example unwound step by step, the
  resolved-stage write) and a rewritten `tasks.service.spec.ts` (42, against an
  in-memory Prisma fake: the `(kind, itemType)` guard, 409 incl. the
  unique-violation race, every complete/return/reassign/cancel rule and its one
  history row, the row lock, PATCH DTO rejections). Mutation-checked: breaking
  the REVIEW→FIX return rule fails 5 tests, dropping "never yourself" fails 1.
  Whole jest suite: 221 pass.
- API suite §18 rewritten — **194 checks**, 625/625 for the whole suite on dev.
  Every task on its own item; per-persona 401/403 on all four action routes;
  guard on `(kind, itemType)` incl. FIX_METADATA on a record; one-open-task 409
  with `taskId`, then 201 after cancel; the index and enum checked in
  `pg_indexes`/`pg_enum`; the contract's stage flow end to end (history
  `CREATED,ADVANCED,ADVANCED,RETURNED,ADVANCED,ASSIGNED,CLOSED_ON_PUBLISH`);
  return variants (to requester → FIX, stack of one → 400, override person →
  previous stage); REVIEW complete by a non-assignee and by a stale-directory
  cataloguer assignee → 403; incomplete draft → `PUBLISH_VALIDATION_FAILED`
  (`METADATA_VALIDATION_FAILED` since schema v2 B9, 2026-09-25),
  task still OPEN, no history row; FIX on a record → "reviewed, already
  published"; bulk publish closes the review task, leaves a FIX task open;
  `returned=true/false`; `capability=drafts/records`; the delete asymmetry.

### Deploy notes

1. **Backend and web frontend together.** v2 rejects every state-changing PATCH
   the current frontend sends (Start, Complete, Return, Reopen, Cancel), and
   `returnTo`/`IN_PROGRESS`/`RETURNED` are gone from the responses.
2. **Before deploying, on production** (with v1 still running):
   `SELECT status, kind, count(*) FROM tasks GROUP BY 1, 2;` and
   `SELECT "itemId", count(*) FROM tasks WHERE status IN ('OPEN','IN_PROGRESS','RETURNED') GROUP BY 1 HAVING count(*) > 1;`
   Resolve every duplicate **then**, through the v1 API (cancel all but one per
   item — admin can, via the `records:manage` escape hatch). The container boots
   with `prisma migrate deploy && node dist/src/main.js`, so if migration 3
   aborts, the API does not start at all — with migrations 1 and 2 already
   applied, so v1 cannot run either. Recovery in that case: cancel the extras
   in SQL (`UPDATE tasks SET status = 'CANCELLED' WHERE id IN (…)` — writes no
   history row, so note it somewhere), `npx prisma migrate resolve
   --rolled-back 20260925142000_one_open_task_per_item`, restart.
3. **Other developers' local DBs:** `npx prisma migrate deploy` (or `migrate
   dev`) + `npx prisma generate`; the same duplicate guard applies to their
   test data.
4. **Archive app:** still assumed not to call `/api/tasks` — confirm before the
   release (it would break exactly like the web client).

---

## Current state before v2 (verified 2026-09-23)

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

### 1. Schema + migration — DONE (index declared in the schema via `partialIndexes`)

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

### 2. Guard — keyed on `(kind, itemType)` — DONE

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

### 3. Service — one method per action — DONE

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
  Publish validation (metadata schema v2, B6 — built 2026-09-24; the save
  check of B9 since 2026-09-25) runs inside `transition()`, in its transaction
  before any row moves; its 400 reaches the task dialog unchanged, and the task
  stays OPEN because the whole transaction rolls back.
- item is already a RECORD → `COMPLETED` with a `changes` entry noting
  "reviewed, already published".

`TasksService` then depends on `ItemsService` — check for a module cycle
(`ItemsModule` does not import `TasksModule` today; it writes tasks through
Prisma + `TaskHistoryService`, which is fine).

### 4. Observer in `transition()` — DONE

Status filter becomes `status: 'OPEN'` (the other two values no longer exist).
Everything else stays: REVIEW_PUBLISH only, same transaction, attributed to the
publisher, RECORD → DRAFT does not reopen.

### 5. Controller + DTOs — DONE (PATCH also rejects `note`; routes answer 200)

- Routes `POST /tasks/:id/complete | return | reassign | cancel`.
- DTOs `CompleteTaskDto { note?, next?: { kind, assignedToUserId } }`,
  `ReturnTaskDto { note (1–5000), assignedToUserId? }`,
  `ReassignTaskDto { assignedToUserId, note? }`, `CancelTaskDto { note? }`.
- `UpdateTaskDto` loses `status`, `kind`, `assignedToUserId`, `note`.
- `TasksQueryDto`: `status` enum shrinks; add `returned?: boolean`
  (`lastHandoff = RETURNED`).
- `TaskView`: add `lastHandoff`; detail replaces `returnTo` with
  `returnTarget`.

### 6. Docs — DONE

`docs/backend/reference.md` → "Tasks (delegation)" rewritten from the shared
contract, plus the `tasks` / `task_history` table docs and the directory's
`capability` values.

---

## Tests — DONE (see [Tests](#tests) above for what was actually written)

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
  `PUBLISH_VALIDATION_FAILED` (now `METADATA_VALIDATION_FAILED`, state
  RECORD), task still OPEN.
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
| Complete REVIEW = publish | new dialog, must render `METADATA_VALIDATION_FAILED` (was `PUBLISH_VALIDATION_FAILED` until 2026-09-25) |
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
