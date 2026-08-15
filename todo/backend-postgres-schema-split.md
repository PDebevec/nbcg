# Backend: Move `user_profiles` into its own `directory` Schema

## Status: PLANNING

Narrowed from an earlier draft that also moved `item_revisions`,
`item_metrics_daily` and `file_metrics_daily`. **Those stay in `public`.** Only
the user directory moves. See "Why only this table" for why that is the right
line to draw, and "The cost is fixed" for the one thing to go in knowing.

## The problem

The `nbcg` database is documented as the metadata database, but `public` also
holds `user_profiles`, which is not metadata about anything in the collection. It
is a shadow of the Keycloak realm — a list of staff.

## Why only this table — it is the odd one out, objectively

Not a judgement call. Every other table in `public` carries a link to an item;
`user_profiles` is the only one that does not:

| Table | Item linkage |
|---|---|
| `drafts`, `records` | the items themselves |
| `file_attachments` | `draft_id`, `record_id` |
| `item_relations` | `parentId`, `childId` |
| `item_revisions` | `itemId` |
| `item_metrics_daily` | `itemId` |
| `file_metrics_daily` | `itemId`, `fileId` |
| **`user_profiles`** | **none** |

Revisions and usage counters are *about items* — they are keyed by `itemId` and
they belong next to the things they describe. `user_profiles` is about people. It
is the only table in the database that would still make sense if the collection
were emptied.

## Is it genuinely standalone? Yes — verified

Checked against the running database on 2026-08-13:

- **Zero foreign keys**, in either direction. `information_schema` reports no FK
  constraint mentioning `user_profiles` as source or target. That is by design:
  item rows and revisions reference `userId` with no FK, so a departed user still
  resolves to a name.
- **Zero enum columns.** No `USER-DEFINED` types on the table, so there is no
  cross-schema type dependency to reason about. (The 7 enums all stay in `public`
  and none of them is used here.)
- **Zero triggers**, and not listed in `pgsync/schema.json` — no CDC involvement.
- **Zero sequences** in the whole database, so nothing needs moving by hand; the
  PK is a Keycloak `sub` stored as `TEXT`.
- **Zero raw SQL in `src/`.** This is the big one — `UsersService.resolveNames()`
  and every other read go through Prisma (`prisma.userProfile.findMany`), which
  qualifies from `@@schema` automatically. `stats.service.users()` does raw SQL
  against `item_revisions` and then a *separate* Prisma call for names, so there is
  no query anywhere that joins across the boundary.

It moves cleanly. Nothing else in the schema has to know.

## The move

| Schema | Tables |
|---|---|
| `public` | `drafts`, `records`, `file_attachments`, `item_relations`, `item_revisions`, `item_metrics_daily`, `file_metrics_daily` — **untouched** |
| `directory` | `user_profiles` |

`directory` maps onto `src/modules/users/`, which owns the table. `public` keeps
everything item-shaped, including the pgsync-tracked model and its triggers.

### `public` is not renamed

Tempting, still rejected. `public` is where pgsync installs its CDC triggers
(`public_drafts_notify`, …), the default target of all 16 existing migrations, and
Prisma's default. Renaming touches the one subsystem whose failure mode is a full
reindex, for a cosmetic gain a line of documentation covers.

## The cost is fixed, and it is worth knowing up front

The Prisma overhead does not scale with how many tables move. Once
`schemas = [...]` is set on the datasource, **every model and every enum needs an
`@@schema(...)` annotation** — that is **9 models + 7 enums = 16 annotations** to
relocate one table, plus the migration-review risk below. Same bill for one table
as for four.

That is not an argument to move more tables than you want to. It is the reason
this is a deliberate, one-time change rather than something to do twice: if
`item_revisions` or the metrics tables are ever moved later, the annotation work
and the review risk are already paid, and each subsequent move is one
`ALTER TABLE` and its call sites.

## Live-verified toolchain facts

