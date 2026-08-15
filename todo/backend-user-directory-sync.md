# Backend: User Directory + Attribution Snapshots

## Status: DONE — all four steps landed 2026-08-13

Attribution snapshots, the search leak fix, the pgsync mapping + reindex, and the
directory (`user_profiles`, `KeycloakAdminService`, the sync job, four endpoints)
are all in and verified against the live stack.

- `backend/test/api-test-suite.sh`: **307 passed, 0 failed, 1 skipped** (308 total),
  including the leak test with a working positive control and a fault-injected
  failed sync.
- `npx jest`: **42 passed** — see the note under Tests, because this task started
  by *breaking* the existing spec without the build noticing.

Remaining work is the Follow-on section: task delegation consuming
`GET /api/users?capability=publish`, and the frontend.

Split out of [Task Delegation](backend-task-delegation.md), which sketched a
`UserProfile` model but left the sync mechanism open.

> **Follow-up planned:** [Move `user_profiles` to a `directory` schema](backend-postgres-schema-split.md)
> — it is the only table in the database with no link to an item. Nothing in this
> task changes if that lands: every read here goes through Prisma, which qualifies
> from `@@schema` automatically.

## How it works, end to end

The two halves never touch each other at runtime. That separation is the whole
design, so here is the actual flow rather than the rationale.

### Writing an item (attribution — no directory involved)

```
POST /api/items  ──►  KeycloakJwtStrategy.validate()
                        reads given_name / family_name / preferred_username
                        from the token, builds displayName via formatDisplayName()
                      ScopesGuard  ──►  Principal { sub, displayName, scopes: Set }
                      ItemsController  ──►  actorOf(principal) = { userId, userName }
                      ItemsService.create()
                        writes createdByUserId + createdByName onto the row
                        writes the same pair onto the ItemRevision, in one transaction
```

No database lookup anywhere in that path. A brand-new Keycloak user who has never
been synced gets their name rendered correctly on their very first request. The
COBISS importer has no principal, so it passes `SYSTEM_ACTOR`
(`'system'` / `'System (import)'`).

The name is **frozen**. `transition()` copies the source row's `createdByName`
across, so publishing does not reattribute the creator. A rename in Keycloak never
rewrites history — which is what stops one rename re-indexing every document that
person ever touched.

### Reading a name back

Straight off the row. No join, no cache, no decorate step — from Postgres or from
OpenSearch alike, because pgsync ships `createdByName` as a `keyword` field.

Staff-only on the way out, enforced twice:

```
GET /api/search  ──►  canSeeAttribution(principal)     drafts:manage OR records:manage
                      buildSourceControl(fields, show)  ──► OpenSearch _source.excludes
                      mapHit(hit, show)  ──►  sanitizeSource() deletes the keys again
```

Both layers are deliberate. The excludes stop the field leaving OpenSearch;
`sanitizeSource` stops it leaving the process if a future query path forgets them.
`?fields=` is checked against an allowlist so the projection cannot re-request a
withheld field, and `excludes` now rides along on the projected branch too — which
also closed an unrelated hole where `?fields=file_attachments` returned megabytes
of `extractedText`.

### Populating the directory (sync — no request involved)

```
app boot ──► UserSyncQueueService.onModuleInit()
               registers a repeatable job (fixed jobId, daily, deduped via Redis)
               enqueues one immediate run
POST /api/users/sync (users:manage) ──► enqueues the same job

UserSyncProcessor (concurrency 1) ──► UserSyncService.reconcile()
   1. GET /users?briefRepresentation=false&first=N&max=100   (paginate to a short page)
   2. per user: GET /users/{id}/role-mappings/clients/{uuid}/composite
                canPublish = scopes ⊇ { records:manage, drafts:manage }
   3. upsert every roster row
   4. ONLY if 1-3 all succeeded and the roster is non-empty:
        set deletedAt on rows not in the roster, clear it on rows that came back
```

Step 4's guard is the load-bearing one: a failed enumeration must not turn users
into departures. Step 2's `/composite` is what makes storing group membership
unnecessary — it resolves group-derived roles *and* expands `records:manage` into
its `records:view:*` composites.

### Reading the directory

`GET /api/users` is a single indexed read for pickers and filters. It is never in
the auth path — `canPublish` is a UI hint, and the real check stays
`assertCanTransition(principal)` on the token. `email` is withheld below the same
staff bar as attribution.

`/api/stats/users` is the one place that must **not** use the snapshots: it groups
by `userId` alone and resolves current names through `UsersService.resolveNames()`,
because grouping by a snapshot name would split a renamed person into two rows.

