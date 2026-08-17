# Backend: `tasks` + `task_history` — rewrite of the task model

## Status: DONE — implemented 2026-08-16

Shipped as planned. 406 API-suite assertions pass, 66 jest tests pass (23 in
`tasks.service.spec.ts`). The plan below is unedited; the deviations are here.

### Deviations from the plan

1. **`returnTo`'s ordering was wrong in the plan, and the tests caught it.** The
   plan said "whoever last handed it over, *unless* they cannot act on it, then
   the creator" — but the admin case it was written to solve does not work that
   way: an admin holds `canWrite`, so the fallback never fires and the prefill
   lands on the admin anyway. The `TaskStatus` enum's own comment gave the right
   answer — *RETURNED — sent back to **the requester***. So the order is now
   **creator first**, last-handover as the fallback for when the creator has left
   or is the one holding it. Both branches are asserted.
2. **`UpdateTaskDto` gained a `note` field.** Implied by the plan's mapping table
   but never stated: the return reason has to arrive *with* the return, in the
   same atomic PATCH, or the log has a `RETURNED` row with no reason. It is
   optional — requiring it on a return is defensible and is a one-line change,
   but that is a product call.
3. **A no-op PATCH writes no history row.** Not in the plan. The GUI sends
   idempotent saves, and an audit log full of "changed nothing" is worse than
   useless.
4. **`GET /api/tasks/item/:itemId/history` is not admin-only.** The plan said to
   gate it "the same way as `GET /items/:id/history`, which is already
   admin-only" — the second half of that was wrong. That endpoint allows the
   cataloguer and denies the reader, and this one now matches it exactly. Both
   edges are asserted.
5. **`TaskHistoryService` has a `recordOne` as well as `record`.** `createMany`
   cannot return the created row, and `POST /tasks/:id/comments` renders it in
   the response; re-querying for "the newest row by this author" would be a race
   dressed up as a lookup.

### Found while working, NOT fixed — out of scope

`item_metrics_daily` and `file_metrics_daily` rows are never deleted when their
item is, so `GET /api/stats/items/top` returns deleted items with
`title: null, itemType: null`. Verified live: five of five `mostViewed` entries
were deleted test items. Pre-existing and unrelated to tasks, but it is
user-visible on any "most viewed" dashboard, and it makes the §14 top-items test
flaky as ghosts accumulate. Needs a decision — delete metrics with the item, or
filter them out of the stats read.

### The plan as written

Replaces the `work_tasks` / `task_comments` pair shipped on 2026-08-16 (see
[the delegation plan](backend-task-delegation-plan.md)) with:

- **`tasks`** — current state. Who gave what to whom, when, and how it stands now.
- **`task_history`** — append-only audit. What transpired, in order, attributed.

`task_comments` is deleted outright. A comment is not a kind of object; it is one
of the things that can happen to a task, and it belongs in the same log as every
other thing that can happen to a task.

## Why this is the right shape

**It is already the house pattern.** `item_revisions` is exactly `task_history`
for items: append-only, one row per change, `action` enum plus a `changes` diff,
actor id plus a **snapshot** of the actor's name, no FK to the thing it describes.
Tasks were the odd one out. After this rewrite, "current row + revision log" is
how both items and tasks work, and there is one idea to learn instead of two.

**It fixes a naming inconsistency in what shipped.** The rule in this codebase is
*snapshot for a specific row, directory for a group of rows*. The split makes the
two cases fall on either side of a table boundary instead of being muddled:

| | Names come from | Because |
|---|---|---|
| `tasks` | the directory, resolved live | a live work item must show who someone **is now**; a renamed assignee showing their old name on an open task is a bug |
| `task_history` | a **snapshot** column on the row | history is historical; a row saying "Ana Novak returned this" must keep saying that after Ana is renamed or leaves |

`task_comments.authorUserId` resolved live, with no snapshot — wrong for
something whose whole purpose is to record what happened. That bug disappears
here rather than being fixed.

**The payoff that the current design cannot give you at all:** see below.

---

## The decision that actually matters: history outlives the item

Today, `items.service.ts delete()` hard-deletes a task and cascades its comments
away. **The entire conversation is destroyed with the item.** For a workflow log
whose stated purpose is "audit if something needs to be checked", that is the one
thing it must not do.

`item_revisions` already made this call and made it the other way — its comment
says revisions "outlive the item they describe, and no FK may block a delete."
`task_history` follows it:

| Table | On item delete | Why |
|---|---|---|
| `tasks` | **deleted** | a task pointing at a deleted item is unactionable noise in someone's inbox forever |
| `task_history` | **kept** | it is the audit record; deleting it is the failure mode the table exists to prevent |

Two consequences, both load-bearing:

