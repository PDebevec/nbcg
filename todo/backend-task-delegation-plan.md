# Backend: Task Delegation — Implementation Plan

## Status: DONE — implemented 2026-08-16, storage model since SUPERSEDED

> **Superseded on storage only.** `work_tasks`/`task_comments` were replaced the
> same day by `tasks` + `task_history` — see
> [the rewrite](backend-task-history-rewrite.md). `task_comments` is gone: a
> comment is now one action in an append-only log, and the log **survives item
> deletion**, which this design could not do.
>
> Everything else here still stands and is still the authority for it: the
> `(kind, status)` assignee guard, the return flow, the publish observer, the
> `assertIsStaff` predicate, the `capability=staff` picker, the `/api/users`
> lockdown, and the `?itemIds=` badge query. Where this document describes
> comments or the delete cascade, read the rewrite instead.

Shipped as planned across all five phases. 383 API-suite assertions pass (82 of
them new in §18), 54 jest tests pass (12 new). What follows is the plan as
written; the deviations below are the only places the implementation and the
plan disagree, and the plan text has NOT been rewritten to hide them.

### Deviations from the plan

1. **`RETURNED` needs an explicit reassignment rule.** The plan said the
   atomicity requirement follows from the `(kind, status)` guard — "each one is
   invalid without the other". Half of that is wrong. Test 27 (reassign to a
   cataloguer while still `OPEN`) does fall out of the guard. Test 26 (`status:
   RETURNED` alone, left with the publisher) does **not**: `RETURNED` requires
   `canWrite`, and a publisher holds write, so the guard would have passed it.
   Entering `RETURNED` now explicitly requires a *different* assignee in the same
   request, commented in `tasks.service.ts` as not falling out of the guard.
2. **Test 4 is not expressible and was not written.** "A task filed against an
   item the caller cannot see → 404" cannot be observed with the four personas:
   everyone who passes `assertIsStaff` (editor, admin, cataloguer) can already
   see HIDDEN drafts and records, and everyone who cannot is stopped by the staff
   gate first. The `assertCanView` call is still there and still correct — the
   unknown-item case (test 11) exercises the same line. Noted in the suite rather
   than faked with a test that proves nothing.
3. **`?itemIds=` capped at 200**, as flagged when the plan was accepted.
4. **Unit tests were added, not just considered.** `tasks.service.spec.ts`
   covers the `(kind, status)` matrix. Mutation-checked: reverting the guard to
   the naive kind-only rule fails the RETURNED case, so the test is load-bearing
   rather than decorative.
5. **The migration needed a repair first.** `prisma migrate dev` refused to run,
   demanding a full reset, because `20260811120000_add_item_revisions_and_usage_metrics`
   had two rolled-back rows in `_prisma_migrations` and the first carried the
   checksum of a pre-fix version of the file. That row applied nothing; its
   checksum was realigned rather than resetting the database. Worth knowing:
   **that drift is still latent for anyone with a fresh clone** — it only
   surfaces when someone next runs `migrate dev`.

### The plan as written

The sequenced plan for [Task Delegation](backend-task-delegation.md). Read that
document for *why* the feature exists and for the two Keycloak traps; read this
one for what to build. Where they disagree, this one wins — the differences are
listed under "Corrections" below.

## Scope decision: the tables go in `public`

Considered and rejected: putting `work_tasks`/`task_comments` in a new `app`
schema alongside `user_profiles`, per
[Move `user_profiles` out of `public`](backend-postgres-schema-split.md).

The reasoning is worth recording, because the instinct behind it was right and
will recur. Tasks genuinely are not metadata — a task is a conversation between
two members of staff that happens to name an item, and `work_tasks` would be
worthless the moment the collection were handed to someone else. That is a real
distinction and it deserves to be visible.

But a Postgres schema is the wrong tool to express it. Schemas are a
namespacing-and-permissions mechanism; the thing that makes one earn its keep is
a **grant boundary** — a role that reads the catalogue and not the staff
directory. There is no such role today and none planned, so the split would buy
tidiness and charge:

- Every model and every enum needs `@@schema(...)` forever (18 annotations, and
  one per future model). Cheap — forgetting one is a `P1012` build failure.
- **Every raw query against the new schema must qualify, or it fails at
  runtime.** This is the real cost. The codebase has 8 `$queryRaw` /
  `$executeRawUnsafe` sites across `stats.service.ts`, `metrics.service.ts` and
  `relations.service.ts`. "Open tasks per person" is an obvious future stats
  endpoint, and it would be written in raw SQL by habit, unqualified, and pass
  the build.

And the decisive point: **splitting later costs exactly what splitting now
costs.** `ALTER TABLE … SET SCHEMA` is catalogue-only — instant at any row count,
indexes and constraints follow. The annotation work is the same 18 lines
whenever it happens. There is no window closing, so there is no reason to pay
before the benefit exists.