**1. `multiSchema` is GA in Prisma 7 — do NOT add the preview flag.**
`prisma validate` accepts `schemas` + `@@schema` with no `previewFeatures`. Adding
`previewFeatures = ["multiSchema"]` warns: *"Preview feature "multiSchema" is
deprecated. The functionality can be used without specifying it as a preview
feature."* Most tutorials still tell you to add it.

**2. Every model AND enum needs `@@schema` once `schemas` is set.** Omitting it on
an enum is a `P1012` validation error, not a warning.

**3. Unqualified raw SQL breaks at runtime, and the build will not catch it.**
Default `search_path` is `"$user", public`. Here that only affects the 13 sites
listed below, all outside `src/`.

**4. Prisma's `?schema=` URL parameter is silently ignored in this project.** The
`@prisma/adapter-pg` driver adapter hands `DATABASE_URL` to node-postgres, which
does not know Prisma's `schema` param. Verified: `?schema=probe_zzz` left
`search_path` at `"$user", public`. The libpq form `?options=-c search_path=…`
does work. Worth knowing before losing an hour to the wrong knob.

**5. `ALTER TABLE … SET SCHEMA` is catalogue-only** — no table rewrite, instant at
any row count, brief `ACCESS EXCLUSIVE` lock. Indexes, constraints and the primary
key follow automatically, including
`user_profiles_canPublish_enabled_deletedAt_idx`.

**6. pgsync needs no change.** Per-table triggers, `pg_publication` empty, and
every tracked table stays in `public`. `pgsync/schema.json` is untouched and needs
no `"schema"` key.

**7. Backups need no change.** `infrastructure/scripts/backup.sh` runs restic over
docker *volumes*, not `pg_dump`.

**8. `BACKEND_REFERENCE.md`'s "Useful Queries" need no change** — every snippet
there touches `drafts`, `records`, `file_attachments` or `item_relations`.

## Raw SQL to qualify: 13 sites, none in `src/`

| File | Sites | Note |
|---|---|---|
| `src/**` | **0** | all access is through Prisma |
| `scripts/backfill-attribution.ts:58` | 1 | `SELECT … FROM user_profiles WHERE "userId" = ANY($1)` |
| `test/api-test-suite.sh` | 12 | lines 2031, 2047, 2051, 2063, 2075, 2085, 2096, 2169, 2210, 2211, 2237, 2238 |

All become `directory.user_profiles`. The script's `TARGETS` array is **not**
affected — its only entry that moves would have been `item_revisions`, which
stays.

### Qualify explicitly rather than widening `search_path`

Adding `?options=-c search_path=public,directory` would make all 13 keep working
untouched. Rejected: it hides the split, it is load-bearing config in an env var
nothing validates (failing at the first directory query rather than at boot), and
with only 13 mechanical edits the explicit form is cheaper than the indirection.

## Migration

One hand-written migration. **Do not use a generated one unreviewed** — see Risks.

```sql
-- The user directory is a shadow of the Keycloak realm, not metadata about the
-- collection: it is the only table here with no link to an item. `public` keeps
-- everything item-shaped, including the tables pgsync's CDC triggers watch.
CREATE SCHEMA IF NOT EXISTS directory;

-- Catalogue-only: no rewrite, and the index, primary key and constraints follow
-- the table. No sequence, no foreign key, no enum dependency.
ALTER TABLE public.user_profiles SET SCHEMA directory;
```

## Risks

**1. Prisma's differ may emit `DROP` + `CREATE` rather than `SET SCHEMA` — that is
data loss.** A table that vanished from `public` and appeared in `directory` can
diff as two operations. **Mitigation, non-negotiable:** run
`prisma migrate dev --create-only`, read the generated SQL, and replace it with
the block above if it contains `DROP TABLE`. Then confirm
`prisma migrate diff --from-schema-datasource --to-schema-datamodel` reports no
drift. `pg_dump` first; it takes seconds on this dataset.

*Consolation:* the table is rebuildable. If it were lost, `POST /api/users/sync`
repopulates it from Keycloak in ~250ms. That is true of no other table in this
database, and it is another reason this is the safest one to move first.

**2. A missed raw SQL site fails at runtime, not at build.** With zero sites in
`src/`, the blast radius is the backfill script and the test suite — both of which
fail loudly and neither of which is in the request path. §16 and §17 of the API
suite exercise every directory endpoint, so a missed site surfaces immediately.

