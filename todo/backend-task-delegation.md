# Backend: Task Delegation (assign work between cataloguers and publishers)

## Status: TODO

## Why we need it

Today the draft → record workflow has no handoff. A cataloguer creates a draft
and there is no way to say *"this is ready, please review it"*, and no way for a
publisher to say *"not yet — fix the author field"*. The transition endpoint
either publishes or it doesn't; everything in between happens over Teams.

We want tasks: a cataloguer assigns a draft to a publisher for review, the
publisher either publishes it or sends it back with notes, and both sides can
see what is waiting on them.

## Current State

- **There is no `User` table.** Identity is the raw Keycloak `sub` (a UUID)
  stored as a bare `String` in `Draft.createdByUserId` / `updatedByUserId`. No
  username, no display name, no email is persisted anywhere in Postgres. A GUI
  today literally cannot render "created by Ana" — only the UUID.
- **There is no "publisher" or "editor" role.** Authorisation is capability
  scopes on the `nbcg-api` client: `drafts:manage`, `records:manage`,
  `drafts:view:*`, `records:view:*`, `import:execute`.
- **"Can publish" already has an exact definition**: `records:manage` **AND**
  `drafts:manage` — see `assertCanTransition()` in
  `resource-access.service.ts:148`. That is the capability to key off; do not
  invent a new concept.
- **Users get their roles only through groups.** Live realm state:

  | Group | `records:manage` | `drafts:manage` | Members | Can publish |
  |---|---|---|---|---|
  | `nbcg/admins` | yes | yes | admin, pradles | **yes** |
  | `nbcg/editors` | yes | yes | editor | **yes** |
  | `nbcg/cataloguers` | no | yes | cataloguer | no |
  | `nbcg/readers` | no | no | reader | no |

- The backend has **no Keycloak Admin API client at all** today.

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

— a service account, and **not one** of admin / editor / pradles. Enumerate via
group members (`GET /groups/{id}/members`) or per-user composite mappings
(`/users/{id}/role-mappings/clients/{cid}/composite`) instead, and filter out
service accounts.

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

### User directory cache

> **Superseded — see [User Directory + Attribution Snapshots](backend-user-directory-sync.md).**
> The sketch below was the starting point. The split-out plan separates two
> concerns this section conflated: **attribution** (`createdByName` snapshot
> columns written from the JWT, for display) and the **directory**
> (`user_profiles`, synced from the Keycloak Admin API, for pickers and
> delegation). It also drops `groups`, replaces `isActive` with
> `enabled` + `deletedAt`, and moves `assignable-users` to
> `GET /api/users?capability=publish` in its own module. Build that first; this
> section is kept for context only.

Assignment needs names, and every list response needs to turn a `sub` into
something human. Hitting the Keycloak Admin API on every request is too slow and
makes Keycloak a hard dependency of an ordinary read.

Cache it in Postgres and refresh on a schedule:

```prisma
model UserProfile {
  userId     String   @id            // Keycloak sub
  username   String
  firstName  String?
  lastName   String?
  email      String?
  groups     String[]                // e.g. ["nbcg/editors"]
  canPublish Boolean                 // records:manage AND drafts:manage
  isActive   Boolean  @default(true) // false once they vanish from Keycloak
  syncedAt   DateTime @db.Timestamptz(3)

  @@index([canPublish, isActive])
  @@map("user_profiles")
}
```

`canPublish` is **derived during sync**, not stored in Keycloak — computed from
the composite role mapping. Recomputing it in one place keeps the trap above
from resurfacing at every call site.

Never delete a profile whose `userId` is referenced by a task — flip `isActive`
instead, or historical tasks lose their assignee name.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/tasks` | create + assign |
| `GET` | `/api/tasks` | filters: `assignedTo=me`, `createdBy=me`, `itemId`, `status` |
| `GET` | `/api/tasks/:id` | includes comments |
| `PATCH` | `/api/tasks/:id` | status change, reassign, edit |
| `POST` | `/api/tasks/:id/comments` | the "sending it back with notes" path |
| `GET` | `/api/tasks/assignable-users?capability=publish` | **the endpoint the frontend needs** |

`assignable-users` reads `user_profiles`, not Keycloak — so it is a single
indexed query. `capability=publish` filters `canPublish = true`; omitting it
returns everyone active. Response is `{ userId, username, displayName,
canPublish }[]`.

Guard rails worth enforcing server-side, not just in the UI:
- Assigning a *review/publish* task to someone with `canPublish = false` should
  be a `400` — otherwise the task can never be completed by its assignee.
- Only the assignee, the creator, or a `records:manage` holder may change status.
- Validate `itemId` resolves to a real draft or record (`404` otherwise).

## Open questions

- **Should `records:publish` become a real scope?** Deriving publish rights from
  `records:manage` + `drafts:manage` works today, but it conflates "can edit
  records" with "may approve someone else's work". A dedicated role would be
  cleaner and makes `assignable-users` trivial — at the cost of a realm change
  and a migration for existing users.
- **Notifications** — email/in-app on assignment, or is the task list enough for v1?
- **One open task per item, or many?** Affects whether `itemId` needs a partial
  unique index.

## Changes Needed

### Backend

- [ ] Add `TaskStatus`, `WorkTask`, `TaskComment`, `UserProfile` to
      `schema.prisma` + migration (`@db.Timestamptz(3)` throughout).
- [ ] New `KeycloakAdminService` in `src/core/keycloak/` — client-credentials
      token, user enumeration **via groups**, composite role resolution,
      service-account filtering.
- [x] **~~Grant the `nbcg-worker` service account `view-users` + `query-groups`~~**
      Done — `view-users` alone is sufficient (it is composite over `query-users`
      + `query-groups`). Applied to the live realm *and*
      `nbcg-realm.conf.json`. See
      [User Directory Sync](backend-user-directory-sync.md).
- [ ] User sync job (startup + interval, plus a manual
      `POST /api/admin/users/sync`) populating `user_profiles` and computing
      `canPublish`.
- [ ] `TasksModule` — controller, service, DTOs, the 6 endpoints above.
- [ ] Resolve assignee/creator display names in every task response so the GUI
      never sees a bare UUID.
- [ ] Cascade: deleting a draft/record should cancel or delete its open tasks —
      no FK exists to do this automatically.
- [ ] Add all new endpoints to `backend/test/api-test-suite.sh`, including a
      cataloguer-vs-publisher permission case and the
      "assign publish task to a non-publisher → 400" case.

### Frontend

- [ ] "Assign for review" action on a draft, using `assignable-users` to fill
      the picker.
- [ ] "My tasks" inbox; task detail with comment thread and return-with-notes.
- [ ] Badge on items that have an open task.

## Key Files

- `backend/prisma/schema.prisma` — new models
- `backend/src/core/auth/resource-access.service.ts:148` — `assertCanTransition`, the publish capability
- `backend/src/core/auth/principal.type.ts` — `Principal.sub` is the user key
- `backend/src/modules/items/items.service.ts` — `transition()`, id stability
- `infrastructure/docker/keycloak/nbcg-realm.json` — realm/client roles
- `backend/test/api-test-suite.sh` — API tests
