# Dev environment

How to actually bring the stack up locally, verified 2026-10-03. The top-level
[README](../../README.md) still points at `make qs`, which no longer exists —
this file is the sequence that works.

## The sequence

```sh
make check ENV=dev     # prerequisites; also fails on master.config drift
make setup ENV=dev     # writes .env, frontend/.env, backend/.env, renders
                       # conf templates, copies the compose files to the root
make up                # 11 containers, project name dev-nbcg
make migrate           # prisma migrate deploy against the published port
make app A=start T=backend
make app A=start T=frontend
```

`make setup` **does not** start anything — it only generates files. After it,
the backend and frontend are plain host processes under pm2, not containers
(containers for those exist only in the prod overlay).

First run only: `make app A=setup T=frontend` / `T=backend` for
`npm install` + `quasar prepare`, and `cd backend && npx prisma generate`.
`make up` on a clean machine pulls every image (a few minutes).

Tear down: `make stop` keeps volumes and data; `make down-v` + `make clear
T=volumes` wipes them. `make down` removes the containers.

## Where things are

| What | Where | Notes |
|---|---|---|
| Web app | http://localhost:3080 | Quasar dev server; proxies `/api` → :3000 |
| API | http://localhost:3000/api | health is `GET /api/health` |
| Keycloak | http://localhost:8082 | realm `nbcg`, `start-dev --import-realm` |
| OpenSearch | http://localhost:9200 | security plugin **off** in dev |
| Dashboards | http://localhost:5601 | |
| pgAdmin | http://localhost:8081 | no master password in dev |
| Postgres (metadata) | `localhost:15432`, user/db/pass all `nbcg` | |
| Postgres (Keycloak) | `localhost:25432` | separate volume |
| Redis | `localhost:6379` | |
| SeaweedFS | master `:9333`, volume `:8083` | low-level needle API, no filer/S3 |
| psql without a local install | `docker exec dev-nbcg-db-1 psql -U nbcg -d nbcg` | |

Compose project name is `dev-nbcg` in dev and `nbcg` in prod, so both can be up
at once. Compose is always invoked from the repo root as
`docker compose -f docker-compose.yml -f docker-compose.ext.yml` — the copies in
the repo root are the live config, `infrastructure/docker/` holds the templates.

## No headless browser on this machine

There is no Chrome/Chromium/Firefox binary and no puppeteer cache, so the
frontend can only be checked by `curl` (does the SPA shell serve, does `/api`
proxy) plus `npm run build` for the type-check. Any "clicked through in
headless Chrome" claim in the docs came from a different machine.

## ⚠ The documented dev test users do not exist

`docs/backend/development.md` ("Tokens for manual calls") and the header of
`backend/test/api-test-suite.sh` both say the realm has users `admin`,
`editor`, `cataloguer`, `reader` with password = username. **As of
2026-10-03 the dev realm has exactly one human user, `mijav`
(`admin@demo.com`), whose password is not `mijav`.** All five password grants
return `invalid_grant`, so the whole API test suite fails at step 1
("Setup: Acquiring tokens") and cannot run until they are recreated.

The realm template itself ships **no** human users (see
`infrastructure/docker/keycloak/nbcg-realm.conf.json`) — first login is
self-registration, and the template is only applied on a *fresh* realm boot
(`Strategy: IGNORE_EXISTING`). So they were created by hand at some point.

To recreate them, create the user in the realm and add it to the matching
group (`/nbcg/admins`, `/nbcg/editors`, `/nbcg/cataloguers`, `/nbcg/readers` —
roles come from the group, not from the user). Then
`POST /api/users/sync` (admin token) repopulates `user_profiles`; until that
runs, §16/§18 of the test suite SKIP.

`user_profiles` currently holds one stale row (`mijav`, `canPublish = true`)
left over from an earlier sync — `mijav` has no group membership now, so a
sync would flip `canPublish` to false.

## Things in the repo that no longer exist

