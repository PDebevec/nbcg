# Backend: User Directory + Attribution Snapshots

## Status: TODO — realm prerequisites DONE

Split out of [Task Delegation](backend-task-delegation.md), which sketched a
`UserProfile` model but left the sync mechanism open.

## Two separate problems, two separate mechanisms

Do not conflate these. They have different data, different freshness needs, and
different failure modes.

| | **Attribution** | **Directory** |
|---|---|---|
| Question | "Who made this row?" | "Who exists, and what may they do?" |
| Used for | Rendering `created by` / `edited by` anywhere | Assignee picker, filter dropdown, task delegation, `canPublish` |
| Stored as | **Snapshot columns on the row itself** | **`user_profiles` table** |
| Written by | The request handler, from the JWT | The sync job, only |
| Freshness | Frozen at write time, on purpose | Up to one sync interval stale |
| Scales with | Number of items | Number of staff |

`user_profiles` is **not** in the read path for rendering a name, and it is not
in the write path for creating an item. It exists for cross-user queries. That
separation is what keeps both halves simple.

## Why we need each

**Attribution.** Identity today is a raw Keycloak `sub` (a UUID) in a bare
`String` column (`Draft.createdByUserId`, `Record.updatedByUserId`,
`ItemRevision.userId`). No name is persisted anywhere, so a list view can render
`f47ac10b-58cc-…` and nothing else.

**Directory.** Two things are impossible without a local copy of the realm:

1. **Assigning work to someone who has not logged in yet.**
2. **Filtering or picking by user** without asking Keycloak on the read path —
   which would make Keycloak a hard dependency of an ordinary `GET /api/items`
   and put its latency in every list response.

## What the standard solution is

Three patterns exist. The short version: **a local shadow copy of the directory,
refreshed on a schedule. Nobody treats push events as the source of truth.**

| Approach | How | Verdict |
|---|---|---|
| **Admin REST API poll** | Service account enumerates users on a timer, upserts locally | ✅ **Chosen.** No Keycloak plugin, no new infra |
| **Event listener SPI / webhooks** | Custom Java provider deployed *into* Keycloak | ❌ Java build + deploy into the Keycloak image, and does not remove the need for polling |
| **Debezium on Keycloak's DB** | CDC off Keycloak's own Postgres | ❌ Couples us to Keycloak internals across upgrades |

The decisive point about event listeners, and it is the Red Hat article's own
conclusion, is that **event delivery is not guaranteed** — outages and restarts
drop events, and some changes emit none at all. Their recommendation is to treat
events as a latency optimisation *on top of* scheduled sync. Since we need the
scheduled sync either way, the listener would be building the optional half.

## Realm prerequisites — ✅ DONE

Applied to the **live** Keycloak (`localhost:8082`) *and* persisted to
`nbcg-realm.conf.json`. Both were needed: realm import only runs against an empty
Keycloak database, so editing the file alone would leave a running instance
403ing.

- [x] **`service-account-nbcg-worker` granted `realm-management` → `view-users`.**
      Verified it pulls in `query-users` + `query-groups` as composites, so that
      one role is the whole grant. Not `realm-admin` — that is 18 roles including
      `manage-users` and `impersonation` on an account that only reads.
- [x] **New `users:manage` client role on `nbcg-api`, granted to `nbcg/admins` only.**
      Gates the manual sync endpoint. Verified: `admin` ✅ `pradles` ✅,
      `editor` ❌ `cataloguer` ❌ `reader` ❌.

Verified end to end with a real `client_credentials` token as `nbcg-worker`:
`GET /users` → `200` (5 users, with names and emails), per-user composite
role-mappings → `200`.

## Live-verified facts

Everything here was checked against the running realm on 2026-08-13, not inferred.

**1. Per-user composite role-mappings resolve group-derived roles correctly.**
This is what makes dropping groups safe. `GET /users/{id}/role-mappings/clients/{nbcgApiId}/composite`:

| user | effective `nbcg-api` roles include | `canPublish` |
|---|---|---|
| admin | `records:manage` + `drafts:manage` | ✅ |
| editor | `records:manage` + `drafts:manage` | ✅ |
| pradles | `records:manage` + `drafts:manage` | ✅ |
| **cataloguer** | `drafts:manage` only | ❌ |
| reader | `records:view:*` only | ❌ |

