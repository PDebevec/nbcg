# Task workflow v2 — stages instead of statuses

## Status: BACKEND DONE (2026-09-25) · web frontend open · deploy together

The backend implements everything below (details it pinned down are marked
*built 2026-09-25*). Not deployed: the current web frontend's task buttons send
PATCHes v2 rejects, so both go out together.

| Doc | What it covers |
|---|---|
| **this file** | The state machine and the API both sides build against. |
| [Backend plan](../../backend/plans/task-workflow-v2.md) | Migration, endpoints, guards, tests. |
| [Web frontend plan](../../frontend/plans/task-workflow-v2.md) | Buttons, dialogs, inbox, badges. |

Builds on the delegation feature as shipped
([backend design](../../backend/history/task-delegation-plan.md),
[history rewrite](../../backend/history/task-history-rewrite.md),
[frontend](../../frontend/history/task-delegation.md)). The `tasks` +
`task_history` split, the append-only log, "one user action = one history row",
snapshot names on the log, and "publishing closes review tasks however it
happened" all stay.

A backend + web change. Assumption to confirm: the desktop archive app does not
call `/api/tasks`; if it does, it breaks on the removed statuses and the PATCH
restrictions exactly like the web client would.

---

## What changes and why

| Today | v2 | Why |
|---|---|---|
| Statuses `OPEN`, `IN_PROGRESS`, `RETURNED`, `COMPLETED`, `CANCELLED` | `OPEN`, `COMPLETED`, `CANCELLED` | "Start working" is a click nobody needs; "returned" is an event in the log, not a place a task sits. |
| `kind` is fixed at creation | `kind` is the task's **stage** and moves: `GENERAL` → `FIX_METADATA` → `REVIEW_PUBLISH` | One task follows the item through the work instead of a new task per step. |
| "Complete" is a status change | "Complete" **finishes the current stage**; what it does depends on the stage (below) | Each stage has one obvious next step. |
| Return → `RETURNED` status, default target = the creator | Return → **back one step**: the previous person **and** the previous stage | "Undo the last handover" — the person who gave it to me gets it back in the stage they had it. |
| Reassign may target anyone, incl. yourself | Reassign = same stage, different person, **never yourself** | |
| Several open tasks per item allowed | **At most one open task per item** | One person does one thing on an item at a time; no conflicting instructions. Finished/cancelled tasks are unlimited (history). |
| Publishing via a task = "Complete" + a separate Publish somewhere else | Completing a REVIEW_PUBLISH task **is** the publish (DRAFT → RECORD) | The task and the item cannot disagree. |

---

## The model

```text
          create                     complete (+ next)              complete (+ next)
 (creator) ───────► GENERAL ──────────────────────► FIX_METADATA ─────────────────► REVIEW_PUBLISH ──complete──► COMPLETED
                      │   └─complete (no next)──► COMPLETED                              │          (= publish)
                      │                                                                  │
                      └────────── any stage: return ◄── back one step ──────────────────┘
                                  any stage: reassign ── same stage, other person
                                  any stage: cancel ───► CANCELLED
```

A task may start in any stage (a cataloguer who finished a draft files
REVIEW_PUBLISH directly).

### Handoff stack

Every task carries the chain of who held it in which stage — a stack of
`{ userId, kind }`:

| Action | Stack effect |
|---|---|
| create (A creates for B, stage K) | `[ {A, —}, {B, K} ]` — or `[ {B, K} ]` if A = B |
| complete with next (B → C, stage K2) | push `{C, K2}` |
| reassign (→ E) | push `{E, same K}` |
| return | pop; the task goes to the new top (person **and** stage) |
| return with a different person chosen | pop, then replace the top's person (stage stays the popped-to stage) |

Worked example (the one agreed on 2026-09-23):

```text
A creates GENERAL for B                 stack: A,—  B,GENERAL
B completes → FIX_METADATA for C        stack: A,—  B,GENERAL  C,FIX
C completes → REVIEW_PUBLISH for D      stack: … C,FIX  D,REVIEW
D returns (note required)               → C, FIX_METADATA            stack: … B,GENERAL  C,FIX
C completes → REVIEW_PUBLISH for D      stack: … C,FIX  D,REVIEW
D reassigns to E                        → E, REVIEW_PUBLISH          stack: … D,REVIEW  E,REVIEW
E completes                             → item published, task COMPLETED
```

**Returning to the creator** (the bottom entry has no stage): the stage becomes
FIX_METADATA if it was REVIEW_PUBLISH (the requester must fix what the reviewer
found), otherwise it stays. A task whose stack has one entry cannot be returned
(there is nobody to return it to) — cancel or complete it instead.