**3. Future raw SQL will forget the prefix.** Mitigated by the guard test below
plus a note in `schema.prisma`.

**4. Migration and code deploy together.** `start:prod` runs
`prisma migrate deploy && node dist/src/main.js`, so the window is a boot cycle.
Since no request-path SQL is affected, even that window is benign here.

**5. Ad-hoc psql gets one prefix longer** for directory queries, and pgadmin gains
a tree node.

**Not a risk:** pgsync/CDC, the reindex path, backups, OpenSearch, Keycloak, the
children-count trigger, `stats.service` (its raw SQL touches only `public` tables),
or any FK — there are none.

## Upside

- **Per-schema grants become possible.** A reporting role could be given `USAGE` on
  `public` and denied the staff directory outright — currently impossible, and the
  directory is the one table here holding personal data (names, emails).
  That is a real access-control boundary, not just tidiness.
- **`\dt public.*` becomes an honest answer** to "what is the metadata model?"
- **The next non-item table has an obvious precedent.** When
  [Task Delegation](backend-task-delegation.md) adds `WorkTask`/`TaskComment` —
  which *are* item-linked and so belong in `public` — the question at least gets
  asked deliberately.

## Changes Needed

### Schema + migration
- [ ] `datasource db { schemas = ["public", "directory"] }` in `schema.prisma`.
      **No `previewFeatures`** — deprecated in Prisma 7.
- [ ] `@@schema("public")` on the 8 staying models and all 7 enums;
      `@@schema("directory")` on `UserProfile`. 16 annotations total.
- [ ] Hand-written migration: `CREATE SCHEMA directory` +
      `ALTER TABLE public.user_profiles SET SCHEMA directory`. Verify Prisma
      generated no `DROP`.
- [ ] `npx prisma generate`, then `prisma migrate diff` to confirm zero drift.

### Raw SQL (13 sites)
- [ ] `scripts/backfill-attribution.ts:58` → `directory.user_profiles`.
      Leave `TARGETS` alone.
- [ ] `test/api-test-suite.sh` — 12 `psql_query`/`psql_text` statements.

### Tests
- [ ] **Guard test**: `user_profiles` exists in `directory` and **not** in
      `public`, via `pg_tables`. Catches a half-applied migration and a future
      table created in the wrong namespace.
- [ ] `npx jest` (42 tests) — should be untouched, it mocks Prisma.
- [ ] `api-test-suite.sh` (308 tests). §16 and §17 are the canaries.
- [ ] Confirm a fresh `make qd && make qs` reproduces `directory` from the
      migrations alone.

### Docs
- [ ] `BACKEND_REFERENCE.md` — mark `user_profiles` as `directory.user_profiles`
      in the table listing, add a short "Database layout" note (`public` = the
      item model and its CDC-tracked tables; `directory` = the Keycloak shadow),
      and state the raw-SQL qualification rule. "Useful Queries" unchanged.
- [ ] Note in `schema.prisma` that raw SQL against `directory` must qualify.

## Estimate

Two to three hours. The thinking is entirely in the migration review (risk 1); the
rest is 13 find-and-replace edits, 16 annotations, and a test run.

## Open questions

- **Do `item_revisions` and the metrics tables ever follow?** Deliberately left in
  `public` — they are item-keyed and belong beside the items. If that changes, the
  annotation work and review risk are already paid by this task.

## Key Files

- `backend/prisma/schema.prisma` — `schemas` on the datasource, `@@schema` on 16 blocks
- `backend/scripts/backfill-attribution.ts:58` — the one script query
- `backend/test/api-test-suite.sh` — 12 psql statements, lines listed above
- `backend/src/modules/users/users.service.ts` — **no change**, all Prisma
- `backend/src/modules/stats/stats.service.ts` — **no change**, its raw SQL is `public`-only
- `infrastructure/docker/pgsync/schema.json` — **no change** (fact 6)
- `infrastructure/scripts/backup.sh` — **no change** (fact 7)