The split document stays as-is, PLANNING. Its live-verified Prisma/pgsync/backup
facts are the expensive half and they remain valid. **Reopen it the day someone
needs a database connection that must not see staff names and emails** — then
move `user_profiles`, `work_tasks` and `task_comments` together in one go.

No table prefix either. `work_tasks`, `task_comments` and `user_profiles`
already read as workflow rather than catalogue, and renaming `user_profiles`
would cost a migration plus 13 raw-SQL edits to buy nothing. A grouped comment
block in `schema.prisma` carries the distinction at zero cost.

## Corrections to `backend-task-delegation.md`

1. **`TaskKind` exists.** Decided in conversation, never written down. The doc's
   guard rail — "assigning a *review/publish* task to a non-publisher is a 400" —
   is unenforceable without it, because `title`/`description` are free text.
2. **`WorkTask` needs a second index.** The doc lists only
   `@@index([assignedToUserId, status])`, but `?createdBy=me` is an advertised
   filter and would seq-scan.
3. **A new authorisation predicate is required.** The doc points at
   `assertAuthenticated` for "being staff is the whole requirement", but that
   lets `reader` assign work to colleagues. See Phase 2.
4. **"Where the tables live" is settled**: `public`, per the section above, and
   with no `@@schema` annotation because the split is not happening.

---

## Phase 1 — Schema

One ordinary migration. Append to `schema.prisma`, grouped under a comment that
carries the domain distinction the schema split would otherwise have expressed:

```prisma
// ---------------------------------------------------------------------------
// Staff workflow. Not metadata: a task is a conversation between two people
// that happens to name an item, and nothing here would be exported with the
// collection. Deliberately in `public` anyway — see
// todo/backend-task-delegation-plan.md for why a separate schema was rejected,
// and what would make it worth revisiting.
// ---------------------------------------------------------------------------

enum TaskStatus {
  OPEN         // assigned, not picked up
  IN_PROGRESS  // assignee is working on it
  RETURNED     // sent back to the requester with notes
  COMPLETED
  CANCELLED
}

/// What kind of work is being asked for. Exists because the assignee guard rail
/// differs by kind and free text cannot be checked: a REVIEW_PUBLISH task
/// assigned to someone who cannot publish is unfinishable by construction,
/// while a GENERAL "have a look at this" is fine for any colleague who writes.
enum TaskKind {
  REVIEW_PUBLISH  // "this is ready, please publish it"
  FIX_METADATA    // "the author field is wrong"
  GENERAL         // anything else, passed to any colleague
}

/// A handoff between two members of staff about one item.
///
/// `itemId` is stable across a DRAFT <-> RECORD transition (transition()
/// preserves the id), so a task filed against a draft still points at the right
/// thing after publication. Deliberately no stored `itemType` — it would go
/// stale on the very transition the task exists to request. Resolve at read
/// time, batched.
///
/// No FK on `itemId`: the reference is polymorphic across drafts and records,
/// same situation as ItemRelation. Deletion cleanup is explicit — see
/// items.service.ts delete().
model WorkTask {
  id               String        @id @default(cuid())
  itemId           String
  kind             TaskKind      @default(GENERAL)
  title            String
  description      String?
  status           TaskStatus    @default(OPEN)
  /// Keycloak sub. No FK to UserProfile — see below.
  assignedToUserId String
  createdByUserId  String
  dueAt            DateTime?     @db.Timestamptz(3)
  createdAt        DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime      @updatedAt @db.Timestamptz(3)
  completedAt      DateTime?     @db.Timestamptz(3)
  comments         TaskComment[]

  @@index([assignedToUserId, status])
  @@index([createdByUserId, status])
  @@index([itemId])
  @@map("work_tasks")
}

model TaskComment {
  id           String   @id @default(cuid())
  taskId       String
  task         WorkTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  /// The real actor, even for system events — "published by Ana Novak" is more
  /// use than "published by system".
  authorUserId String
  body         String
  /// Written by the backend rather than typed by a person: currently only the
  /// auto-close on publish. Rendered as an event, not a message, so a task
  /// never appears to close by itself.
  isSystem     Boolean  @default(false)
  createdAt    DateTime @default(now()) @db.Timestamptz(3)

  @@index([taskId])
  @@map("task_comments")
}
```

`@db.Timestamptz(3)` on every timestamp. Plain `timestamp` was fixed
project-wide because pgsync emitted offset-less strings that clients parsed as
local time.

### The FK that must not be added

`assignedToUserId` → `user_profiles.userId` is tempting and wrong:

- `user_profiles` is populated by a sync that runs daily. A user who exists in
  Keycloak but has not been synced would have their assignment rejected by the
  database — a constraint violation instead of a 400.
- Directory rows are never hard-deleted, so the FK would hold ~always. That
  makes the rare failure *worse*, because nobody will ever have seen it.
- `UsersService.resolveNames()` already guarantees every id renders, falling
  back to `'Unknown user'`. The integrity a FK would buy is already bought.