`cataloguer` correctly resolves to `false` with no group name anywhere in the
code. The endpoint also expands `records:manage` into its `records:view:*`
composites — a non-composite call would miss those.

**2. `GET /users` already excludes service accounts.**
`service-account-nbcg-worker` did not appear in the 5-user response. Keep a
defensive `serviceAccountClientLink` check, but it is belt-and-braces.

**3. The realm has 5 human users.** This number is why name resolution needs no
per-row queries at all (see below).

**4. Groups are not in the access token.** `nbcg-api`'s default scopes are
`profile`, `email`, `roles`, `basic`, `web-origins`, `acr`. The realm's `groups`
mapper lives on the *optional* `microprofile-jwt` scope and is an
`oidc-usermodel-realm-role-mapper` mapping realm roles, not groups, despite the
name. Irrelevant now that we do not store groups — but it is why we cannot.

**5. `createdByUserId` is not always a UUID.**
`import-queue.processor.ts:99` writes the literal string `'system'`. No Keycloak
user exists behind it. Any FK, any join, and any non-null `displayName`
assumption breaks on imported items.

**6. A failed sync must never mark anyone inactive.** If enumeration 403s or dies
halfway through, the users we did not see are not gone. Only reconcile absences
from a sync that completed and returned a non-empty roster. Getting this wrong
empties the assignee picker during a Keycloak restart.

## Design

### One write path. Only one.

**The sync job is the only thing that may ever write to `user_profiles`.**

```
   BullMQ repeatable    ──►  full reconcile   (daily + once on startup)
   POST /api/users/sync ──►  the same job     (users:manage)
```

That is the whole list. Explicitly rejected: populating the table opportunistically
from the JWT of whoever happens to make a request. A user appears in this table
because they exist in Keycloak *and* a sync ran — never as a side effect of
traffic. "Why is this person in the table?" must have exactly one answer.

The startup run is the same job, not a side channel; it just means a fresh deploy
populates immediately instead of waiting up to a day.

#### Why daily is safe without a JIT path

**Because `user_profiles` is never consulted for authorization.** Verified: every
permission decision reads `principal.scopes`, populated exclusively from the JWT
(`keycloak.strategy.ts:54` → `scopes.guard.ts:32` → `resource-access.service.ts`).
Nothing in the auth path touches the database.

> **Rule: `canPublish` must never gate an actual permission.** It is a UI hint and
> an advisory validation. The real check stays `assertCanTransition(principal)`,
> reading the token. Hold this line and a stale directory is cosmetic.

With a table up to 24h stale, the two symptoms are:

- **Promoted user** (cataloguer → editors at 10:00, sync at 03:00): absent from
  the publish picker until tomorrow; assigning them a publish task 400s even
  though their token would permit it. The manual sync button fixes it instantly.
- **Demoted user**: still shows `canPublish: true`, so a task can be assigned
  that they can no longer complete — they get a correct 403 at transition time,
  from the token. Self-correcting.

Both are minor and self-healing. The `assign-to-non-publisher → 400` guard should
carry a comment saying it is advisory and may be up to a sync-interval stale.

**Departures need no special handling.** A user disabled in Keycloak stops being
issued tokens immediately; existing ones expire within the 5-minute TTL and
refresh fails. Keycloak cuts their access. Our table only lags on *displaying*
them as inactive.

#### A user the sync has never seen is not a problem

An earlier draft of this plan called this a "gap". It is not one. A brand-new
Keycloak user can log in and create drafts before any sync runs, and everything
works: the handler writes `createdByUserId` from `principal.sub` and
`createdByName` from the JWT's name claims. **Neither touches `user_profiles`.**

The only thing that lags is their appearance in the *picker* and the *filter
dropdown* — which is the directory's actual job, and is what the manual trigger
is for. Their name renders correctly on their items from the very first request.

### Schedule: BullMQ daily, not `@nestjs/schedule`

`@nestjs/schedule` is not installed; BullMQ, Redis and `ioredis` already are, and
`files/queue/` is the pattern to copy.

Beyond that: a BullMQ **repeatable job with a fixed `jobId` is deduplicated
through Redis**, so it fires once across the whole deployment. `@nestjs/schedule`
runs its cron in every process, so two replicas would mean two concurrent full
syncs against Keycloak.