1. **No FK on `task_history.taskId`.** A FK would either block the task delete or
   cascade the audit away with it. Same reasoning, same absence, as
   `ItemRevision.itemId`.
2. **`task_history` carries `itemId` as well as `taskId`.** Otherwise, once both
   the task and the item are gone, a surviving row reads "RETURNED — missing
   author information" with nothing to attach it to. With `itemId` denormalised,
   "what happened around item Y" stays answerable forever. Cheap: one indexed
   string column, written once, never updated.

This is the part of the rewrite that buys something the current tables cannot,
and it is worth more than the tidiness.

---

## Phase 1 — Schema

`work_tasks` and `task_comments` are **both empty** (verified: `SELECT COUNT(*)`
returns 0 on each — the API suite cleans up after itself). So this is a drop and
recreate, not a data migration. The migration is destructive by construction and
should say so in a comment; it is safe **only** because the tables are empty, and
that must be re-checked immediately before running it.

```prisma
enum TaskStatus {
  OPEN
  IN_PROGRESS
  RETURNED
  COMPLETED
  CANCELLED
}

enum TaskKind {
  REVIEW_PUBLISH
  FIX_METADATA
  GENERAL
}

/// What happened to a task. Pick the MOST SPECIFIC action that describes the
/// actor's intent: a return is RETURNED, not STATUS_CHANGED plus ASSIGNED.
enum TaskAction {
  CREATED
  ASSIGNED          // handed to someone else without a status change
  STATUS_CHANGED    // picked up, completed by hand, cancelled, reopened
  RETURNED          // sent back with notes — the workflow's whole point
  COMMENTED         // a note, no state change
  UPDATED           // title, description, dueAt or kind edited
  CLOSED_ON_PUBLISH // the observer in transition()
}

/// Current state of a handoff between two members of staff. One row per live
/// task; everything that ever happened to it is in task_history.
model Task {
  id               String     @id @default(cuid())
  itemId           String
  kind             TaskKind   @default(GENERAL)
  title            String
  description      String?
  status           TaskStatus @default(OPEN)
  /// Keycloak sub. No FK — the directory is sync-populated, so a real user who
  /// has not been synced yet would be rejected by the database instead of by a
  /// 400. Names resolve live from the directory: this row is current state.
  assignedToUserId String
  createdByUserId  String
  dueAt            DateTime?  @db.Timestamptz(3)
  createdAt        DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime   @updatedAt @db.Timestamptz(3)
  completedAt      DateTime?  @db.Timestamptz(3)

  @@index([assignedToUserId, status])
  @@index([createdByUserId, status])
  @@index([itemId])
  @@map("tasks")
}

/// Append-only audit log. Never updated, never deleted — not even when the task
/// or the item it describes is deleted. That is the point of the table.
///
/// No relation to Task and no FK on either id: an FK would block the task delete
/// or cascade the audit away with it. Same call as ItemRevision.
model TaskHistory {
  id       String     @id @default(cuid())
  taskId   String
  /// Denormalised from the task at write time so "what happened around item Y"
  /// survives the deletion of both the task and the item.
  itemId   String
  action   TaskAction
  /// What a human reads: the return reason, the comment body. Its own column
  /// rather than a key in `changes` because two actions use it and it should be
  /// greppable.
  note     String?
  /// [FieldChangeList] — before/after for whatever moved, reusing the same
  /// shape as item_revisions.changes.
  changes  Json?
  /// Keycloak sub of whoever did it. The real person even for CLOSED_ON_PUBLISH:
  /// "closed by Ana publishing it" is more use than "closed by system".
  userId   String
  /// SNAPSHOT of the display name, captured at write time and never updated —
  /// same rule as ItemRevision.userName. Aggregates must group by `userId`
  /// alone, or a renamed person splits into two rows.
  userName String
  createdAt DateTime  @default(now()) @db.Timestamptz(3)

  @@index([taskId, createdAt])
  @@index([itemId, createdAt])
  @@index([userId, createdAt])
  @@map("task_history")
}
```

`@db.Timestamptz(3)` throughout, as everywhere else. Neither table goes into
`pgsync/schema.json`, for the reason `item_revisions` does not: CDC re-indexes the
whole document on any tracked change.

---

## Phase 2 — Writing history

Every mutation writes exactly one history row **inside the same transaction as
the change**. Not after, not best-effort: `RevisionsService.record()` takes a
`tx` for precisely this reason, and its comment is the argument — "history that is
not written in the same transaction as the item can disagree with it, and a
timeline that disagrees with the record is worse than no timeline."

A small `TaskHistoryService` mirroring `RevisionsService`, so `TasksService` never
hand-rolls a row:

```ts
async record(input: {
  taskId: string;
  itemId: string;
  action: TaskAction;
  note?: string;
  changes?: FieldChange[];
  actor: Actor;          // id + name snapshot travel together, as everywhere
}, tx?: TaskHistoryWriter): Promise<void>
```