Same reasoning as `Draft.createdByUserId`, which has no FK for this reason plus
`'system'`.

### Not in pgsync

Neither table goes into `infrastructure/docker/pgsync/schema.json`, for the
reason `item_revisions` is not: CDC re-indexes the whole document on any tracked
change, so a comment on a task would re-index the item it points at — metadata
and nested `extractedText` included. Asserted by a test in Phase 4.

`npx prisma migrate dev --name add_work_tasks` · `npx prisma generate`.

---

## Phase 2 — `TasksModule`

```
src/modules/tasks/
  tasks.module.ts        imports UsersModule (for UsersService)
  tasks.controller.ts
  tasks.service.ts
  dto/create-task.dto.ts
  dto/update-task.dto.ts
  dto/tasks-query.dto.ts
  dto/create-comment.dto.ts
```

Register in `app.module.ts` after `UsersModule`.

### Endpoints

| Method | Path | Who |
|---|---|---|
| `POST` | `/api/tasks` | staff-with-write, **and** can view the item |
| `GET` | `/api/tasks` | staff-with-write |
| `GET` | `/api/tasks/:id` | staff-with-write |
| `PATCH` | `/api/tasks/:id` | assignee, creator, or `records:manage` |
| `POST` | `/api/tasks/:id/comments` | staff-with-write |

`GET /api/tasks/assignable-users` is **not** built. It already exists as
`GET /api/users?capability=publish`, in its own module, because the directory
outlives task delegation.

### The missing authorisation predicate

Nothing today expresses "holds at least one write capability".
`@RequireScopes` is AND-only so it cannot say `drafts:manage OR records:manage`,
and `assertAuthenticated` is too weak — `reader` holds only `records:view:*` and
has no business assigning work to people. Add to `ResourceAccessService`,
beside `assertAuthenticated`:

```ts
/**
 * Holds at least one write capability — the bar for participating in task
 * delegation. `@RequireScopes` is AND-only and cannot express the disjunction;
 * `assertAuthenticated` would let `reader` assign work to colleagues.
 */
assertIsStaff(principal: Principal): void {
  if (principal.isAnonymous) throw new UnauthorizedException();
  if (!principal.scopes.has('drafts:manage') && !principal.scopes.has('records:manage')) {
    throw new ForbiddenException('Requires drafts:manage or records:manage');
  }
}
```

Creating a task additionally calls `assertCanView(principal, itemId)`, which
returns **404** rather than 403 for an invisible item — so filing a task cannot
be used to probe for hidden records. That one call also covers the task
document's "validate `itemId` resolves to a real draft or record".

Note what is deliberately *not* required: `assertCanManage(principal, itemId)`.
A cataloguer who spots a typo in a published record cannot fix it — which is
precisely why they need to file `FIX_METADATA` against it. A task is a request,
not a mutation.

### Assignee validation, by kind **and status**