Found while verifying, not yet cleaned up:

- `make cron-backup` / `make cron-restore` call
  `infrastructure/scripts/backup.sh` and `restore.sh`. **Neither file exists** —
  there are no `.sh` files in `infrastructure/scripts/` at all. Both targets are
  `.PHONY`, listed in `make help`, and cited as real by
  `docs/backend/plans/postgres-schema-split.md`. `RESTIC_REPO` /
  `RESTIC_PASSWORD` are still declared in `env/.env.prod`. (Restic backup was
  removed; `infrastructure-cli.md` says so correctly, the other two do not.)
- `Makefile` and `infrastructure-cli.md` both claim the legacy `scripts/*.sh`
  flow is "still on disk and still runnable by hand". There is no `.sh` there.
- `infrastructure/docker/docker-compose.yml` points at
  `infrastructure/README.md`, which does not exist.
- `infrastructure/.gitignore` ignores `docker/opensearch/.generated.json`;
  no code path writes that file.
- The nginx healthcheck comment in `docker-compose.prod.yml` claims
  `localhost` is not in `available_hostnames` — the shipped template includes it.

## Stale claims elsewhere in the docs

| Claim | Where | Reality |
|---|---|---|
| "Every one of the 11 dev records is affected" (COBISS `extent`) | `frontend/overview.md` known issues | the dev database holds **4 records + 1 draft** — most were wiped |
| `make qs` is the quick start | `README.md` | target removed; use the sequence above |
| backend type-check is `npm run build` | `development.md` | true, but `tsconfig.build.json` excludes `**/*spec.ts`, so `npx tsc --noEmit` fails on `src/modules/search/search.service.spec.ts:357` while `npm run build` and `npm test` both pass (290/290) |
| infra setup table lists 6 steps | `infrastructure-cli.md` | 8 exist (`osSecurity` and `appImages` are missing from the table), and `certs` builds a private CA, not self-signed certs |

## Dead code worth deleting

| What | Where |
|---|---|
| `pm2` as a **runtime** dependency of a static SPA (AGPL) | `frontend/package.json` |
| `keycloak-connect` — in `package.json`, imported nowhere | `backend/package.json` |
| `npm run test:e2e` — points at `test/jest-e2e.json`, which does not exist | `backend/package.json` |
| `CobissImportService` — an empty `@Injectable()` class, not even declared in its module | `backend/src/modules/import/cobiss/cobiss-import.service.ts` |
| `JwtAuthGuard` — defined, never registered | `backend/src/core/auth/auth.guard.ts` |
| Quasar starter leftovers | `frontend/src/components/{EssentialLink.vue,ExampleComponent.vue,models.ts}`, `frontend/src/stores/example-store.ts`, `frontend/src/assets/{quasar-logo-vertical.svg,image-stock.jpg,logoV2_trimmed_white.jpg}` |
| `console.log(process.env["DATABASE_URL"])` — prints the DB URL (with password) on every prisma CLI call | `backend/prisma.config.ts` |
| `backend/generated/` is **committed** (19 files) and was stale — regenerating produces a diff against `schema.prisma`. Either regenerate on every schema change or stop tracking it | `backend/generated/prisma/internal/class.ts` (`inlineSchema`) |
| `getConfigValue()` — exported, imported nowhere | `infrastructure/scripts/lib/config-utils.js` |

## Two traps in this repo, restated

1. **Never `npm run lint` in `backend/`** — it is `eslint --fix` and
   `.prettierrc` sets `useTabs: true` against 2-space-indented code, so it
   rewrites ~80 untouched files. Verify with `npm run build`.
2. **Never run `npx prisma generate` from the repo root** — it downloads
   `prisma@8` (rc), which has no `generate` command. Always
   `cd backend && npx prisma generate`.

## Background processes

The tool runner's background shell does not inherit nvm's `PATH`, so
`make …` fails there with `npm: No such file or directory`. Run `make` from a
normal shell, or export `PATH` first.
