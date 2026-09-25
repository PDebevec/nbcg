# Frontend: task workflow v2

## Status: PLANNED (2026-09-23) · backend DONE 2026-09-25 (dev) — ships together with it

Contract: [shared/plans/task-workflow-v2.md](../../shared/plans/task-workflow-v2.md).
Backend: [backend/plans/task-workflow-v2.md](../../backend/plans/task-workflow-v2.md).

**Must deploy in the same release as the backend.** Every state-changing button
on today's task page sends a `PATCH { status | assignedToUserId }`, which v2
rejects with 400.

---

## What the backend now provides (2026-09-25)

Built and tested on dev ([backend plan → Done](../../backend/plans/task-workflow-v2.md#done--what-was-built-2026-09-25),
full reference in [reference.md → Tasks](../../backend/reference.md#tasks-delegation)).
Nothing below is deployed; both sides go out together.

### Routes

| Call | Body | 200 / 201 | Errors worth a specific UI |
|---|---|---|---|
| `POST /api/tasks` | `{ itemId, kind, title, description?, assignedToUserId, dueAt? }` | 201 task | **409** `{ code: "ITEM_HAS_OPEN_TASK", message, taskId }` · 400 guard (message names the missing capability + "run POST /api/users/sync") |
| `POST /api/tasks/:id/complete` | `{ note?, next?: { kind, assignedToUserId } }` | 200 task | 400 FIX_METADATA without `next`, `next` on REVIEW_PUBLISH, a `next.kind` the stage does not lead to, guard · 403 not assignee / `records:manage`, or (review of a draft) caller's token cannot publish · **400 `METADATA_VALIDATION_FAILED`** unchanged from publish (was `PUBLISH_VALIDATION_FAILED` until schema v2 B9, 2026-09-25) |
| `POST /api/tasks/:id/return` | `{ note, assignedToUserId? }` | 200 task | 400 no/blank note, never handed over (`returnTarget` was null), target fails the guard for the stage it lands in · 403 not assignee / `records:manage` (the creator may NOT return) |
| `POST /api/tasks/:id/reassign` | `{ assignedToUserId, note? }` | 200 task | 400 yourself, current assignee, guard · 403 not assignee / creator / `records:manage` |
| `POST /api/tasks/:id/cancel` | `{ note? }` | 200 task | 403 as reassign |
| `PATCH /api/tasks/:id` | `{ title?, description?, dueAt? }` | 200 task | 400 for `status` / `kind` / `assignedToUserId` / `note` — **every PATCH the current page sends for a move is now a 400** |
| `GET /api/tasks?…&returned=true` | | `{ total, tasks }` | `status` other than OPEN/COMPLETED/CANCELLED → 400 |
| `GET /api/users?capability=drafts\|records` | | `{ total, users }` | |

Any action on a COMPLETED/CANCELLED task → 400 ("can no longer change").

### Shapes

- Task (list rows and action responses): v1 fields + **`lastHandoff`**
  (`CREATED | ADVANCED | RETURNED | ASSIGNED`). Action responses carry no
  `history` and no `returnTarget` — reload the detail after an action.
- Detail: + `history[]` + **`returnTarget: { userId, displayName, kind } | null`**
  (`returnTo` is gone). `null` when there is nobody to return to (never handed
  over, or the task is closed) — disable Return then. Not checked for
  eligibility: if that person has since left, the return is a 400 and the
  dialog's person override is the way out. It can be **you** (you completed
  with `next` to yourself, then step back) — phrase the dialog so "Goes back to
  you as Fix metadata" reads right.
- Completing a review of a draft answers with `status: COMPLETED`,
  `itemType: RECORD`.
- `completedAt` is set on COMPLETED, not on CANCELLED.

### History rows the list must render

| `action` | `changes` | Suggested line |
|---|---|---|
| `ADVANCED` | `kind` and/or `assignedToUserId` | "handed on for {stage} to {name}" |
| `RETURNED` | `kind` and/or `assignedToUserId`, `note` = reason | "returned to {name} as {stage}: {note}" |
| `ASSIGNED` | `assignedToUserId` | "reassigned to {name}" |
| `COMPLETED` | `status`; plus `{ path: "outcome", after: "ALREADY_PUBLISHED" }` when a review of a published record was confirmed | "completed" / "reviewed — already published" |
| `CANCELLED` | `status` | "cancelled" |
| `CLOSED_ON_PUBLISH` | `status`, optional `note` (set when the publish came from Complete) | "published by {name}" |
| legacy `STATUS_CHANGED` | `status` with `IN_PROGRESS` / `RETURNED` values | keep today's labels |

### Picker capability per stage

`pickerCapability(kind, itemType)`: GENERAL → `staff`; FIX_METADATA → `drafts`
on a DRAFT, `records` on a RECORD; REVIEW_PUBLISH → `publish`. For **return**
use the target stage (`returnTarget.kind`), not the current one.

The publish checklist in the complete dialog is `GET
/api/items/:id/validation` (`?target=RECORD` is the default; `DRAFT` also works since 2026-09-25).

---

## Current state (verified 2026-09-23)

| File | Today |
|---|---|
| `src/api/tasks.ts` | 5 statuses, `ACTIVE_TASK_STATUSES = [OPEN, IN_PROGRESS, RETURNED]`, `patchTask()` for every move, `pickerCapability(kind, status)` |
| `src/pages/admin/AdminTaskDetailPage.vue` | buttons: Start (`IN_PROGRESS`), Return (→ `RETURNED`, prefilled `returnTo`), Send back (RETURNED → OPEN), Reassign, Complete (plain status), Cancel, Reopen (COMPLETED → OPEN); one "move" dialog for all assignee changes |
| `src/components/admin/AssigneePicker.vue` | capability from `(kind, status)`, one `excludeUserId` |
| `src/components/admin/CreateTaskDialog.vue` | default kind by item type; no handling for "item already has a task" |
| `src/pages/admin/AdminTasksPage.vue` | status filter over 5 values + client-side "hide closed" |
| `src/pages/admin/AdminItemsPage.vue` | open-task badge = **three** `listTasks` calls, one per active status |
| `src/pages/admin/AdminDashboardPage.vue` | "waiting on me" filtered client-side by `ACTIVE_TASK_STATUSES` |
| `TaskStatusBadge.vue`, `TaskHistoryList.vue` | colours/icons per status and action |

---

## Changes

### API layer — `src/api/tasks.ts`, `src/api/users.ts`

- `TaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED'`; keep a wider
  `HistoryStatus` string type for rendering old log rows (`IN_PROGRESS`,
  `RETURNED` appear in `changes` forever).
- `TaskAction` gains `ADVANCED`, `COMPLETED`, `CANCELLED`.
- `Task` gains `lastHandoff`; `TaskDetail.returnTo` → `returnTarget: { userId,
  displayName, kind } | null`.
- New calls: `completeTask(id, { note?, next? })`, `returnTask(id, { note,
  assignedToUserId? })`, `reassignTask(id, { assignedToUserId, note? })`,
  `cancelTask(id, { note? })`. `patchTask()` keeps only title/description/dueAt.
- `pickerCapability(kind, itemType)`: REVIEW_PUBLISH → `publish`;
  FIX_METADATA on a RECORD → `records`, on a DRAFT → `drafts`; GENERAL → `staff`.
  `listUsers({ capability })` accepts the two new values.
- `ACTIVE_TASK_STATUSES` is just `['OPEN']` — replace its uses with
  `status: 'OPEN'` in the query.

### Task detail page

Header: a small **stage stepper** `GENERAL → FIX_METADATA → REVIEW_PUBLISH` with
the current stage highlighted (the stage now changes, so it deserves more than
a text field), status badge, and a **"Returned"** chip when
`lastHandoff === 'RETURNED'`.

Action bar while OPEN (visibility mirrors the backend's who-may table; the API's
403 stays the authority):

| Button | Shown to | Does |
|---|---|---|
| **Complete** — label per stage: "Complete", "Fixed — send for review", **"PUBLISH"** | assignee, `records:manage` | opens `CompleteTaskDialog` |
| Return | assignee, `records:manage`; disabled with tooltip when `returnTarget` is null | return dialog |
| Reassign | assignee, creator, `records:manage` | reassign dialog |
| Cancel | assignee, creator, `records:manage` | confirm + optional note |

Removed: **Start working**, **Send back**, **Reopen**.

### `CompleteTaskDialog.vue` (new)

| Stage | Dialog |
|---|---|
| GENERAL | radio: "Just complete" / "Hand over for metadata fix" / "Hand over for review & publish"; when handing over: picker (capability by chosen stage) with an **"Assign to me"** shortcut, optional note |
| FIX_METADATA | picker of publishers (required) + "Assign to me" if I can publish, optional note. Title: "Fixed — who should review and publish?" |
| REVIEW_PUBLISH, item is a DRAFT | a full-width warning banner in capitals: **"COMPLETING THIS TASK PUBLISHES THE ITEM — DRAFT → RECORD"** (cnr: **"ZAVRŠAVANJE OVOG ZADATKA OBJAVLJUJE GRAĐU — NACRT → ZAPIS"**, to be checked by a native speaker); the publish checklist from `GET /api/items/:id/validation?target=RECORD`; button "Publish" disabled while anything is missing (with links to the editor); if the user cannot transition (`!canTransition`), no button, only "Only a publisher can complete this task" |
| REVIEW_PUBLISH, item is a RECORD | "Already published — confirm the review", optional note |

A `400 METADATA_VALIDATION_FAILED` (the check ran again server-side) opens the
shared `ValidationErrorDialog` from the [metadata plan](metadata-schema-v2.md#f4--save-readiness-s).
After a successful publish, reload the task *and* tell the caller the item moved
(links to `/admin/items/:id` keep working — the id is stable across DRAFT ↔ RECORD).

### Return / reassign dialog

Extract today's "move" dialog into `MoveTaskDialog.vue` with two modes:

- **return**: text "Goes back to **{name}** as **{stage}**" from `returnTarget`;
  picker prefilled with that person, capability from the *target* stage (not the
  current one); note **required**.
- **reassign**: picker excludes **me and the current assignee**
  (`excludeUserIds: string[]`); stage unchanged; note optional.

### Creating tasks

- `CreateTaskDialog.vue`: on `409 ITEM_HAS_OPEN_TASK` show "This item already
  has an open task" with a link to `taskId`, instead of a generic error.
- `AdminItemEditPage.vue`: when the Tasks tab already knows about an open task,
  the header button becomes **"Open task"** (navigates) instead of "Assign task".
- `AssigneePicker.vue`: props `kind` + `itemType` instead of `status`;
  `excludeUserIds` array; optional `showAssignToMe`.

### Lists

- `AdminTasksPage.vue`: status filter Open / Completed / Cancelled, **server-side**
  (drop the client-side "hide closed" filtering, which also broke pagination);
  "Stage" instead of "Kind" as the column/filter name; quick filter **"Returned
  to me"** (`assignedTo=me&returned=true`); stage chip + Returned chip in rows.
- `AdminItemsPage.vue`: open-task badge becomes **one** call
  (`itemIds=…&status=OPEN`) instead of three.
- `AdminDashboardPage.vue`: "waiting on me" = `assignedTo=me&status=OPEN`, sorted
  with returned ones first.

### Badges and history

- `TaskStatusBadge.vue`: three statuses; unknown (legacy) values fall back to a
  neutral chip.
- `TaskHistoryList.vue`: `ADVANCED` (arrow_forward, "handed on for …"),
  `COMPLETED` (check), `CANCELLED` (block); render `changes.kind` as stage labels
  ("Fix metadata → Review & publish"); keep `STATUS_CHANGED`, `IN_PROGRESS`,
  `RETURNED` labels for old rows.

### i18n (both `en-US` and `me`)

Remove `admin.tasks.detail.start`, `sendBack`, `reopen`; add stage names,
complete-dialog texts per stage, the publish warning, "Returned", "Returned to
me", "Assign to me", "Goes back to {name} as {stage}", the 409 message. Keep the
old status labels under a `legacy` key for history rows.

### Nice-to-have list

Update [admin-nice-to-have.md](admin-nice-to-have.md): **A4** (review queue)
becomes `status=OPEN&kind=REVIEW_PUBLISH` server-side; **A9** (bulk assign)
must report per-item 409s; **A2** (publish inside the editor) shares the
`ValidationErrorDialog`.

---

## Impact on the other side

| Frontend needs from the backend | Backend step |
|---|---|
| action routes, `returnTarget`, `lastHandoff`, `returned` filter | service/controller (§3, §5) — **built 2026-09-25** |
| capabilities `drafts` / `records` in `/api/users` | guard (§2) — **built 2026-09-25** |
| `409 ITEM_HAS_OPEN_TASK` | migration + create (§1, §3) — **built 2026-09-25** |
| `/items/:id/validation`, `METADATA_VALIDATION_FAILED` | metadata schema v2, B6 — built 2026-09-24 (dev), renamed from `PUBLISH_VALIDATION_FAILED` in B9 (built 2026-09-25, dev); response shapes in the [web schema v2 plan](metadata-schema-v2.md#what-the-backend-now-provides-2026-09-24) |

## Estimate

API layer S · detail page + dialogs M · lists/badges/history S · i18n S.

## Manual test script (no frontend test runner exists)

As cataloguer / editor / admin in two browsers: create GENERAL → complete to FIX
for the cataloguer → complete to REVIEW for the editor → return → verify it is
back with the cataloguer as FIX with the note → complete → as editor, PUBLISH →
item is a record, task completed, history reads correctly in both languages.
Plus: second task on the same item (409 link), reassign to self (not offered),
cataloguer on a REVIEW task (no Publish button).