**Daily**, plus one run on startup. A brand-new Keycloak user is missing from the
picker for up to 24h — that is what the manual trigger is for. Their *attribution*
is unaffected (see above).

### Schema — attribution snapshots

Added to `Draft`, `Record`, and `ItemRevision`:

```prisma
model Draft {
  // ... existing fields
  createdByUserId String
  /// Display name captured from the JWT at write time. A SNAPSHOT: never
  /// updated when the user is renamed in Keycloak, so it records who created
  /// this as they were called then. That is deliberate — see "Snapshot
  /// semantics" below. `'System (import)'` for import-created rows.
  createdByName   String
  updatedByUserId String?
  updatedByName   String?
}

model ItemRevision {
  // ... existing fields
  userId   String
  userName String   /// same snapshot rule; revisions are historical by nature
}
```

`Record` gets the identical pair. No FK to `user_profiles` — the snapshot is the
point, and a FK would break on `'system'` and on departed users alike.

#### Snapshot semantics

**Write it once, never update it.** This is what makes denormalisation safe here:

- The name comes from the **JWT**, not from `user_profiles` — verified that
  `given_name`, `family_name`, `preferred_username` and `name` all land in the
  access token via `nbcg-api`'s default `profile` scope. So attribution needs no
  directory lookup, no join, and works for a user the sync has never seen.
- **No rename storm.** `ItemMetricDaily`'s schema comment warns that any column
  change on `drafts`/`records` makes pgsync re-index the whole document including
  nested `extractedText`. That cost only exists if the stored name *tracks* the
  current name. A snapshot is never updated, so it is never paid.
- Use the same `displayName` formatting rule as `UserProfile` ("First Last",
  falling back to username) so the two never disagree cosmetically.

**The trade, stated plainly:** a genuine correction — a typo in Keycloak that
gets fixed — does not propagate. Existing rows keep the old spelling. That needs
a small admin backfill script keyed on `userId`; see Changes Needed.

### Schema — directory

```prisma
/// Local shadow of the Keycloak realm's human users. Never deleted: item rows,
/// revisions and tasks reference `userId` with no FK, so a departed user must
/// still resolve to a name.
///
/// Written ONLY by the sync job (scheduled or manually triggered). Nothing else
/// may insert or update a row here — see "One write path" above.
///
/// NOT an authorization source. `scopes`/`canPublish` are display and validation
/// hints and may be up to one sync interval stale; real permission checks read
/// the JWT via `Principal.scopes`.
model UserProfile {
  userId      String         @id                     // Keycloak sub
  username    String
  firstName   String?
  lastName    String?
  email       String?
  /// Precomputed "First Last", falling back to username. One formatting rule,
  /// applied at write time, so every consumer renders identically.
  displayName String
  /// Effective nbcg-api client roles, resolved through group membership by the
  /// /composite endpoint. Stored raw so a future capability question needs no
  /// migration and no resync.
  scopes      String[]       @default([])
  /// records:manage AND drafts:manage — derived from `scopes` at write time so
  /// the capability rule lives in exactly one place.
  canPublish  Boolean        @default(false)
  /// Keycloak's own enabled flag. A disabled user is not assignable.
  enabled     Boolean        @default(true)
  /// Set when a *successful* full sync no longer finds them. Cleared if they
  /// come back. Never set from a partial or failed sync.
  deletedAt   DateTime?      @db.Timestamptz(3)
  syncedAt    DateTime       @db.Timestamptz(3)

  @@index([canPublish, enabled, deletedAt])
  @@map("user_profiles")
}
```

`@db.Timestamptz(3)` throughout — plain `timestamp` was fixed project-wide
because pgsync emitted offset-less strings that clients parsed as local time.

Deltas from the task-delegation sketch, each for a reason:

- **No `groups` column.** Decided: rights are the lookup key, not membership.
  Removes the group-tree walk from the sync entirely.
- **`isActive` split into `enabled` + `deletedAt`.** "Suspended, still on staff"
  and "gone from the realm" are different facts with different UI and different
  reversibility. `isActive` is derived: `enabled && deletedAt == null`.
