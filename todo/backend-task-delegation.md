# Backend: Task Delegation (assign work between cataloguers and publishers)

## Status: DONE — 2026-08-16

> **Built.** This document is kept for the *why*: the two Keycloak traps, the
> terminology inversion, and the reasoning behind the id-only item reference. For
> what was actually built and in what order, see
> [the implementation plan](backend-task-delegation-plan.md); for how to call it,
> see `backend/BACKEND_REFERENCE.md`.
>
> Its prerequisite,
> [User Directory + Attribution Snapshots](backend-user-directory-sync.md),
> shipped on 2026-08-13.
>
> **Four things in this document were wrong or incomplete and are corrected
> inline below:**
>
> 1. **`TaskKind` exists** — decided in conversation and never written here. The
>    guard rail below ("assigning a review/publish task to a non-publisher is a
>    400") is unenforceable without it, because `title`/`description` are free
>    text. Shipped as `REVIEW_PUBLISH` / `FIX_METADATA` / `GENERAL`.
> 2. **The guard is keyed on `(kind, status)`, not `kind`.** The kind-only rule
>    stated below breaks the return flow: a returned `REVIEW_PUBLISH` task sits
>    with a cataloguer who must *fix* it, and would be rejected with a 400.
> 3. **`WorkTask` needs a second index.** Only `@@index([assignedToUserId, status])`
>    is listed, but `?createdBy=me` is an advertised filter and would seq-scan.
> 4. **`assertAuthenticated` is the wrong predicate** for "being staff is the
>    whole requirement" — it lets `reader` assign work to colleagues. Shipped as a
>    new `assertIsStaff` (`drafts:manage` OR `records:manage`), which `/api/users`
>    now uses too.
>
> Also as noted below: `GET /api/tasks/assignable-users` was **not** built. The
> picker is `GET /api/users?capability=publish|staff&q=…`.

## Why we need it

Today the draft → record workflow has no handoff. A cataloguer creates a draft
and there is no way to say *"this is ready, please review it"*, and no way for a
publisher to say *"not yet — fix the author field"*. The transition endpoint
either publishes or it doesn't; everything in between happens over Teams.

We want tasks: a cataloguer assigns a draft to a publisher for review, the
publisher either publishes it or sends it back with notes, and both sides can
see what is waiting on them.

## Current State

Rewritten 2026-08-13 — the first three bullets used to say the opposite.

- ~~**There is no `User` table.**~~ **There is now: `user_profiles`**, a synced
  shadow of the Keycloak realm. Read it through `GET /api/users`, or in-process via
  `UsersService`. Never write to it — the sync job is its only writer.
- ~~**A GUI cannot render "created by Ana".**~~ **It can, off the row.** `Draft`,
  `Record` and `ItemRevision` all carry a `createdByName` / `updatedByName` /
  `userName` **snapshot**, written from the JWT at write time. No lookup needed,
  and it works for a user the sync has never seen.
- ~~**The backend has no Keycloak Admin API client.**~~ **`KeycloakAdminService`
  exists** in `src/core/keycloak/` — cached client-credentials token with a 401
  re-mint, paginated user enumeration, composite role resolution, service-account
  filtering. Do not write a second one.
- **There is still no "publisher" or "editor" role.** Authorisation is capability
  scopes on the `nbcg-api` client: `drafts:manage`, `records:manage`,
  `drafts:view:*`, `records:view:*`, `import:execute`, and now `users:manage`
  (admins only — it gates the sync endpoints, nothing else).
- **"Can publish" still has exactly one definition**: `records:manage` **AND**
  `drafts:manage` — `assertCanTransition()` in
  `resource-access.service.ts:164`. That is the capability to key off; do not
  invent a new concept. It is already computed for you as
  `UserProfile.canPublish`.
- **Users get their roles only through groups.** Live realm state, re-verified
  2026-08-13 via per-user composite mappings:

  | Group | `records:manage` | `drafts:manage` | Members | Can publish |
  |---|---|---|---|---|
  | `nbcg/admins` | yes | yes | admin, pradles | **yes** |
  | `nbcg/editors` | yes | yes | editor | **yes** |
  | `nbcg/cataloguers` | no | yes | cataloguer | no |
  | `nbcg/readers` | no | no | reader | no |

  The table is documentation only — nothing in the code reads a group name, and
  `canPublish` on each directory row already encodes the last column.

## ⚠️ Two traps, both verified live

**1. Terminology is inverted from how we talk about it.** In conversation the
draft-maker is "the editor" — but in the realm, the `editors` group *can*
publish, and the group that makes drafts without publish rights is
`cataloguers`. Mapping "editor" → `editors` would hand publish rights to exactly
the people who should not have them. Everything below uses the **capability**
(`records:manage` + `drafts:manage`), never a group name, for this reason.

**2. The obvious Keycloak endpoint returns the wrong answer.**
`GET /admin/realms/nbcg/clients/{id}/roles/records:manage/users` lists only
**direct** role holders. Every real user holds the role via group membership and
has zero direct mappings, so that call currently returns:

```
service-account-nbcg-worker
```

— a service account, and **not one** of admin / editor / pradles.

✅ **Already solved, don't re-solve it.** `UserSyncService` enumerates
`GET /users` (which excludes service accounts by itself — verified) and resolves
rights per user through
`/users/{id}/role-mappings/clients/{uuid}/composite`. The composite variant is
what makes the group walk unnecessary: it returns group-derived roles *and*
expands `records:manage` into its `records:view:*` composites. `canPublish` falls
out of that and is stored on the row.

⚠️ **One extra realm grant was needed** and is easy to trip over again:
resolving `nbcg-api`'s internal UUID needs `realm-management:view-clients`.
`view-users` alone gets a **403** on `GET /clients`, and the weaker
`query-clients` returns **200 with an empty list** — which reads as "the client
does not exist". Both grants are applied live and in `nbcg-realm.conf.json`.

## Design

### Item reference: id only, resolve the table at read time

`transition()` preserves the id when moving a row between tables (`id: d.id` in
`items.service.ts`), so **`itemId` is stable for the whole lifecycle** — a task
created against a draft still points at the right thing after publication. A
stored `itemType` would go stale the moment the item is published, so don't
store one; resolve draft-vs-record at read time the way `resolveItem()` does.

No FK is possible against a polymorphic reference — same situation as
`ItemRelation`, which also has none. Deletion cleanup has to be explicit.

### Schema

> **Superseded — kept to show the shape that was rejected.** `TaskComment` was
> never the right object: a comment is not a kind of thing, it is one of the
> things that can *happen* to a task. What shipped is `tasks` (current state) plus
> an append-only `task_history` (`CREATED`/`ASSIGNED`/`STATUS_CHANGED`/
> `RETURNED`/`COMMENTED`/`UPDATED`/`CLOSED_ON_PUBLISH`), mirroring
> `item_revisions`. The decisive gain: **the log survives item deletion**, which
> a cascading comments table cannot do. See
> [the rewrite](backend-task-history-rewrite.md).
>
> Also missing below and added since: `TaskKind`, and a second index for the
> advertised `?createdBy=me` filter.

```prisma
enum TaskStatus {
  OPEN         // assigned, not picked up
  IN_PROGRESS  // assignee is working on it
  RETURNED     // sent back to the requester with notes
  COMPLETED
  CANCELLED
}

model WorkTask {
  id               String     @id @default(cuid())
  itemId           String     // draft or record id; stable across transition
  title            String
  description      String?
  status           TaskStatus @default(OPEN)
  assignedToUserId String     // Keycloak sub
  createdByUserId  String     // Keycloak sub
  dueAt            DateTime?  @db.Timestamptz(3)
  createdAt        DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime   @updatedAt @db.Timestamptz(3)
  completedAt      DateTime?  @db.Timestamptz(3)
  comments         TaskComment[]

  @@index([assignedToUserId, status])
  @@index([itemId])
  @@map("work_tasks")
}

model TaskComment {
  id           String   @id @default(cuid())
  taskId       String
  task         WorkTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  authorUserId String
  body         String
  createdAt    DateTime @default(now()) @db.Timestamptz(3)

  @@index([taskId])
  @@map("task_comments")
}
```

Use `@db.Timestamptz(3)` on every timestamp — plain `timestamp` was fixed
project-wide precisely because pgsync emitted offset-less strings that clients
parsed as local time.

### User directory — BUILT, consume it as-is

> Fully replaced by [User Directory + Attribution Snapshots](backend-user-directory-sync.md).
> The `UserProfile` sketch that used to live here has been deleted rather than kept
> "for context", because it differed from what shipped in ways that would mislead:
> it had a `groups` column (dropped — rights are the lookup key, not membership),
> a single `isActive` (split into `enabled` + `deletedAt`), no `scopes[]`, and no
> stored `displayName`.

What exists now, and all this task needs to know:

| Need | Use |
|---|---|
| Fill the assignee picker | `GET /api/users?capability=publish` — one indexed read |
| Search the picker | `?q=` over displayName / username / email |
| Only assignable people | `?active=true` is the default (`enabled && deletedAt IS NULL`) |
| Resolve ids → current names, in-process | `UsersService.resolveNames(ids)` → `Map<string, string>` |
| Is this person a publisher? | `UserProfile.canPublish` (already `records:manage` AND `drafts:manage`) |

`UsersService` is exported from `UsersModule`, so `TasksModule` imports that module
and injects it. No Keycloak call on any request path.

**`resolveNames()` never returns a miss** — every id resolves, falling back to
`'System (import)'` for `'system'` and `'Unknown user'` otherwise. That is what
makes it safe for a task list: a user deleted from Keycloak still renders, because
directory rows are never hard-deleted.

#### Tasks should NOT copy the attribution snapshot pattern

Items store `createdByName` on the row. **Do not do that for tasks.** The snapshot
exists for one reason: `drafts`/`records` are pgsync-tracked, so a name that
tracked the current one would re-index every document a renamed person ever
touched, nested `extractedText` included. That cost scales with the item count —
50,000 items — and is why the name is frozen.

Tasks have neither property. `tasks` is not pgsync-tracked and scales with staff
activity, not the collection. So resolve both the assignee and the creator
through `resolveNames()` at read time:

- A task list is bounded (`?assignedTo=me`, `status=OPEN`), so it is **one** extra
  indexed query per response, not per row.
- A live work item should show who someone **is now**, not what they were called
  when the task was filed. A renamed assignee showing their old name on an open
  task is a bug; on a two-year-old revision it is history.

The governing rule from the directory task: **snapshot for a specific row,
directory for a group of rows.** Tasks are read as groups.

> Both halves of that rule now have a table each. `tasks` resolves names live, as
> argued here. `task_history` does the opposite and stores a `userName`
> **snapshot**, because a log entry that changed its name when someone was
> renamed would be a bug — the same reasoning as `ItemRevision.userName`. Two
> tests, one rename, and the rule is asserted in both directions.

#### Where the tables live

`tasks` and `task_history` are keyed by `itemId`, so they belong in `public`
alongside the item model — see
[Move `user_profiles` to a `directory` schema](backend-postgres-schema-split.md),
which moves only the one table that has no item linkage. If that split has landed
by the time this is built, both new models need `@@schema("public")`.

**Neither table may be added to `pgsync/schema.json`**, for the same reason
`item_revisions` is not: CDC re-indexes the whole document on any tracked change,
and a comment on a task would re-index the item it points at.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/tasks` | create + assign |
| `GET` | `/api/tasks` | filters: `assignedTo=me`, `createdBy=me`, `itemId`, `status` |
| `GET` | `/api/tasks/:id` | includes comments |
| `PATCH` | `/api/tasks/:id` | status change, reassign, edit |
| `POST` | `/api/tasks/:id/comments` | the "sending it back with notes" path |

~~`GET /api/tasks/assignable-users`~~ — **do not build this.** It already exists as
`GET /api/users?capability=publish`, in its own module, because the directory
outlives task delegation: "filter search by cataloguer" and "who can review this"
want the same list. Response is
`{ total, users: [{ userId, username, displayName, canPublish, isActive, … }] }`.

For endpoints where being staff is the only requirement, use
`ResourceAccessService.assertAuthenticated(principal)` — `@RequireScopes` cannot
express it, because no scope is held by every authenticated user (`reader` has only
`records:view:*`) and the guard lets anonymous through when no scope is required.

Guard rails worth enforcing server-side, not just in the UI:
- Assigning a *review/publish* task to someone with `canPublish = false` should
  be a `400` — otherwise the task can never be completed by its assignee.
  **Comment it as advisory when you write it:** `canPublish` comes from a directory
  that may be up to one sync interval (24h) stale, so this guard can reject an
  assignment the assignee's token would in fact permit. The manual
  `POST /api/users/sync` fixes that instantly. The authoritative check remains
  `assertCanTransition(principal)` reading the JWT — **`canPublish` must never gate
  an actual permission.**
- Only the assignee, the creator, or a `records:manage` holder may change status.
- Validate `itemId` resolves to a real draft or record (`404` otherwise).

## Open questions

- ~~**Should `records:publish` become a real scope?**~~ **Decided: no.** Settled in
  the directory task — `canPublish` stays derived from `records:manage` +
  `drafts:manage`. Considered and rejected as not worth a realm change plus a
  regrant of every existing group. It is already computed once, at sync time, so no
  call site re-derives it and the inverted-terminology trap cannot resurface.
  Reopen only if "may approve someone else's work" ever needs to differ from "can
  edit records" — which is a product question, not a plumbing one.
- ~~**Notifications**~~ **Decided: none in v1.** The inbox is
  `GET /api/tasks?assignedTo=me&status=OPEN`. No SMTP exists to build on, and a
  five-person team sitting in the same tool does not need a second channel yet.
- ~~**One open task per item, or many?**~~ **Decided: many, no unique index.**
  Two kinds can legitimately be open at once — a review and a metadata fix — and
  the "has an open task" badge needs no uniqueness to work.
- ~~**Where do the tables live?**~~ **Decided: `public`.** A separate Postgres
  schema only earns its keep as a *grant boundary*, and no database role needs
  one. See [the split doc](backend-postgres-schema-split.md), deferred not
  rejected, and the reasoning in
  [the plan](backend-task-delegation-plan.md).
- **Task-driven publish** (`POST /api/tasks/:id/publish`) — not built. The
  observer in `transition()` is the correctness mechanism and cannot be removed,
  so this would be ergonomics on top. Revisit if the GUI wants a one-click
  "approve and publish".

## Changes Needed

### Backend

- [x] Add `TaskStatus`, **`TaskKind`**, **`TaskAction`**, `Task` and
      `TaskHistory` to `schema.prisma` + migration (`@db.Timestamptz(3)`
      throughout). **Not `UserProfile`** — it exists. Shipped as
      `20260816100606_add_work_tasks`, then reshaped the same day by
      `20260816110044_replace_work_tasks_with_tasks_and_history`.
- [x] ~~New `KeycloakAdminService`~~ — **built**, `src/core/keycloak/`. Cached
      token with 401 re-mint, pagination, composite role resolution,
      service-account filtering. Reuse it; do not add a second client.
- [x] ~~Grant the `nbcg-worker` service account `view-users` + `query-groups`~~ —
      **done, and it needed one more than expected**: `view-users` (composite over
      `query-users` + `query-groups`) **plus `view-clients`**, without which the
      `nbcg-api` UUID cannot be resolved. Live and in `nbcg-realm.conf.json`.
- [x] ~~User sync job~~ — **built.** BullMQ repeatable (fixed `jobId`, daily,
      deduped through Redis so replicas do not double-sync) plus one run at
      startup, and `POST /api/users/sync` for a manual trigger
      (`users:manage`). `GET /api/users/sync/status` reports last run and last
      error.
- [x] `TasksModule` — controller, service, DTOs, the 5 remaining endpoints above.
      Imports `UsersModule` for `UsersService`.
- [x] New `assertIsStaff` predicate on `ResourceAccessService` — correction 4
      above. `/api/users` moved onto it too, which made the conditional-email
      branch dead code and deleted it.
- [x] Resolve assignee/creator display names in every task response via
      `UsersService.resolveNames()` — one query per response, batched across the
      whole response. No snapshot name columns on `tasks`; `task_history` is the
      deliberate opposite.
- [x] Cascade: deleting a draft/record hard-deletes its **live tasks**, inside the
      existing transaction. `task_history` deliberately survives — it is the audit
      record, and destroying it is the failure mode it exists to prevent.
- [x] **The observer** — not in the original list, and the real gap in it.
      Publishing closes its `REVIEW_PUBLISH` tasks inside `transition()`, however
      the publish happened. Without it the task list lies.
- [x] `backend/test/api-test-suite.sh` §18 — 82 assertions. Suite now 383
      passing. Two §16 cases inverted: `reader` gets 403 from the directory
      rather than a filtered 200.
- [x] `npx jest` — 54 passing, including a new
      `tasks.service.spec.ts` covering the `(kind, status)` matrix.

### Frontend

- [ ] "Assign for review" action on a draft, filling the picker from
      `GET /api/users?capability=publish` (not a tasks endpoint).
- [ ] "Created by" columns can render `createdByName` straight off the row/hit —
      no lookup, already indexed as an OpenSearch `keyword` so it sorts and
      aggregates. Hidden automatically for principals below
      `drafts:manage`/`records:manage`.
- [ ] "My tasks" inbox; task detail with comment thread and return-with-notes.
- [ ] Badge on items that have an open task.

## Key Files

- `backend/src/modules/tasks/` — the module itself
- `backend/prisma/schema.prisma` — `WorkTask` / `TaskComment`, at the bottom under the staff-workflow banner
- `backend/src/core/auth/resource-access.service.ts` — `assertCanTransition` (the authoritative publish check) and `assertIsStaff` (the delegation bar)
- `backend/src/core/auth/principal.type.ts` — `Principal.sub` is the user key; `displayName` is the name from the token
- `backend/src/core/auth/actor.type.ts` — `Actor` / `actorOf()` / `SYSTEM_ACTOR`, the attribution pair
- `backend/src/modules/users/users.service.ts:90` — `resolveNames()`, the id → current-name lookup
- `backend/src/modules/users/users.controller.ts` — `GET /api/users`, the picker source
- `backend/src/core/keycloak/keycloak-admin.service.ts` — the Admin API client, already built
- `backend/src/modules/items/items.service.ts` — `transition()`, id stability
- `infrastructure/docker/keycloak/nbcg-realm.conf.json` — realm/client roles (the tracked file; `nbcg-realm.json` is generated and gitignored)
- `backend/test/api-test-suite.sh` — API tests; §16 is the directory precedent
