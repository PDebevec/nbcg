# Frontend: task workflow v2

## Status: PLANNED (2026-09-23) — ships together with the backend change

Contract: [shared/plans/task-workflow-v2.md](../../shared/plans/task-workflow-v2.md).
Backend: [backend/plans/task-workflow-v2.md](../../backend/plans/task-workflow-v2.md).

**Must deploy in the same release as the backend.** Every state-changing button
on today's task page sends a `PATCH { status | assignedToUserId }`, which v2
rejects with 400.

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

A `400 PUBLISH_VALIDATION_FAILED` (the check ran again server-side) opens the
shared `PublishErrorDialog` from the [metadata plan](metadata-schema-v2.md#f4--publish-readiness-s).
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
`PublishErrorDialog`.

---

## Impact on the other side

| Frontend needs from the backend | Backend step |
|---|---|
| action routes, `returnTarget`, `lastHandoff`, `returned` filter | service/controller (§3, §5) |
| capabilities `drafts` / `records` in `/api/users` | guard (§2) |
| `409 ITEM_HAS_OPEN_TASK` | migration + create (§1, §3) |
| `/items/:id/validation`, `PUBLISH_VALIDATION_FAILED` | metadata schema v2, B6 — built 2026-09-24 (dev); response shapes in the [web schema v2 plan](metadata-schema-v2.md#what-the-backend-now-provides-2026-09-24) |

## Estimate

API layer S · detail page + dialogs M · lists/badges/history S · i18n S.

## Manual test script (no frontend test runner exists)

As cataloguer / editor / admin in two browsers: create GENERAL → complete to FIX
for the cataloguer → complete to REVIEW for the editor → return → verify it is
back with the cataloguer as FIX with the note → complete → as editor, PUBLISH →
item is a record, task completed, history reads correctly in both languages.
Plus: second task on the same item (409 link), reassign to self (not offered),
cataloguer on a REVIEW task (no Publish button).