- **`scopes String[]` added.** `canPublish` alone means the next capability
  question needs a migration *and* a full resync.
- **`displayName` stored.** Makes the picker a single indexed read, and stops
  three call sites inventing three name formats.
- **No `syncSource`.** The earlier sketch had a `TOKEN | ADMIN_API` enum to tell
  a JIT row from a reconciled one. With the sync as sole writer every row is
  identical in provenance, so the column is dead weight. Dropped.

### The sync algorithm

```
1.  GET /admin/realms/nbcg/users?briefRepresentation=false&first=N&max=100
      → roster: sub, username, email, firstName, lastName, enabled
      → paginate until a short page (max defaults to 100 — do not assume one page)
      → service accounts are already excluded; defensively drop any row with
        serviceAccountClientLink or a 'service-account-' username

2.  Per user: GET /users/{id}/role-mappings/clients/{nbcgApiId}/composite
      → effective nbcg-api roles (group-derived AND direct, composites expanded)
      → canPublish = scopes ⊇ {records:manage, drafts:manage}

3.  Upsert every roster row. This is the only code in the system permitted to
    write `user_profiles`.

4.  ONLY if steps 1–2 all succeeded and the roster is non-empty:
      set deletedAt on rows not in the roster; clear it on rows that reappeared.
```

Six HTTP calls a day for the current realm.

*Scaling note:* step 2 is N+1. At 5–50 users this is irrelevant. Past roughly 200
users, switch to resolving roles once per group
(`/groups/{id}/role-mappings/clients/{cid}/composite` + `/groups/{id}/members`)
and unioning per user. That is the only reason to reintroduce the group walk.

`canPublish` stays keyed off the **capability** (`records:manage` +
`drafts:manage`, per `resource-access.service.ts:154`), never a group name —
`editors` can publish and `cataloguers` cannot, which is the opposite of how we
say it out loud.

### Calling Keycloak: `undici`, not the official client

`@keycloak/keycloak-admin-client` is a large dependency with a history of ESM/CJS
friction in CommonJS Nest builds, and we need three endpoints. The house pattern
is raw `undici` (`tika.service.ts:2`) / global `fetch` (`seaweedfs.service.ts:20`).

`KeycloakAdminService` in `src/core/keycloak/`:

- **Token**: `POST {KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token`,
  `grant_type=client_credentials`, `client_id=nbcg-worker` + secret. The token
  comes from the **`nbcg` realm, not `master`** — `realm-management` roles are
  per-realm and `nbcg-worker` lives in `nbcg`. (Verified working.)
- **Cache the token in memory**, refresh at ~80% of `expires_in`. Retry once on a
  401 with a forced re-mint, covering a Keycloak restart.
- Resolve the `nbcg-api` internal client UUID once at startup
  (`GET /clients?clientId=nbcg-api` → `[0].id`) and cache it; every role-mapping
  call needs it and it is not the same as `KEYCLOAK_CLIENT_ID`.
- Config: `KEYCLOAK_URL` + `KEYCLOAK_REALM` already exist in `.env.shared`;
  add `KEYCLOAK_WORKER_CLIENT_ID` + `KEYCLOAK_WORKER_CLIENT_SECRET` (the secret
  already exists for the import worker — reuse it, do not mint a second client).

## Rendering a name: read the row, don't look anything up

Because the name is written onto the row, **every read path already has it.** No
join, no cache, no `decorate()` step, no per-row lookup — from Postgres or from
OpenSearch alike.

| Source | Carries | Work needed |
|---|---|---|
| **Postgres** — item detail, lists | `createdByName`, `updatedByName` on the row | none |
| **Postgres** — `ItemRevision` | `userName` on the row | none |
| **OpenSearch** — records/drafts search | `createdByName` in `_source` once pgsync ships it | none |
| **Postgres aggregation** — stats | `GROUP BY userId` → counts only | **lookup — see exception below** |

This is what makes it scale with the item count rather than the staff count: a
500-user realm, a 50,000-user realm, and a one-person realm all cost the same.

### The stats exception — aggregates must NOT use the snapshot

`GROUP BY userId, userName` **fragments one person into several rows** the moment
their name has ever changed — the whole point of a snapshot is that old rows keep
the old value. A "top contributors" table would show `Ana Perović: 40` and
`Ana Novak: 12` as two people.