Mapping from what happens to what gets written:

| Endpoint / event | action | note | changes |
|---|---|---|---|
| `POST /tasks` | `CREATED` | `description` | `kind`, `assignedToUserId` |
| `PATCH` status+assignee to `RETURNED` | `RETURNED` | the reason | `status`, `assignedToUserId` |
| `PATCH` assignee only | `ASSIGNED` | — | `assignedToUserId` |
| `PATCH` status only | `STATUS_CHANGED` | — | `status` |
| `PATCH` title/description/dueAt/kind | `UPDATED` | — | each changed field |
| `POST /tasks/:id/comments` | `COMMENTED` | the body | — |
| observer in `transition()` | `CLOSED_ON_PUBLISH` | — | `status` |

**One user action produces one history row.** A return moves status and assignee
together — the API already enforces that they travel in one atomic `PATCH` — so
splitting it into a `RETURNED` row plus an `ASSIGNED` row would record two events
that never separately happened. The assignment rides in `changes` and renders
inline:

```
10:02  cataloguer cataloguer   CREATED           assigned to editor editor
11:32  editor editor           RETURNED          to cataloguer cataloguer
                               "Missing author information"
11:47  cataloguer cataloguer   ASSIGNED          to editor editor
12:05  editor editor           CLOSED_ON_PUBLISH
```

*(This is the one place this plan departs from the sketch that prompted it, which
had a separate `System ASSIGNED_TO publisher1` row a minute after the rejection.
Attributing the reassignment to "System" loses the fact that the publisher chose
who to send it back to — and there is no System actor here, because a human did
all of it. `SYSTEM_ACTOR` exists in this codebase and is reserved for genuinely
unattended work like COBISS imports. See "Open fork" below if the granular
version is wanted anyway.)*

### Reads

- `GET /tasks` — unchanged in shape, minus `commentCount`. A list is for
  triage, and no list view needs the log.
- `GET /tasks/:id` — returns the task, `history[]` (oldest first, comments and
  events interleaved chronologically — that single array renders the audit view
  directly), and the derived `returnTo` described under "Resolved" below.
- `GET /tasks/:id/history` — **not a separate endpoint.** The detail read already
  has it, and a task's log is bounded by how many times five people touched one
  handoff. Add it only if a task ever accumulates enough rows to need paging.
- **`GET /items/:id/task-history`** — worth building *because* history now
  outlives the item: `?itemId=` is the query that answers "what happened around
  this record", including for tasks that no longer exist. Gate it the same way as
  `GET /items/:id/history`, which is already admin-only.

Name resolution splits along the table boundary, and this is the part to get
right: `tasks` resolves assignee/creator names through
`UsersService.resolveNames()` (current names, batched across the whole response),
while `task_history` renders `userName` **straight off the row** — no lookup at
all. A history row that changed its name would be a bug.

---

## Phase 3 — Cascade and observer

`items.service.ts delete()`, replacing the current `workTask.deleteMany`:

```ts
// Live tasks die with the item — a task pointing at a deleted item is
// unactionable noise in someone's inbox forever. task_history deliberately does
// NOT die with it: it is the audit record, it has no FK to block or cascade, and
// its rows carry itemId so they stay readable once both are gone.
await tx.task.deleteMany({ where: { itemId: { in: ids } } });
```

The observer in `transition()` keeps its logic exactly — close every
`OPEN`/`IN_PROGRESS`/`RETURNED` `REVIEW_PUBLISH` task on a published item — and
swaps its `taskComment.createMany` for a `taskHistory.createMany` with action
`CLOSED_ON_PUBLISH`, attributed to the real publisher.

Everything else from the shipped work stands unchanged and is **not** in scope
here: the `(kind, status)` assignee guard, `assertIsStaff`, the `capability=staff`
picker, the `/api/users` lockdown, the `?itemIds=` badge query.

---

## Phase 4 — Tests

§18 is 82 assertions and roughly a third of them mention comments. Rewrite rather
than patch. Everything already there stays except the comment-specific cases; add:

1. `CREATED` is written on file, naming creator and assignee
2. a return writes **one** `RETURNED` row carrying the note and both changed fields
3. a plain reassign writes `ASSIGNED`, not `RETURNED`
4. a comment writes `COMMENTED` with the body in `note`
5. history is ordered oldest-first and interleaves comments with events
6. `userName` on a history row is a **snapshot** — rename the user in the
   directory, re-read, and the old name is still there. *(Mirror the existing
   attribution test at §15, which does this for `createdByName`.)*
7. assignee name on the **task** is live — same rename, and the task shows the
   new name. The pair of tests is the whole naming rule, asserted.