**Rule of thumb: snapshot for a specific row, directory for a group of rows.**

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

⚠️ **`view-users` is not sufficient.** It does not cover `GET /clients`, which is
403 with `view-users` alone — and the plan's "resolve the `nbcg-api` internal
client UUID at startup" needs exactly that call. Two dead ends before the fix:
`GET /users/{id}/role-mappings` returns an empty `clientMappings` (this realm's
roles are group-derived, which is the same fact that makes the composite endpoint
necessary), and `query-clients` returns `200` with an **empty list** — worse than
a 403, because it reads as "the client does not exist".

**Applied:** `realm-management` → `view-clients` on
`service-account-nbcg-worker`, live and in `nbcg-realm.conf.json`. Read-only, and
still far short of `realm-admin`. Effective roles are now `view-users`,
`view-clients`, `query-users`, `query-groups`, `query-clients`.

⚠️ **The worker secret is not in the repo.** `nbcg-realm.conf.json` stores it as
the literal `**********` — Keycloak masks client secrets on export — so there is
nothing to "reuse", and a `make qd && make qs` would not reproduce whatever the
live instance holds. **Decided:** pin an explicit literal secret in the realm
JSON and in `.env.dev`, the way `KEYCLOAK_ADMIN_PASSWORD=nbcg` already is, and
set the same value on the live client. Prod regenerates it through the existing
`append_prod_secrets` path in `generate-env.sh`.

Two further config corrections: `KEYCLOAK_URL` lives in `.env.dev`, not
`.env.shared` (only `KEYCLOAK_REALM` and `KEYCLOAK_CLIENT_ID` are shared), and
`backend/.env` is generated by `gen-end-env.sh`, which sets the `KEYCLOAK_*`
vars **only in its dev branch** — so the worker vars need an edit there too.
`config.template.yml` is the wrong home for the secret: it carries an explicit
"do not add secrets to the template file" warning.

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

As shipped this lives in `public`, like everything else. Moving it to a
`directory` schema is planned separately —
[Move `user_profiles` to a `directory` schema](backend-postgres-schema-split.md).
It changes no code in this task: `UsersService` and `UserSyncService` go
through Prisma, which qualifies from `@@schema` on its own.

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

- **Should `GET /api/users` expose email?** ✅ **Resolved: only above the staff
  bar.** `email` is included for principals holding `drafts:manage` or
  `records:manage` and omitted otherwise — the same bar that gates attribution, so
  no new scope and one rule to remember. Seeing *who exists* stays open to any
  authenticated principal, because a picker needs it; seeing how to contact them
  is a step further and nothing below that bar needs it. Asserted in §16.
- **What happens to a deactivated user's open tasks?** Still open —
  task-delegation territory, but it is this table that flips the flag.

## Changes Needed

### Realm — ✅ DONE (live + config)

- [x] `service-account-nbcg-worker` → `realm-management:view-users`
- [x] `users:manage` role on `nbcg-api`, granted to `nbcg/admins`

### Backend — attribution (independent of the directory; can ship first) — ✅ DONE

- [x] `createdByName` / `updatedByName` on `Draft` + `Record`, `userName` on
      `ItemRevision`, in `schema.prisma` + migration
      (`20260813190000_add_attribution_snapshots`). Added **nullable, backfilled
      with placeholders, then `SET NOT NULL`** — a plain `ADD COLUMN … NOT NULL`
      fails on non-empty tables, and these tables are not empty.
- [x] Populate from the JWT at every write site. Done by replacing the bare
      `userId: string` parameter with an `Actor` (`{ userId, userName }`) through
      `items.service`, `files.service`, `relations.service` and
      `RevisionInput` — 8 write sites and 4 controllers. `actorOf(principal)` at
      the controller boundary, `SYSTEM_ACTOR` on the import queue.
      `transition()` carries the source row's `createdByName` across, so
      publishing does not reattribute the creator.
- [x] Extend `keycloak.strategy.ts` + `Principal` to carry the display name
      from `given_name`/`family_name`/`preferred_username`. **This is for
      attribution only** — it must not become a write path into `user_profiles`.
- [x] Share one `formatDisplayName()` helper between the strategy and the sync —
      `src/shared/util/display-name.ts`, which also owns `SYSTEM_USER_ID`,
      `SYSTEM_USER_NAME` and `UNKNOWN_USER_NAME`.
- [x] **Backfill existing rows** before the reindex — done, 172 rows rewritten
      across `drafts`, `records` and `item_revisions`. Zero `'Unknown user'`
      remain. Ran after the directory half, before the reindex (see the
      reordering note under "Suggested order").