So `stats.service.users()` groups by `userId` alone and resolves the **current**
name from `user_profiles`:

- A productivity panel wants current identity — "who is this person now" — not
  the name they used at the time.
- The result set is `LIMIT 50`, so this is one small indexed query, not a per-row
  lookup. It stays cheap at any realm size.
- Unknown / departed `userId` still resolves, because directory rows are never
  deleted — that is the payoff for `deletedAt` over a hard delete. Fall back to
  `'Unknown user'`, and `'system'` → `'System (import)'`.

Rule of thumb: **snapshot for a specific row, directory for a group of rows.**

### Visibility: attribution is staff-only

Readers and anonymous visitors must not see who created or edited an item.

**Strip `createdByName` / `updatedByName` / `userName` unless the principal holds
`drafts:manage` or `records:manage`.** That admits cataloguer, editor and admin;
it excludes `reader` (who holds only `records:view:*`) and anonymous, and it
needs no new scope.

⚠️ **This is now a security control, not a display preference — and the current
search code would leak.** Two verified problems, both created by putting the name
in the index:

1. `search.service.ts:279` returns `source: hit._source` **wholesale** to the
   caller. Any field in the document reaches the client.
2. `buildSourceControl()` (`search.service.ts:251`) turns an arbitrary
   client-supplied `?fields=` list straight into OpenSearch `includes` **with no
   allowlist**. So `?fields=createdByName` is a direct request for exactly the
   field we are trying to withhold.

Today both are harmless — the index holds only UUIDs, and a leaked UUID means
nothing. They stop being harmless the moment pgsync ships the name. Required:

- Strip the attribution fields from `_source` on the way out for any principal
  below the bar, **and**
- Constrain `?fields=` to an allowlist, so the projection cannot be used to
  re-request a stripped field.

Do both. Stripping alone is not enough if `fields` can name the column, and an
allowlist alone is not enough because the default path returns everything.

### Filtering by user needs no change

`createdByUserId` is already an indexed `keyword` in OpenSearch. The picker reads
`user_profiles` to show names, sends the **UUID**, and the engine filters on it.
That worked before this plan and still does.

What the snapshot *adds* is engine-side **sorting and aggregating by name**,
which a UUID-only index could never do — mapped as `keyword`, `createdByName`
supports `ORDER BY` and terms aggregations directly.

### pgsync / OpenSearch change

`infrastructure/docker/pgsync/schema.json` needs the new columns on **both** the
`records` and `drafts` nodes — added to the `columns` list *and* given an explicit
mapping:

```jsonc
"columns": [ …, "createdByUserId", "updatedByUserId", "createdByName", "updatedByName" ],
"transform": { "mapping": {
  "createdByName": { "type": "keyword" },
  "updatedByName": { "type": "keyword" }
}}
```

**`keyword`, not `text`.** `keyword` sorts and aggregates, which is the entire
reason the name is in the index. Full-text search over creator names is not a
requirement — the picker resolves a name to a UUID and filters on that.

**Cost: one full reindex.** Changing the pgsync schema means rebuilding the
`records` and `drafts` indices once. Plan it with the migration that adds the
columns, and remember the backfill (below) must land *before* the reindex, or the
index ships a column full of nulls.

Note the ordering trap: `SearchHit.source` is the indexed copy, and it is
**CDC-lagged**. A freshly written item may return its name from Postgres and not
yet from search. That is existing behaviour for every other field, not something
this change introduces.