8. **the one that matters:** delete the item; the `tasks` row is gone (`GET
   /tasks/:id` → 404) and `SELECT count(*) FROM task_history WHERE "itemId"=…`
   is **unchanged**
9. `CLOSED_ON_PUBLISH` is attributed to the publisher, not to `system`
10. `returnTo` on an ordinary round trip is the cataloguer who filed it
11. `returnTo` after an admin reassigns the task is **still** the cataloguer, not
    the admin — the rule-2 fallback, and the one the GUI would otherwise get
    wrong in a way the API then rejects
12. neither table appears in `pgsync/schema.json`

`tasks.service.spec.ts` is unaffected — it covers the `(kind, status)` matrix,
which does not change. Re-run it anyway; it is not wired into any build step.

---

## Phase 5 — Documentation

- `BACKEND_REFERENCE.md` — replace the `work_tasks`/`task_comments` table block
  and the Tasks endpoint section; state the delete asymmetry explicitly, since it
  is the surprising part.
- [the delegation plan](backend-task-delegation-plan.md) — mark superseded on the
  storage model, still authoritative on the guard, the observer and the picker.
- `todo/README.md`, and drop the now-stale `task_comments` mention from
  [the schema-split doc](backend-postgres-schema-split.md) (three tables still
  move together, one of them is now named differently).

---

## Estimate

| Phase | Hours |
|---|---|
| 1 — schema + drop/recreate migration | 0.5 |
| 2 — `TaskHistoryService`, history on every mutation, read paths, `returnTo` | 3.25–3.75 |
| 3 — cascade asymmetry + observer swap | 0.5 |
| 4 — §18 rewrite + the snapshot/live pair + the survives-delete case | 2.5–3 |
| 5 — docs | 0.75 |
| **Total** | **7.5–8.5** |

Cheaper than the original 11.5–13.5 because the module, the guards, the picker
and the `/api/users` work all survive untouched. The cost is concentrated in
Phase 2, and within it in getting the `changes` diff right for each action.

## Resolved: one row per user action

The alternative was one row per atomic *fact* — `RETURNED` and `ASSIGNED` as
separate rows, per the original sketch. The only thing that bought was querying
assignment history directly (`WHERE action = 'ASSIGNED'` instead of reading
`changes`), and that query is not wanted: the real use case behind it is "prefill
who to return this to", which is served by `returnTo` below without touching the
log at all.

So: one row per action, the log matches what people actually did, and no
fabricated `System` actor. If assignment history ever does need querying on its
own, that is an index and a view over `changes`, not a schema change.

### `returnTo` — a derived field on the task detail

`GET /tasks/:id` returns, alongside `history[]`:

```jsonc
"returnTo": { "userId": "…", "displayName": "cataloguer cataloguer" }
```

The publisher's "return with notes" dialog prefills its assignee picker from
this. Derived, never stored — it is a fact about the history, and a column would
be one more thing to keep in step.

Deriving it in the backend rather than letting the GUI scan `history[]` is worth
the twenty lines: the rule below has a genuine edge case, and it should be got
right once rather than in every client that grows a return button — the desktop
archive app included.

**The rule, and the case that makes it non-obvious:**

1. the most recent history row that moved `assignedToUserId` **to** the current
   assignee — its `userId` is who handed it over, so it is who gets it back;
2. **unless** that person cannot act on the task's `kind`, in which case fall
   back to `createdByUserId`.

Rule 2 is the edge case. An admin unsticking a task — reassigning it from one
publisher to another — becomes "who handed it to me" under rule 1, and returning
a `REVIEW_PUBLISH` task *to the admin* is wrong: the person who needs to fix the
author field is the cataloguer who filed it. The `(kind, status)` guard would
reject the assignment anyway, so without rule 2 the GUI would cheerfully prefill
a value the API then 400s.

`createdByUserId` is the fallback because for `REVIEW_PUBLISH` — the only kind
that returns — the creator is by construction someone who can write, and is
overwhelmingly the right answer in the first place.

Assert both branches: the ordinary round trip prefills the cataloguer, and a
task an admin reassigned still prefills the cataloguer rather than the admin.

## Risks

1. **The migration is destructive.** Safe only because both tables are empty —
   re-verify with `SELECT COUNT(*)` immediately before running, not from this
   document.
2. **A history write that is not in the transaction** would let a task and its log
   disagree. Every call site takes `tx`; the observer's is inside
   `transition()`'s existing transaction.
3. **`task_history` grows forever and is never pruned.** Intended. At this scale
   it is rounding error against `item_revisions`, but it is unbounded by design
   and nobody should later "clean it up" without deciding that deliberately.
4. **`itemId` on history is denormalised**, so it is *not* updated if a task is
   ever repointed at a different item. Nothing supports doing that today, and
   nothing should — the log would become incoherent.