The obvious rule — "`REVIEW_PUBLISH` ⇒ assignee must be able to publish" — is
wrong, and the return flow is what exposes it. A returned `REVIEW_PUBLISH` task
sits with a cataloguer who needs to *fix* it, not publish it; the naive rule
would reject the return with a `400`. `kind` describes the **goal** ("get this
published"); `status` plus assignee describe **where it currently sits**. So the
guard keys on the pair:

| kind | status | Assignee must hold |
|---|---|---|
| `REVIEW_PUBLISH` | `OPEN`, `IN_PROGRESS` | `canPublish` |
| `REVIEW_PUBLISH` | `RETURNED` | `canWrite` |
| `FIX_METADATA`, `GENERAL` | any | `canWrite` |
| *(all)* | *(all)* | plus: exists in the directory and is active |

`canWrite` = `drafts:manage` **or** `records:manage` — reads the raw `scopes[]`
column, exactly what it was stored for ("so a future capability question needs
no migration and no resync"). No new column, no resync.

One function, re-run on create, on reassign, on `kind` change **and on status
change** — the last one is the case that only exists because of the pair rule.

**Comment this guard as advisory when you write it.** `canPublish` and `scopes`
come from a directory up to one sync interval (24h) stale, so it can reject an
assignment the assignee's own token would in fact permit.
`POST /api/users/sync` fixes that instantly. The authoritative check remains
`assertCanTransition(principal)` reading the JWT at publish time — **`canPublish`
must never gate an actual permission.**

`UsersService` gains one method, so `TasksService` never touches
`prisma.userProfile` directly (the directory has exactly one reader for the same
reason it has exactly one writer):

```ts
/** Assignability facts for one user. `null` if the directory has never seen them. */
async assignability(userId: string): Promise<{
  isActive: boolean;
  canPublish: boolean;
  canWrite: boolean;   // drafts:manage OR records:manage
} | null>
```

### Response shape

```jsonc
{
  "id": "clx…",
  "itemId": "cly…",
  "itemType": "DRAFT",           // resolved at read time, never stored
  "kind": "REVIEW_PUBLISH",
  "title": "Ready for review",
  "description": "Checked against COBISS.",
  "status": "OPEN",
  "assignedToUserId": "1d8c…",
  "assignedToName": "Ana Novak", // resolved, never a bare UUID
  "createdByUserId": "9f2a…",
  "createdByName": "Jan Horvat",
  "dueAt": null,
  "createdAt": "2026-08-15T09:12:44.031+02:00",
  "updatedAt": "2026-08-15T09:12:44.031+02:00",
  "completedAt": null,
  "commentCount": 2
}
```

Detail view adds `comments: [{ id, authorUserId, authorName, body, createdAt }]`.

**Two things that must be batched, not done per row:**

1. **Names.** Collect every `assignedToUserId`, `createdByUserId` and (on detail)
   `authorUserId` across the whole response, then **one** `resolveNames()` call.
   A task list is bounded (`?assignedTo=me&status=OPEN`), so this is one extra
   indexed query per response.
2. **`itemType`.** Two `findMany({ where: { id: { in: ids } } })` calls, one per
   collection — **not** `resolveCollection()` per row, which is 2 queries each.

No snapshot name columns on `work_tasks`. The snapshot pattern on
`drafts`/`records` exists because those tables are pgsync-tracked and a
name-follows-Keycloak column would re-index every document a renamed person ever
touched. `work_tasks` is not tracked and scales with staff activity, not the
50,000-item collection. And a live work item should show who someone *is now* —
a renamed assignee showing their old name on an open task is a bug, where on a
two-year-old revision it is history. The governing rule: **snapshot for a
specific row, directory for a group of rows.** Tasks are read as groups.

### Status rules

- `completedAt` is set on entering `COMPLETED` and cleared on leaving it.
- `CANCELLED` is terminal — any status change on a cancelled task is `400`. It
  is the "never mind" state, and reopening it hides that something was abandoned.
- `COMPLETED` is **not** terminal. `COMPLETED → RETURNED` is a real workflow: a
  publish went out wrong and needs pulling back.
- Reassigning, changing `kind`, **or changing status** re-runs the assignee
  validation against the resulting `(kind, status, assignee)` triple. Promoting
  a `GENERAL` task to `REVIEW_PUBLISH` while it is assigned to a cataloguer is
  `400`, same as creating it that way.
- **No `expectedVersion`.** Items carry optimistic concurrency because two
  cataloguers editing one record is a real collision. Two people editing one
  task is not, and a version field on every PATCH is friction the frontend pays
  for nothing. Deliberate omission, not an oversight.

### The return flow is one task, not two

Returning work is a single `PATCH` that moves status and assignee together:

```jsonc
PATCH /api/tasks/41
{ "status": "RETURNED", "assignedToUserId": "<the cataloguer they picked>" }
```

One task ping-pongs for its whole life; the comment thread accumulates in one
place, so "why was this returned twice?" is one screen rather than a chain walk.
This is what GitHub does (requesting changes on a PR does not open a new PR) and
what Jira does (reopening does not create a new issue).

The alternative — close this task, open a fresh one for the next person — was
rejected: it fragments the conversation across N rows with no link between them,
and reconstructing "how many rounds did this take?" would need a
`previousTaskId` column that exists only to undo the fragmentation.

Note the atomicity requirement: status and assignee **must** move in the same
request, because the `(kind, status)` guard above makes each one invalid without
the other. `RETURNED` while still assigned to the publisher is nonsense, and
reassigning to a cataloguer while still `OPEN` is a `400`.

```
Task #41  REVIEW_PUBLISH  "Ready for review"
  OPEN      → editor      cataloguer: "ready"
  RETURNED  → cataloguer  editor: "author field is wrong"
  OPEN      → editor      cataloguer: "fixed"
  COMPLETED               [system] published by editor
```

### Filters on `GET /api/tasks`

`assignedTo=me` · `createdBy=me` · `itemId=` · **`itemIds=a,b,c`** · `status=` ·
`kind=` · `limit`/`offset`.

`itemIds` is what feeds the **"has an open task" badge** in the item list: the
GUI renders a page of items, then makes one call —
`GET /api/tasks?itemIds=…&status=OPEN` — and marks the hits. One extra indexed
query per page against `@@index([itemId])`, and it behaves identically for
drafts and records.

Considered and rejected: an `openTaskCount` column on `drafts`/`records`. It
would make the badge free and let OpenSearch facet on "everything awaiting
review", but `drafts` is pgsync-tracked, so every task status change would
re-index the whole document including nested `extractedText`. Revisit only if a
"show me everything in review" *search* filter is actually wanted — the badge
alone does not justify it.

All staff see all tasks; `assignedTo=me` is a filter, not a wall. This is a
five-person internal tool where the *point* is being able to see who a draft is
waiting on. `me` resolves to `principal.sub`; a literal user id is also accepted.

---

## Phase 3 — Two integrations

### 3.1 Cascade on item delete

`items.service.ts:264`, inside the **existing** `$transaction`, alongside the
`itemRelation.deleteMany` already there:

```ts
// Tasks are workflow state, not audit: a task pointing at a deleted item is
// unactionable noise in someone's inbox forever, and the DELETE ItemRevision
// already records what happened. Deleting them here keeps the invariant that
// every task points at a real item, so no read path needs a missing-item
// branch. task_comments follow via ON DELETE CASCADE.
await tx.workTask.deleteMany({ where: { itemId: { in: ids } } });
```

One statement — `TaskComment.taskId` has `onDelete: Cascade`, which Prisma emits
as a real `ON DELETE CASCADE`, so the database removes the comments.

### 3.2 The observer — publishing closes its review tasks

Without this the task list lies: a publisher publishes the draft and the
"please review this" task stays `OPEN` forever in someone's inbox.

**Why an observer rather than a task-driven publish.** The alternative is
`POST /api/tasks/:id/publish`, where completing the task performs the
transition — which is how [InvenioRDM](https://inveniordm.docs.cern.ch/use/records/upload/)
does it (a draft stays private until its review request is *accepted*, and the
accept action is the publish). That works, but it does not remove the need for
this: `POST /api/items/transition` cannot be deleted — bulk publish, imports and
admins all use it — so a task-driven endpoint gives a clean happy path and still
leaves tasks lying whenever anyone uses the other door.

GitHub is the proof that the two compose rather than compete: the merge button
is task-driven, *and* a PR auto-closes when its commits reach the base branch by
any other route. The observer is the correctness mechanism; a task-driven
endpoint is ergonomics on top. **v1 builds the observer only.**

In `items.service.ts` `transition()`, inside the existing `$transaction`:

```ts
// A published item's review task is done, however it got published — the
// transition endpoint is also reachable via bulk publish, import and admin
// action, so the task list cannot rely on anyone going through the task.
// RETURNED is included deliberately: if the item went out anyway, the goal was
// reached and the task should not linger with the cataloguer.
if (targetState === ItemType.RECORD) {
  const closed = await tx.workTask.findMany({
    where: {
      itemId: { in: ids },
      kind: TaskKind.REVIEW_PUBLISH,
      status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.RETURNED] },
    },
    select: { id: true },
  });
  if (closed.length > 0) {
    await tx.workTask.updateMany({
      where: { id: { in: closed.map((t) => t.id) } },
      data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
    });
    // So a task never appears to close by itself.
    await tx.taskComment.createMany({
      data: closed.map((t) => ({
        taskId: t.id,
        authorUserId: actor.userId,
        body: `Published by ${actor.userName} — closing this review task.`,
        isSystem: true,
      })),
    });
  }
}
```

`transition()` already has `actor`, so no signature change.

Two rulings that follow:

- **Unpublishing does not reopen anything.** `RECORD → DRAFT` leaves completed
  tasks completed. Reopening them would be spooky action at a distance months
  later; if re-review is wanted, file a new task.
- **Every** open `REVIEW_PUBLISH` on the item closes, not just the one belonging
  to whoever published. The goal was reached regardless of who was holding it.

`FIX_METADATA` and `GENERAL` are untouched — publishing does not mean a metadata
fix was made, and there is no signal that would tell us it was.

### 3.3 `transition()` still preserves the id

Worth stating as a positive rather than leaving as an absence: the observer
above is the *only* change to `transition()`. It still preserves the id when
moving a row between tables, so a task survives publication untouched and starts
reporting `itemType: "RECORD"` on the next read. That is the entire
justification for storing an id and no type. Phase 4 asserts it.

### 3.4 The assignee picker — searchable dropdown

The GUI flow, and the reason the server-side guard in Phase 2 is not redundant:

```
1. user picks a kind          REVIEW_PUBLISH
2. kind maps to a capability  REVIEW_PUBLISH → publish
                              FIX_METADATA / GENERAL → staff
3. dropdown searches          GET /api/users?capability=publish&q=ana&limit=5
4. user picks Ana
5. POST /api/tasks { kind, assignedToUserId, itemId, … }
   → server re-derives the required capability from `kind` and re-checks
```

Step 5 never trusts step 2. The client-side filter is an affordance; the
authorisation is the `(kind, status)` guard. `limit` already exists on
`UsersQueryDto` (default 100, max 500), so `limit=5` works untouched.

#### `/api/users` becomes staff-only, and email stops being conditional

The directory exists to serve this picker, and only people who can delegate
tasks need it. So both read endpoints move from `assertAuthenticated` to
`assertIsStaff` — the same predicate Phase 2 adds for tasks:

```ts
// users.controller.ts — list() and get()
this.access.assertIsStaff(principal);   // was: assertAuthenticated
```

`reader` now gets a `403` from `GET /api/users` instead of a filtered list.
Verified safe: nothing outside the backend calls this endpoint — the frontend's
`users.ts` client is still unbuilt, and the only `/users?` hit in the tree is
Keycloak's own Admin API inside `keycloak-admin.service.ts`.

**That deletes `canSeeContactDetails()` and the conditional email.** It existed
to withhold addresses from principals below `drafts:manage`; once nobody below
that bar can reach the endpoint at all, the check is dead code that every call
site still has to reason about. Everyone who can call this is internal staff who
can see each other in Keycloak anyway. So:

- delete `canSeeContactDetails()`
- `toView()` loses its `withEmail` parameter and always returns `email`
- `UserProfileView.email` stops being optional

Net: an endpoint that is *more* restricted and *less* code, and the
email-in-search question disappears rather than being mitigated.

`FIX_METADATA` and `GENERAL` need a picker of "anyone who writes", which
`?capability=publish` does not give. In `UsersQueryDto`:

```ts
@IsEnum(['publish', 'staff'])
capability?: 'publish' | 'staff';
```

`staff` → `scopes` contains `drafts:manage` or `records:manage`. Includes
cataloguers, excludes readers — exactly the rule the non-publish kinds use.

No index for the `scopes` filter. It is an array-containment scan over a table
with five rows; a GIN index here would be ceremony.

#### Build the `where` clause as an `AND` array

Nothing is broken in `list()` today — `capability=publish` contributes
`{ canPublish: true }` and `q` contributes `{ OR: [...] }`, which are different
keys and get ANDed correctly. But the spread-fragments shape has one trap:
`capability=staff` also wants an `OR`, and a second `OR` key would overwrite the
first instead of combining. Sidestep it by collecting fragments explicitly:

```ts
const where: Prisma.UserProfileWhereInput = {
  AND: [
    ...(capability === 'publish' ? [{ canPublish: true }] : []),
    ...(capability === 'staff'
      ? [{ OR: [{ scopes: { has: 'drafts:manage' } }, { scopes: { has: 'records:manage' } }] }]
      : []),
    ...(active ? [{ enabled: true, deletedAt: null }] : []),
    ...(q ? [{ OR: [ /* displayName, username, email */ ] }] : []),
  ],
};
```

Filter to the capability, then search within it. Any number of fragments now
compose, `OR`-bearing or not.

---

## Phase 4 — Tests

Both suites. `npx jest` is not optional: it is wired into no build step, and the
directory task found it silently broken behind a green `npm run build`. A
type-level pass proves nothing about a `Set` used where an array was meant.

### `api-test-suite.sh` §18 "Task Delegation"

The persona facts are already asserted in §16 and can be relied on: `editor` and
`admin` publish, `cataloguer` does **not**, `reader` holds nothing relevant.

Authorisation
1. anonymous `POST /api/tasks` → 401
2. `reader` `POST /api/tasks` → 403
3. `reader` `GET /api/tasks` → 403
4. task filed against an item the caller cannot see → 404, not 403

Assignee guard rails
5. `cataloguer` → `editor`, `REVIEW_PUBLISH` → 201
6. `cataloguer` → `cataloguer`, `REVIEW_PUBLISH` → 400 *(the headline case)*
7. `cataloguer` → `reader`, `REVIEW_PUBLISH` → 400
8. `cataloguer` → `cataloguer`, `GENERAL` → 201
9. `cataloguer` → `reader`, `GENERAL` → 400
10. assignee not in the directory at all → 400
11. `itemId` that exists nowhere → 404

Reads
12. `?assignedTo=me` as `editor` contains it; `?createdBy=me` as `editor` does not
13. `?createdBy=me` as `cataloguer` contains it
14. `?itemId=` / `?status=OPEN` / `?kind=REVIEW_PUBLISH` each filter correctly
15. `GET /:id` returns `assignedToName` = `editor`'s display name, **not** a UUID
16. `commentCount` is correct; detail `comments[].authorName` resolves too
17. every timestamp in the response carries an offset

Mutation
18. `POST /:id/comments` as `editor` → 201
19. `PATCH` `OPEN → RETURNED` as `editor` (assignee) → 200
20. `PATCH` as an unrelated third party → 403
21. `PATCH` as `admin` (`records:manage`) → 200
22. `PATCH` to `COMPLETED` sets `completedAt`; away from it clears it
23. `PATCH` any status on a `CANCELLED` task → 400
24. reassign a `REVIEW_PUBLISH` to `cataloguer` → 400

The return flow
25. `PATCH { status: RETURNED, assignedToUserId: <cataloguer> }` on a
    `REVIEW_PUBLISH` task → **200**. This is the case the naive kind-only guard
    would have rejected; it is the regression test for the `(kind, status)` pair
    rule and must not be dropped.
26. `PATCH { status: RETURNED }` alone, leaving it with the publisher → 400
27. `PATCH { assignedToUserId: <cataloguer> }` alone while still `OPEN` → 400
28. after the round trip, `GET /:id` shows **one** task with the full comment
    thread — not two tasks

The observer
29. publish the item via `POST /api/items/transition` → the `REVIEW_PUBLISH`
    task is `COMPLETED` with `completedAt` set, **without anyone touching
    `/api/tasks`**
30. it also carries a trailing `isSystem: true` comment naming the publisher
31. a `RETURNED` task on the same item also closes (goal reached either way)
32. a `FIX_METADATA` task on the same item stays `OPEN` — publishing is not
    evidence a metadata fix was made
33. unpublish (`RECORD → DRAFT`) does **not** reopen the completed task
34. publishing an item with no tasks at all still works — guards the `closed.length === 0` path

The picker
35. `?capability=publish&q=<editor's name>&limit=5` returns `editor` and not
    `cataloguer`; `?capability=staff&q=…` returns both and not `reader`
36. **`?capability=staff&q=…` applies both conditions** — assert that a user
    matching `q` but failing `capability` is absent. Guards the `AND`-array
    shape against a future fragment reintroducing the key collision.
37. `reader` `GET /api/users` → **403** (was a filtered `200`). Also update the
    existing §16 case that asserts `reader` can read the directory — this is a
    deliberate behaviour change, not a regression.
38. `cataloguer` `GET /api/users` returns rows **including `email`** — the
    conditional-email path is gone.

The design claims, asserted
39. **id stability** — task on a draft reports `itemType: "DRAFT"`; publish it;
    the *same task id* now reports `itemType: "RECORD"`. The one test that
    proves the id-only design.
40. **badge query** — `?itemIds=a,b,c&status=OPEN` returns tasks for exactly the
    listed items
41. **cascade** — delete the item; `GET /api/tasks/:id` → 404, and
    `SELECT count(*) FROM task_comments WHERE "taskId"='…'` → 0
42. **pgsync exclusion** — neither `work_tasks` nor `task_comments` appears in
    `pgsync/schema.json`, alongside the existing `user_profiles` assertion

Note that 29 and 39 are the same fixture publishing the same item — write them
as one flow with two assertions rather than two setups.

### Also

`npx jest` — the existing 42 tests should be untouched. New unit tests for the
assignee-validation matrix are cheap there and need no running stack.

---

## Phase 5 — Documentation

- **`BACKEND_REFERENCE.md`** — the five new endpoints, and the `work_tasks` /
  `task_comments` rows in the table listing with a one-line note that they are
  staff workflow rather than metadata. Line ~506's claim that display-name
  resolution "does not exist yet" is already stale from the directory work and
  should be corrected while there.
- **`backend-task-delegation.md`** — apply the four corrections above and close
  the open questions.
- **`backend-postgres-schema-split.md`** — add a status note: deferred, not
  rejected; the trigger is a database role that must not see staff PII; when it
  happens, `work_tasks` and `task_comments` move with `user_profiles`.
- **`todo/README.md`** — statuses.

---

## Decisions taken

| Question | Decision | Consequence |
|---|---|---|
| Separate schema for tasks + directory | **No — `public`** | no `@@schema` tax, no unqualified-raw-SQL risk; revisit when a grant boundary exists |
| Item delete cascade | **hard delete** tasks + comments | one statement in the existing transaction; no read path handles a missing item |
| Notifications in v1 | **none** | the inbox is `GET /api/tasks?assignedTo=me&status=OPEN`; no SMTP exists to build on |
| Task visibility | **all staff see all tasks** | `assignedTo=me` is a filter; five-person tool, visibility is the point |
| Task kinds | `REVIEW_PUBLISH` / `FIX_METADATA` / `GENERAL` | per-kind assignee guard; free text cannot be validated |
| Assignee guard keyed on | **`(kind, status)`**, not `kind` alone | a returned `REVIEW_PUBLISH` needs `canWrite`, not `canPublish` |
| Return flow | **one task ping-pongs** | status + assignee move in one atomic `PATCH`; thread stays in one place |
| Closing a task on publish | **observer in `transition()`** | works no matter which door the publish came through |
| Task-driven publish endpoint | **not in v1** | it would not remove the need for the observer, so it is ergonomics, not correctness |
| Unpublish reopens tasks? | **no** | spooky action months later; file a new task if re-review is wanted |
| "Has open task" badge | **`?itemIds=` query** | one indexed query per page; no `openTaskCount` column, so no pgsync re-index |
| Who may read `/api/users` | **staff only** (`assertIsStaff`) | `reader` gets 403; the directory serves the picker and nothing else |
| Conditional email in the directory | **removed** | everyone who can reach the endpoint is internal staff; deletes `canSeeContactDetails()` and the `withEmail` branch |
| `records:publish` as a real scope | **no** — stays derived | settled in the directory task; a realm change plus a regrant of every group, for nothing |
| One open task per item? | **many, no unique index** | two kinds can legitimately be open at once (review + fix); a "has open task" badge needs no uniqueness |
| Optimistic concurrency on tasks | **no `expectedVersion`** | two people editing one task is not a real collision |

## Risks

1. **`/api/users` becoming staff-only is a behaviour change**, not just a
   tightening — §16 currently asserts that `reader` can read the directory, and
   that case has to be inverted. Nothing outside the backend calls the endpoint
   (verified), so the blast radius is the test suite.
2. **The observer runs inside `transition()`'s transaction**, which already
   holds rows in two tables. It adds a `findMany` + `updateMany` + `createMany`
   over a table indexed on `itemId`. Fine at this scale, but a bulk publish of
   thousands of items would widen an already-large transaction — worth
   remembering if bulk publish ever gets used in anger.
3. **The advisory guard can reject a legitimate assignment** when the directory
   is stale — a newly promoted publisher is unassignable for up to 24h.
   `POST /api/users/sync` is the fix and the error message should say so.
4. **A task list that resolves names per row** would be N+1 against
   `user_profiles`. Caught by reading the code, not by any test — the suite
   would pass either way. Worth a deliberate look during review.
5. **The `(kind, status)` guard is easy to regress** back to the simpler
   kind-only rule by someone tidying up, which would silently break the return
   flow. Test 25 exists to catch exactly that; the comment on the guard should
   say so.

**Not risks:** pgsync/CDC (neither table is tracked, test 27), the reindex path,
OpenSearch, Keycloak, backups, or any FK — `itemId` is polymorphic and can never
have one, and the `assignedToUserId` FK is deliberately absent.

## Estimate

| Phase | Hours |
|---|---|
| 1 — schema + migration | 0.5 |
| 2 — `TasksModule`, 5 endpoints, `(kind, status)` guard, name resolution | 4–5 |
| 3 — delete cascade + observer + picker + `/api/users` lockdown | 2 |
| 4 — §18 (~42 cases) + the two §16 inversions + jest | 4–5 |
| 5 — docs | 1 |
| **Total** | **11.5–13.5** |

Phase 2 is the only phase with real design left in it, and most of that is the
batching in the read path. Phase 4 grew because the observer and the return flow
are behaviours nothing else in the suite would catch.

## Prior art consulted

| System | Model | What we took |
|---|---|---|
| [InvenioRDM](https://inveniordm.docs.cern.ch/use/records/upload/) | Community submission creates a review Request whose *topic* is the draft; the draft stays private until the request is **accepted**, and accepting **is** the publish | Confirms task-driven publish is viable — but it works there because a draft has *one* legitimate publish path. Ours has several, so the observer is required. |
| GitHub pull requests | Merge button is task-driven, **and** a PR auto-closes when its commits reach the base branch by any other route; direct pushes stay legal unless branch protection is opted into | The decisive precedent: observer and task-driven **compose**, they don't compete. Also: requesting changes does not open a new PR — the return flow is one object. |
| [Drupal Content Moderation](https://www.drupal.org/project/drupal/issues/2845117) | Moderation state lives in a separate `ContentModerationState` entity keyed to the content *revision*, projected onto the node as a computed field — deliberately not a column on the content | Same instinct that keeps metrics and revisions out of `drafts` here, and the reason the `openTaskCount` column was rejected. |

The one thing none of them do is put the workflow state on the content row
itself. That is worth noticing, because it is the first thing that looks
attractive.

## Frontend (separate, not estimated here)

- "Assign for review" on a draft. Kind first, then a searchable dropdown fed by
  `GET /api/users?capability=publish&q=…&limit=5` — `?capability=staff` for the
  other kinds. **Not** a tasks endpoint; the directory owns the picker.
- "My tasks" inbox; task detail with comment thread, rendering `isSystem`
  comments as events rather than messages.
- Return-with-notes must send status **and** assignee in one `PATCH` — either
  alone is a `400`.
- Badge on items with an open task, from `GET /api/tasks?itemIds=…&status=OPEN`
  after the item list renders.
- "Created by" columns render `createdByName` straight off the row/hit — no
  lookup, already an OpenSearch `keyword` so it sorts and aggregates.

## Key Files

- `backend/prisma/schema.prisma` — two models, two enums, appended
- `backend/src/core/auth/resource-access.service.ts:37` — `assertAuthenticated`; `assertIsStaff` goes beside it
- `backend/src/core/auth/resource-access.service.ts:164` — `assertCanTransition`, the authoritative publish check
- `backend/src/modules/users/users.service.ts:44` — `list()`, the `OR` clobber
- `backend/src/modules/users/users.service.ts:90` — `resolveNames()`, id → current name
- `backend/src/modules/users/dto/users-query.dto.ts:12` — `capability`, gains `'staff'`
- `backend/src/modules/items/items.service.ts:264` — `delete()`, the cascade hook
- `backend/src/modules/items/items.service.ts:314` — `transition()`, the observer hook; still preserves the id
- `backend/test/api-test-suite.sh` — §16 is the precedent for §18
- `infrastructure/docker/pgsync/schema.json` — **no change**, and test 27 keeps it that way