- [x] **Strip attribution for principals without `drafts:manage` or
      `records:manage`**. Enforced twice on the search path: OpenSearch `_source`
      excludes, and `sanitizeSource()` in the process before the hit leaves
      `SearchService`. Verified the bar admits cataloguer (holds `drafts:manage`)
      and excludes `reader` (`records:view:*` only) and anonymous. No other read
      path needed it — `/items/:id/history` is already gated on
      `records:view:hidden` + `drafts:view:hidden`, which is stricter.
- [x] **Allowlist `?fields=`** in `buildSourceControl()`, and stop returning
      `hit._source` wholesale. Both landed. The allowlist also closed a second,
      unrelated hole the plan did not name: the old includes-only branch emitted
      no `excludes`, so `?fields=file_attachments` returned megabytes of
      `extractedText`. `excludes` now applies on both branches.
- [x] Admin backfill script: `backend/scripts/backfill-attribution.ts`. Same
      script serves both jobs — no args for the full backfill, `--user <sub>` for
      a single correction, `--dry-run` for either. Plain `pg` and explicit SQL
      rather than the Prisma client, which cannot be required under ts-node. An
      id with no directory row is **left alone** rather than stamped
      `'Unknown user'`: an unresolvable id usually means the directory has not
      synced yet, and overwriting a real name with a placeholder is worse than
      leaving the placeholder.

### Infrastructure — ✅ DONE

- [x] `pgsync/schema.json` — `createdByName`/`updatedByName` added to the
      `columns` list and given an explicit `keyword` mapping on **both** the
      `records` and `drafts` nodes.
- [x] One full reindex of `records` + `drafts`, run **after** the backfill.
      Procedure: stop pgsync → `DELETE /records,drafts` → `DEL
      queue:nbcg_records:meta queue:nbcg_drafts:meta` in Redis → start pgsync.
      Verified after: 11 records + 5 drafts (matching Postgres), `keyword`
      mapping on all four attribution fields, names populated in `_source`, and a
      terms aggregation on `createdByName` returning buckets — which was the
      whole point of `keyword` over `text`.
      Note `_cat/indices` reports 25 docs for `records`: nested
      `file_attachments` are separate Lucene docs. Use `_count` to compare
      against Postgres.

### Backend — directory — ✅ DONE

- [x] `UserProfile` model in `schema.prisma` + migration
      (`20260813200000_add_user_profiles`, `@db.Timestamptz(3)` throughout).
- [x] `src/core/keycloak/keycloak-admin.service.ts` — client-credentials token
      with caching + 401 re-mint, cached `nbcg-api` internal client id, `undici`,
      pagination loop, service-account filtering.
- [x] `src/modules/users/` — controller (4 endpoints), `UserSyncService` (the
      algorithm above), `UsersService` for the read side. No `decorate()` helper
      and no in-process user map.
- [x] `src/modules/users/queue/` — BullMQ repeatable job (fixed `jobId`, daily)
      + startup run. Verified in the log: `User directory synced: 5 seen, 0 marked
      absent, 0 restored, 255ms`.
- [x] `stats.service.users()` — groups by `userId` alone and resolves current
      names through `UsersService.resolveNames()`. The accumulator got its own
      `UserCounts` type so `displayName` is added once, at the end, rather than
      carried as a placeholder through the aggregation.
- [x] Removed the obsolete TODO comment in `stats.service.ts`.
- ⟶ Comment the `assign-to-non-publisher → 400` guard as advisory: **not
      actionable here.** Task delegation has not built that guard yet, so there is
      nothing to annotate. Carried into Follow-on below.
- [x] `KEYCLOAK_WORKER_CLIENT_ID` in `.env.shared`,
      `KEYCLOAK_WORKER_CLIENT_SECRET` in `.env.dev`, both propagated to
      `backend/.env` by `gen-end-env.sh`, and the secret added to
      `generate-env.sh`'s `append_prod_secrets` so prod generates its own.
      **Not** in `config.template.yml` — that file carries an explicit "do not add
      secrets" warning.

### Tests