## Endpoints

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/api/users` | any authenticated | `?capability=publish`, `?active=true` (default), `?q=` — single indexed read |
| `GET` | `/api/users/:id` | any authenticated | one profile |
| `POST` | `/api/users/sync` | **`users:manage`** | enqueues the reconcile job, returns `{ jobId }` |
| `GET` | `/api/users/sync/status` | **`users:manage`** | last run at / duration / counts / last error |

A **`users` module, not `tasks/assignable-users`**. The directory outlives task
delegation — "filter search by cataloguer" and "who edited this" want the same
list. Task delegation consumes `GET /api/users?capability=publish`.

`sync/status` exists because a sync that has been silently failing for a week is
otherwise invisible until the picker is mysteriously empty.

## Decided

- **No `records:publish` scope.** `canPublish` stays derived from
  `records:manage` + `drafts:manage`. Considered and rejected — not worth a realm
  change and a regrant of existing groups.
- **The sync is the sole writer** of `user_profiles`. No JIT/opportunistic
  population from request JWTs. See "One write path" above for the consequences,
  all of which are cosmetic because nothing authorizes off this table.
- **Attribution is denormalised onto the row, as a snapshot.** An earlier draft
  of this plan argued for resolving names from an in-memory directory cache
  instead. That was rejected: it scales with staff count rather than item count,
  cannot sort or aggregate in the engine, and does not survive an export. The
  objection to denormalising — a rename re-indexing every document the person
  touched — only applies if the stored name tracks the current name, and it does
  not. Accepted cost: corrections need a backfill script.
- **Attribution and the directory are separate mechanisms.** Neither replaces the
  other; see the table at the top.

## Open questions

- **Should `GET /api/users` expose email?** Any authenticated user seeing the
  staff list is normal for an internal tool; email is a step further. Splitting
  `displayName`-only from full profile is the alternative.
- **What happens to a deactivated user's open tasks?** Task-delegation territory,
  but it is this table that flips the flag.

## Changes Needed

### Realm — ✅ DONE (live + config)

- [x] `service-account-nbcg-worker` → `realm-management:view-users`
- [x] `users:manage` role on `nbcg-api`, granted to `nbcg/admins`

### Backend — attribution (independent of the directory; can ship first)

- [ ] `createdByName` / `updatedByName` on `Draft` + `Record`, `userName` on
      `ItemRevision`, in `schema.prisma` + migration.
- [ ] Populate from the JWT at every write site: `items.service.ts:115` (create),
      `:206` (update), `:374`/`:390` (transition), and every `revisions.service`
      call. `import-queue.processor.ts:99` writes `'System (import)'` alongside
      its existing `'system'` id.
- [ ] Extend `keycloak.strategy.ts:50` + `Principal` to carry the display name
      from `given_name`/`family_name`/`preferred_username`. **This is for
      attribution only** — it must not become a write path into `user_profiles`.
- [ ] Share one `formatDisplayName()` helper between the strategy and the sync,
      so a snapshot and a directory row never disagree cosmetically.
- [ ] **Backfill existing rows** before the reindex: resolve every distinct
      `createdByUserId`/`updatedByUserId` via one sync, write the names, leave
      `'system'` rows as `'System (import)'`, unresolvable ids as `'Unknown user'`.
- [ ] **Strip attribution for principals without `drafts:manage` or
      `records:manage`** — items, search, revisions, all of it.
- [ ] **Allowlist `?fields=`** in `buildSourceControl()` (`search.service.ts:251`)
      so the projection cannot re-request a stripped field, and stop returning
      `hit._source` wholesale at `search.service.ts:279`. **Both are required —
      neither alone closes the hole.**
- [ ] Admin backfill script: rewrite `createdByName`/`updatedByName`/`userName`
      for a given `userId`, for genuine name corrections. Snapshots do not
      self-heal; this is the escape hatch.

### Infrastructure

- [ ] `pgsync/schema.json` — add `createdByName`/`updatedByName` to the `columns`
      list and an explicit `keyword` mapping, on **both** the `records` and
      `drafts` nodes.
- [ ] One full reindex of `records` + `drafts`, sequenced **after** the backfill.

### Backend — directory

- [ ] `UserProfile` model in `schema.prisma` + migration (`@db.Timestamptz(3)`
      throughout). No enum needed.
- [ ] `src/core/keycloak/keycloak-admin.service.ts` — client-credentials token
      with caching + 401 re-mint, cached `nbcg-api` internal client id, `undici`,
      pagination loop, service-account filtering.
- [ ] `src/modules/users/` — controller (4 endpoints), `UserSyncService` (the
      algorithm above). **No `decorate()` helper and no in-process user map** —
      superseded by the snapshot columns.
- [ ] `src/modules/users/queue/` — BullMQ repeatable job (fixed `jobId`, daily)
      + startup run, following `files/queue/`.
- [ ] `stats.service.users()` — keep `GROUP BY userId`, resolve current names
      from `user_profiles` (`LIMIT 50`, one indexed query). **Never group by the
      snapshot name**, which would split a renamed person into several rows.
- [ ] Remove the now-obsolete TODO comment at `stats.service.ts:125`.
- [ ] Comment the `assign-to-non-publisher → 400` guard as advisory: it reads a
      directory that may be up to one sync interval stale, and the authoritative
      check is `assertCanTransition` on the token.
- [ ] `KEYCLOAK_WORKER_CLIENT_ID` / `KEYCLOAK_WORKER_CLIENT_SECRET` in
      `.env.shared` / `.env.dev` + `config.template.yml`.

### Tests

- [ ] `backend/test/api-test-suite.sh`: sync populates profiles;
      `?capability=publish` includes `editor` and excludes `cataloguer` (assert
      the inverted-terminology trap); `POST /users/sync` is 403 for `editor`,
      200 for `admin`.
- [ ] **The leak test, both vectors**: as `reader` and as anonymous, assert
      `createdByName` is absent from a search response *and* that
      `?fields=createdByName` does not return it.
- [ ] Attribution survives the directory: an item created by a user who is **not**
      in `user_profiles` still renders their name.
- [ ] A user deleted from Keycloak still renders their name on old items, and
      still resolves in the stats panel.
- [ ] **A sync that throws mid-enumeration leaves every `deletedAt` untouched.**
- [ ] **A request never writes `user_profiles`** — row count unchanged after
      authenticated traffic from a user the sync has not seen.

### Follow-on

- [ ] Task delegation consumes `GET /api/users?capability=publish` — drop
      `/api/tasks/assignable-users` from that plan.
- [ ] Frontend: assignee picker; "created by" column rendering the snapshot name
      directly off the row; admin sync button hitting `POST /api/users/sync`.

## Suggested order

The two halves are independent. Attribution is the one users notice.

1. **Attribution columns + JWT plumbing + backfill** — ships "created by Ana"
   everywhere in Postgres, no Keycloak Admin API involved.
2. **The strip + `fields` allowlist** — must land *before* step 3, or the reindex
   publishes staff names to anonymous callers.
3. **pgsync mapping + reindex** — search results gain names.
4. **Directory** (`user_profiles`, sync job, endpoints) — unblocks the picker,
   filtering, task delegation, and the stats names.

## Key Files

- `backend/prisma/schema.prisma:70` / `:85` / `:138` — `Draft`, `Record`, `ItemRevision`; where the snapshot columns go
- `backend/prisma/schema.prisma:160` — `ItemMetricDaily`, whose comment explains the pgsync reindex cost that snapshot semantics avoid
- `backend/src/core/auth/keycloak.strategy.ts:45` — `validate()`; add the display name here
- `backend/src/core/auth/resource-access.service.ts:154` — `assertCanTransition`, the publish capability
- `backend/src/modules/search/search.service.ts:251` — `buildSourceControl()`, the unallowlisted `?fields=` projection
- `backend/src/modules/search/search.service.ts:279` — `source: hit._source`, the wholesale passthrough
- `backend/src/modules/items/items.service.ts:115` — create; the first write site to populate
- `backend/src/modules/stats/stats.service.ts:125` — the TODO the directory closes, and the one place that must *not* use snapshots
- `backend/src/core/tika/tika.service.ts:2` — the `undici` house pattern
- `backend/src/modules/files/queue/` — BullMQ module/service/processor pattern
- `backend/src/modules/import/queue/import-queue.processor.ts:99` — the `'system'` sentinel
- `infrastructure/docker/keycloak/nbcg-realm.conf.json` — realm; both grants applied
- `infrastructure/docker/pgsync/schema.json` — needs the two new columns + `keyword` mapping on both nodes

## References

- [Event-driven ingestion of Keycloak entities — Red Hat Developer](https://developers.redhat.com/articles/2025/08/27/event-driven-ingestion-keycloak-entities) — why events are an optimisation over scheduled sync, not a replacement
- [User account synchronization in Microservices architecture — keycloak/keycloak #16056](https://github.com/keycloak/keycloak/discussions/16056) — the three approaches and their trade-offs
- [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html) — `first`/`max`/`briefRepresentation`, role-mapping endpoints
- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html) — service accounts, `realm-management` roles
