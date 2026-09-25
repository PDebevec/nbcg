# Backend development

NestJS + Prisma 7 in `backend/`. API reference: [reference.md](reference.md).

## Run it locally

The infrastructure (Postgres, Redis, OpenSearch, pgsync, SeaweedFS, Keycloak)
runs in Docker via the infrastructure CLI (`make qs` for a quick start, see
[infrastructure-cli.md](../infrastructure/infrastructure-cli.md)). The API
itself is usually run by hand:

```bash
cd backend
npm install
npx prisma generate
npm run start:dev        # nest start --watch, http://localhost:3000/api
```

- `npm run build` → the entry point is **`dist/src/main.js`**, not
  `dist/main.js`, because `generated/` and `prisma.config.ts` sit outside `src/`.
- `npm run start:prod` = `prisma migrate deploy` + `node dist/src/main.js`.
- The API refuses to boot if the metadata schema v2 self-check fails
  (`SchemaService.onModuleInit`); the error lists every problem.
- `nest start --watch` has been seen (2026-09-24) to stop re-emitting some
  files: `dist/…/items.service.js` stayed an hour old while other files rebuilt,
  and the server was not restarted. If a change seems to have no effect, compare
  the `dist/` timestamp with the source and restart the watcher.

## ⚠ Do not run `npm run lint`

It is `eslint --fix`, and `.prettierrc` sets `useTabs: true` while the code is
2-space indented — it rewrites ~80 untouched files. Verify with `npm run build`
(type-check). For lint output, run `npx eslint <file>` **without** `--fix`. If it
was run by accident: `git checkout -- backend/src backend/generated`, re-apply
the real edits, `npx prisma generate`.

## Database

```bash
docker exec -it nbcg-db-1 psql -U nbcg -d nbcg     # no local psql needed
```

Migrations: `npx prisma migrate dev --name <name>` (dev), `migrate deploy` (prod,
done by `start:prod`). Raw SQL that Prisma cannot express (triggers) goes into
the migration file by hand. **Partial indexes can be declared in the schema**
since task workflow v2 — `previewFeatures = ["partialIndexes"]` and
`@@unique([…], where: { status: "OPEN" })` (see `tasks_one_open_per_item`).

When `migrate dev` refuses to run ("the environment is non-interactive" — it
wants to confirm a data-loss warning, e.g. removing an enum value) or the
migration needs data steps in between:

```bash
# SQL Prisma would generate, against the DB as it is now (all earlier migrations applied)
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# write it into prisma/migrations/<timestamp>_<name>/migration.sql, add the data
# steps, apply:
npx prisma migrate deploy && npx prisma generate
# no drift = the same diff now prints "This is an empty migration."
```

Prisma does **not** wrap a migration file in a transaction; add `BEGIN; … COMMIT;`
yourself when a failure half-way would leave data half-converted. Try a data
migration on a throwaway database first (`CREATE DATABASE nbcg_migtest`,
`DATABASE_URL=…/nbcg_migtest npx prisma migrate deploy`, seed, apply, inspect,
drop). Don't run `npx prisma format` just to tidy — it realigns unrelated models.

### ⚠ "Migration was modified after it was applied — reset?" → do NOT reset

`_prisma_migrations` holds three rows for
`20260811120000_add_item_revisions_and_usage_metrics`: two rolled-back attempts
and the successful one. The first failed row carries the checksum of a pre-fix
`migration.sql` that no longer exists, and Prisma compares disk against every
row with that name. `migrate reset` would drop the whole dev database. Instead
realign the checksum (bookkeeping only):

```sql
UPDATE _prisma_migrations
SET checksum = '<sha256sum of the on-disk migration.sql>'
WHERE migration_name = '20260811120000_add_item_revisions_and_usage_metrics'
  AND checksum = '<the stale one>'
  AND rolled_back_at IS NOT NULL;
```

This is latent for every fresh clone that ever runs `migrate dev` against a
database with that history.

## Tokens for manual calls

```bash
TOKEN=$(curl -s -X POST http://localhost:8082/realms/nbcg/protocol/openid-connect/token \
  -d "client_id=nbcg-web&grant_type=password&username=admin&password=admin" | jq -r .access_token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/tasks?assignedTo=me
```

Users `admin`, `editor`, `cataloguer`, `reader` (password = username) — see
[roles](../shared/roles-and-permissions.md). Tokens live ~5 minutes.

## Tests

- **`backend/test/api-test-suite.sh`** — the end-to-end suite against a running
  API + real infrastructure, organised in numbered sections (§1 health … §18
  task delegation, §19 metadata schema v2). **Every new or changed endpoint/behaviour gets tests here,
  for every persona (anonymous, reader, cataloguer, editor, admin), before the
  work counts as done** — including response-shape-only changes.
- `npm test` — jest unit specs (`*.spec.ts`), e.g. `tasks.service.spec.ts`,
  `search.service.spec.ts`, and the schema v2 specs under `src/modules/schema/`.
- Items that get **published** in the suite must pass publish validation: add
  `'"$PUBLISHABLE"'` (a book with its page count) to their metadata, as the
  existing fixtures do.
- Some §16/§18 tests need the user directory synced first (`POST
  /api/users/sync`), otherwise they SKIP.

## Metadata schema v2 — changing fields or rules

- A new metadata field goes into `DomainRecord` + `DOMAIN_RECORD_SHAPE`
  (`cobiss.types.ts`) **and** `src/modules/schema/v2/record-fields.ts` +
  `labels.ts`. Forget either and the self-check fails the boot (and jest), by
  design — that is what stops a field being silently dropped again.
- A rule change = `record-fields.ts` + the matching cases in
  `rules/conformance.json`.
- `rules/evaluate.ts` is copied verbatim to the web frontend
  (`frontend/src/utils/schemaRules.ts`); once that copy exists,
  `evaluate.spec.ts` fails until both are identical. Keep the file import-free.
- A new `suggest` needs an entry in `src/modules/search/suggest-fields.ts`.

## OpenSearch mapping changes

Changing `infrastructure/docker/pgsync/schema.json` needs a reindex — see
[opensearch-reindex.md](../infrastructure/opensearch-reindex.md) — unless the
field does not exist in any document yet (then one `PUT _mapping`, same doc). Anything that
changes often (counters, logs, tasks) must stay **out** of pgsync: a change to a
tracked row re-indexes the whole document, extracted file text included.

## Conventions seen across the code

- Every write carries an `Actor` (`actorOf(principal)`, or `SYSTEM_ACTOR` in
  the import queue); names are snapshots on rows and live lookups in lists.
- Append-only logs (`item_revisions`, `task_history`) have **no FK** to what
  they describe, so they survive deletion.
- One user action → one log row.
- Advisory checks (directory-based) never replace token checks.
- Hidden items answer 404, never 403.
- Comments explain *why*, at length where a decision is non-obvious — keep that
  style.