- [x] **Unit tests, and a bug this task created and nearly shipped.**
      `src/modules/search/search.service.spec.ts` already existed and the
      attribution work **broke 19 of its 30 tests** — `npm run build` stayed green
      throughout, because both causes were runtime, not type, problems:
      1. Its principal fixture was `{ scopes: [] } as unknown as Principal`. An
         array cast through `unknown` compiles, and then `canSeeAttribution`
         calls `.has()` on it. `Principal.scopes` is a `Set`. Replaced with a
         `principalWith(scopes)` helper that builds a real one, plus a
         `staffPrincipal` above the bar.
      2. One assertion was `expect(body._source.excludes).toBeUndefined()`, which
         **pinned the leak in place** — it asserted the includes-only projection
         was correct. Inverted, with a comment saying why.
      Added 12 unit tests for the new rules: the `?fields=` allowlist (unknown
      names dropped, sub-paths allowed, `id`-only fallback), both sides of the
      attribution bar, that a projection naming `createdByName` still gets it
      excluded, and that `sanitizeSource` does not mutate the document it was
      handed. **42 passing.**
      Lesson worth keeping: `npm run build` is not a test run. This suite is not
      wired into any script beyond `npm test`, so it is easy to forget it exists.
- [x] `backend/test/api-test-suite.sh` §16: sync populates profiles;
      `?capability=publish` includes `editor` and excludes `cataloguer` (the
      inverted-terminology trap, asserted in both directions); `POST /users/sync`
      is 403 for `editor` (and reader, and cataloguer), 401 for anonymous, **201**
      for `admin` — Nest returns 201 from a POST, not 200. Also: service accounts
      absent from the directory, email withheld from `reader`, `GET /users` 401
      for anonymous, unknown id → 404, and `user_profiles` excluded from pgsync.
- [x] **The leak test, both vectors**: as `reader` and as anonymous, assert
      `createdByName` is absent from a search response *and* that
      `?fields=createdByName` does not return it. Section 15 of
      `api-test-suite.sh`, plus a **positive control** (admin and cataloguer *do*
      see the name) — without it the four absence assertions also pass on an
      index that simply lacks the column, which is the state until the reindex.
      The control is skipped while `pgsync/schema.json` has no `createdByName`,
      so it activates by itself when step 3 lands.
- [x] Attribution survives the directory: an item created by a user who is **not**
      in `user_profiles` still renders their name. Trivially true today — the
      table does not exist and no write path consults it — and asserted as
      "created / edited / published by" over three different users.
- [x] A user deleted from Keycloak still renders their name on old items, and
      still resolves in the stats panel. Tested with a synthetic profile row that
      no Keycloak user backs: a sync marks it `deletedAt`, it drops out of the
      default list, `?active=false` still shows it, and `/stats/users` resolves it
      to the **directory** name rather than the older snapshot on its revision —
      which is the assertion that would catch an aggregate grouping by the
      snapshot.
- [x] **A sync that throws mid-enumeration leaves every `deletedAt` untouched.**
      §17, fault-injected for real by stopping the Keycloak container. The API
      keeps validating the already-minted token from its cached JWKS, so the
      request still lands while the Admin API call cannot — `lastError` is
      populated, `deletedAt` and the row count are unchanged, and Keycloak is
      restarted and waited for before the suite continues.
- [x] **A request never writes `user_profiles`** — row count unchanged after
      authenticated traffic across three endpoints and three personas.

### Follow-on

- [ ] Task delegation consumes `GET /api/users?capability=publish` — drop
      `/api/tasks/assignable-users` from that plan.
- [ ] When task delegation builds the `assign-to-non-publisher → 400` guard,
      comment it as advisory: it reads a directory that may be up to one sync
      interval stale, and the authoritative check is `assertCanTransition` on the
      token.
- [ ] Frontend: assignee picker; "created by" column rendering the snapshot name
      directly off the row; admin sync button hitting `POST /api/users/sync`.

## Suggested order

The two halves are independent. Attribution is the one users notice.

1. ✅ **Attribution columns + JWT plumbing** — ships "created by Ana"
   everywhere in Postgres, no Keycloak Admin API involved.
2. ✅ **The strip + `fields` allowlist** — must land *before* step 3, or the reindex
   publishes staff names to anonymous callers.
3. ✅ **pgsync mapping + reindex** — search results gain names.
4. ✅ **Directory** (`user_profiles`, sync job, endpoints) — unblocks the picker,
   filtering, task delegation, and the stats names.

⚠️ **The backfill had to move, and did.** This order put it in step 1, but
resolving a `sub` to a name needs `KeycloakAdminService`, which is built in step
4 — while the plan also required the backfill to land *before* the step 3
reindex, or the index ships a column full of placeholders. The three could not all
hold. **What was actually done: 1 → 2 → 4 → backfill → 3.** Nothing was lost by
delaying the reindex, because the index carried no attribution until it ran.

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