*Built 2026-09-25:* that resolved stage is **written into the creator's entry**,
so from then on the creator is "a holder with a stage" like everyone else. It
matters when the task leaves them again: A files GENERAL for B → B returns (A
now holds GENERAL) → A completes with next FIX_METADATA for C → C returns → A
gets it back in **GENERAL**, the stage A had it in.

---

## Actions

Who may do what (all require being staff — `drafts:manage` or
`records:manage` — as today):

| Action | Assignee | Creator | `records:manage` (escape hatch) |
|---|---|---|---|
| complete | ✔ | — | ✔ |
| return | ✔ | — | ✔ |
| reassign | ✔ | ✔ | ✔ |
| cancel | ✔ | ✔ | ✔ |
| comment | any staff | | |
| edit title / description / due date | ✔ | ✔ | ✔ |

### Complete — by stage

| Stage | Body | Result |
|---|---|---|
| `GENERAL` | `{ note? }` | Task COMPLETED. Nothing else happens. |
| `GENERAL` | `{ note?, next: { kind: FIX_METADATA \| REVIEW_PUBLISH, assignedToUserId } }` | Stays OPEN, moves to `next.kind` with the new assignee — **may be yourself**. |
| `FIX_METADATA` | `{ note?, next: { kind: REVIEW_PUBLISH, assignedToUserId } }` — `next` **required** | Stays OPEN, moves to REVIEW_PUBLISH. Assignee must be able to publish (may be yourself if you can). |
| `REVIEW_PUBLISH`, item is a DRAFT | `{ note? }` | **Publishes the item** (DRAFT → RECORD, same code path and checks as any publish, incl. [publish validation](metadata-schema-v2.md#publish-validation)), then the task is COMPLETED. The caller's own token must allow publishing. |
| `REVIEW_PUBLISH`, item is already a RECORD | `{ note? }` | Task COMPLETED as "reviewed" — nothing to publish. (Happens after a FIX_METADATA on a published record.) |

If the item is published **outside** the task (items list, bulk publish,
editor), the open REVIEW_PUBLISH task closes itself in the same transaction and
the log names the real publisher — this exists today and stays. An open
GENERAL/FIX_METADATA task is left alone.

### Return — `{ note, assignedToUserId? }`

`note` is **required** (a return without a reason is a bug report without a
body; a blank one is rejected too). Goes back one step on the stack;
`assignedToUserId` overrides the person (e.g. the previous holder has left) but
not the stage. 400 when the stack has one entry, when the target cannot hold the
stage it lands in (same guard as everywhere), and when the return would leave
the task exactly where it is (override = current holder, same stage).

### Reassign — `{ assignedToUserId, note? }`

Same stage, different person. 400 when the target is **yourself** or the
current assignee.

### Cancel — `{ note? }`

CANCELLED, terminal.

Every action on a COMPLETED or CANCELLED task is a 400. `COMPLETED` is terminal
too — there is no reopen any more. If a publish went out
wrong: unpublish if needed and file a new FIX_METADATA task; the old one stays in
the item's task history. (Reopen made sense with several tasks per item; with at
most one open task it would have to fight whatever task was filed since.)

---

## Who can hold which stage

Advisory check against the user directory, as today (it can lag Keycloak by up to
a day; the authoritative check is the token at publish time):

| Stage | Item | Assignee must be able to |
|---|---|---|
| `GENERAL` | any | write (`drafts:manage` or `records:manage`) |
| `FIX_METADATA` | DRAFT | write drafts (`drafts:manage`) |
| `FIX_METADATA` | RECORD | write records (`records:manage`) — a cataloguer cannot edit a published record |
| `REVIEW_PUBLISH` | any | publish (`records:manage` and `drafts:manage`) |

The matching assignee picker is `GET /api/users?capability=…`: `staff` for
GENERAL, `drafts` / `records` for FIX_METADATA on a draft / record, `publish`
for REVIEW_PUBLISH. The 400 names what is missing, e.g. "A FIX_METADATA task on
a RECORD needs an assignee who can edit published records (records:manage)",
and says to run `POST /api/users/sync` if roles changed recently.

Today's rule is keyed on `(kind, status)` because a RETURNED review task sat with
a cataloguer. In v2 a returned review task *becomes* FIX_METADATA, so the rule is
keyed on `(kind, itemType)` instead.

---

## API

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/tasks` | `{ itemId, kind, title, description?, assignedToUserId, dueAt? }` | **409** `{ statusCode: 409, code: "ITEM_HAS_OPEN_TASK", message, taskId }` when the item already has an open task (checked before the assignee guard) |
| POST | `/api/tasks/:id/complete` | see table above | |
| POST | `/api/tasks/:id/return` | `{ note, assignedToUserId? }` | |
| POST | `/api/tasks/:id/reassign` | `{ assignedToUserId, note? }` | |
| POST | `/api/tasks/:id/cancel` | `{ note? }` | |
| PATCH | `/api/tasks/:id` | `{ title?, description?, dueAt? }` | `status` / `kind` / `assignedToUserId` → 400 "use the action endpoints"; `note` → 400 "use /comments" |
| POST | `/api/tasks/:id/comments` | `{ body }` | unchanged |
| GET | `/api/tasks`, `/api/tasks/:id`, `/api/tasks/item/:itemId/history` | | unchanged filters; `status` accepts only the three values; new filter `returned=true` (`false` = everything else) |

The four action routes answer **200** with the task view (as in a list row — no
`history`, no `returnTarget`). Errors: 400 for a rule (body, stage, guard,
terminal task), 403 when the caller may not do this action on this task (or,
completing a review of a draft, when their token cannot publish), 404 for an
unknown task. Completing a review of a draft passes publish validation's
`400 PUBLISH_VALIDATION_FAILED` through unchanged.

Response changes on the task view:

| Field | |
|---|---|
| `status` | `OPEN` \| `COMPLETED` \| `CANCELLED` |
| `kind` | the current stage |
| `lastHandoff` | `CREATED` \| `ADVANCED` \| `RETURNED` \| `ASSIGNED` — drives the "Returned to you" badge |
| `returnTarget` (detail only) | `{ userId, displayName, kind } \| null` — who and which stage "Return" would go to; `null` = Return disabled. **Replaces `returnTo`.** |

New history actions: `ADVANCED` (a stage completed and handed on), `COMPLETED`,
`CANCELLED`. `STATUS_CHANGED` and the old `IN_PROGRESS`/`RETURNED` values stay
readable in old log rows — the log is never rewritten.

What each action writes (one row each):

| Action | `action` | `changes` |
|---|---|---|
| create | `CREATED` | `kind`, `assignedToUserId` (before `null`); `note` = the description |
| complete with next | `ADVANCED` | whichever of `kind` / `assignedToUserId` moved |
| complete without next | `COMPLETED` | `status` OPEN → COMPLETED |
| complete REVIEW_PUBLISH on a record | `COMPLETED` | `status`, plus `{ path: "outcome", before: null, after: "ALREADY_PUBLISHED" }` |
| complete REVIEW_PUBLISH on a draft | `CLOSED_ON_PUBLISH` (by the observer, with the note) | `status` OPEN → COMPLETED |
| return | `RETURNED` | `kind` and/or `assignedToUserId` |
| reassign | `ASSIGNED` | `assignedToUserId` |
| cancel | `CANCELLED` | `status` OPEN → CANCELLED |
| PATCH | `UPDATED` | `title` / `description` / `dueAt` — nothing moved, no row |

`completedAt` is set on COMPLETED (either way), not on CANCELLED.

---

## Decisions

| Question | Decision | Date |
|---|---|---|
| What does "same status as before" mean on return? | Previous **stage + person** (stack pop) | 2026-09-23 (user) |
| Several tasks per item? | At most **one open** task per item | 2026-09-23 (recommended, user leaned the same way) |
| Reassign pushes or replaces on the stack? | **Pushes** — you return to whoever handed it to you | 2026-09-23 (proposed) |
| May FIX_METADATA → REVIEW_PUBLISH go to yourself? | Yes, if you can publish (editor fixes and publishes). Change to "someone else" if four-eyes review is wanted. | 2026-09-23 (proposed) |
| FIX_METADATA on a published RECORD | Assignee needs `records:manage`; its REVIEW_PUBLISH completes as "reviewed" | 2026-09-23 (proposed) |
| Reopen a completed task | Removed — file a new task | 2026-09-23 (proposed) |
| The creator's stage after a return to them | Written into their stack entry (see "Handoff stack") | 2026-09-25 (built) |
| Return that changes nothing | 400; a return to yourself that changes the stage is fine | 2026-09-25 (built) |
| Where the one-open-task rule lives | Partial unique index `tasks_one_open_per_item`, declared in `schema.prisma`; the service pre-checks for the 409 body | 2026-09-25 (built) |
