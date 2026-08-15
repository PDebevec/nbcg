# Infrastructure CLI

Bootstraps and manages a development or production environment for this project:
a frontend, a backend, and the Docker services they depend on (PostgreSQL,
Keycloak, Redis, OpenSearch, SeaweedFS, pgAdmin, pgsync). In development the
frontend and backend run on the host under pm2 rather than in containers.

Everything is driven by one step registry ([`scripts/lib/steps.js`](scripts/lib/steps.js)),
which both entry points read — so a step behaves identically whether you run it
from the menus or from the shell.

## Requirements

`make check ENV=dev|prod` (see [`scripts/requirements.js`](scripts/requirements.js))
verifies everything the target environment actually needs. What it checks is
derived from `master.config.json`, so it tracks your configuration rather than a
hardcoded list:

| Checked | Source |
|---|---|
| `node`, `npm`, `docker` + daemon + compose plugin | always |
| `pm2` | dev only — dev runs the apps as pm2 processes on the host |
| `openssl` | prod only — the `certs` step shells out to it |
| DNS resolution of every hostname | `available_hostnames` |
| Availability of every published port | dev: the `external` port of every `ports` entry. prod: only `prod_published_ports` (80/443) — everything else is reached inside the compose network, so checking it would report twenty irrelevant conflicts and miss the two that matter |
| `master.config.json` matches the template | see below |

A port already published by **this project's own containers** counts as
available, not as a conflict — otherwise every check run while the stack is up
would report each published port as taken. Only a foreign process holding a port
fails the check.

`make` is not checked: nothing in this CLI invokes it: it belongs to the legacy
Makefile flow.

## Running

Everything is driven from the **root `Makefile`**, so you never have to change
directory first. `make help` lists the targets.

Interactive menus:

```sh
make cli
```

Non-interactive, one command at a time — this is the path to use when a step
fails and you want to re-run just that step and read the error:

```sh
make list                          # every runnable step and action, with status
make check ENV=dev                 # prerequisites only
make setup ENV=dev                 # the whole pipeline for an environment
make step STEP=config ENV=dev      # a single step
make step STEP=fbEnd FLAGS=--force # ignore unmet dependencies
make step STEP=env ENV=prod FLAGS=--rotate   # force new prod secrets
make up SVC="db redis"             # shortcut for a docker action
make docker A=logs SVC=keycloak    # any docker action, optionally per service
make migrate                       # apply database migrations
make health                        # per-service state + health
make app A=start T=backend         # pm2 actions for frontend/backend
make clear T=list                  # what generated artifacts exist
make clear T=templates             # remove one category
make clear T=state FLAGS=--yes     # destructive targets need --yes
make config A=diff                 # master.config.json vs the template
make config A=merge                # add settings the template gained
```

The Makefile targets are thin calls into the npm scripts in
[`package.json`](package.json), which are themselves aliases for
[`scripts/run.js`](scripts/run.js). Both lower layers stay usable directly —
`npm run step -- config dev` from this directory, or
`node scripts/run.js step config dev` — which is occasionally handy when make's
variable syntax gets in the way.

`make` also installs this directory's `node_modules` on first use. Commands exit
non-zero on failure. Argument mistakes print a one-line message; a step that
genuinely fails prints its stack.

The legacy `scripts/*.sh` flow is no longer wired into the Makefile. Those
scripts are still on disk and still runnable by hand; the CLI supersedes them.
`make cron-backup` / `make cron-restore` are the exception and still call
`backup.sh` / `restore.sh`, which have no CLI equivalent.

## Setup pipeline

| Key | Step | Takes `<env>` | Depends on |
|---|---|---|---|
| `env` | Compose root `.env` from `.env.shared` + `.env.<env>` (+ generated secrets in prod) | yes | — |
| `config` | Merge `master.config.json` ports + allowed hostnames into root `.env` | yes | `env` |
| `fbEnd` | Write a `.env` for every `env_routing` target | no | `config` |
| `applyConf` | Render `conf_templates` against the root `.env` | no | `config` |
| `certs` | Generate self-signed nginx certificates (**prod only**) | no | `config` |
| `dockerFilesCopied` | Copy the compose files into the repo root | yes | `fbEnd`, `applyConf` (+ `certs` in prod) |

`fbEnd`, `applyConf` and `certs` are peers — each needs only the finished root
`.env`, and none consumes another's output. Re-running a step marks everything
that transitively depends on it as not-done, so it will not falsely invalidate
its siblings.

Step numbers shown in the UI are derived from position, so the sequence stays
contiguous in dev even though `certs` is skipped.

## Production

Dev and prod are genuinely different shapes, not the same stack with different
values. In dev the frontend and backend run on the host under pm2 and every
service publishes a port. In prod both apps are containers, nginx is the only
thing published, and everything else is reachable only from inside the network.

```
                    ┌──────── frontend network (bridge, has egress) ────────┐
  :80  :443 ────────┤  nginx ── frontend (static SPA)                        │
                    │    │      backend ──────────────┐                      │
                    └────┼───────────────────────────┬┼──────────────────────┘
                         │                           ││
                    ┌────┴───── backend network (internal: true, NO egress) ─┴──┐
                    │  keycloak   db   keycloak-db   redis   opensearch-node    │
                    │  pgsync     pgadmin   dashboards   seaweedfs (master…)    │
                    └───────────────────────────────────────────────────────────┘
```

Routing is by path on a single origin, which is what the application already
assumes — `frontend/src/boot/axios.ts` uses a relative `baseURL` of `/api`, and
the router is in hash mode. Same origin also means CORS is belt-and-braces in
prod rather than load-bearing.

| Path | Goes to |
|---|---|
| `/` | the `frontend` container's nginx, serving `dist/spa` |
| `/api/` | `backend:3000` — the prefix is **not** stripped, because the backend sets `setGlobalPrefix('api')` |
| `/auth/` | `keycloak:8080` — Keycloak serves itself under that path via `KC_HTTP_RELATIVE_PATH` |
| `/pgadmin/`, `/dashboards/` | **provisional**, behind HTTP basic auth — see Known gaps |

### Dev and prod do not share state

The dev compose file sets its own project name (`name: dev-nbcg`), so its
containers, networks and volumes are namespaced separately from prod's `nbcg_*`.

This matters more than it looks. Without it both environments share
`nbcg_postgres-data` and `nbcg_keycloak-data`, and Postgres only applies
`POSTGRES_PASSWORD` when it initialises an **empty** data directory — so
switching dev → prod on one machine hands the generated production password to a
database that was created with the development one. It surfaces as
`password authentication failed for user "nbcg"` from Keycloak, which looks like
a secrets bug and is not one.

The consequence to know about: `make up ENV=prod` on a machine that has been
running dev starts with **empty** databases, not dev's data.

The same underlying fact — Postgres only applies `POSTGRES_PASSWORD` on an
empty data directory — also shows up *within* prod alone, whenever secrets are
regenerated against a volume that already exists. `make up` reconciles that
automatically now; see "Bringing it up" below.

### Bringing it up

```sh
make setup ENV=prod     # includes certs, opensearch.yml and the image builds
make up
make health
```

One `up` is genuinely enough — it self-heals everything below on its own,
however many times you run it and however far behind the running containers
are:

- **Postgres (`db`, `keycloak-db`) and OpenSearch's security config get
  reconciled with the current `.env` on every prod `up`**, unconditionally
  (see [`lib/reconcile-utils.js`](scripts/lib/reconcile-utils.js)). Both
  operations are idempotent, so this costs a few seconds even when nothing
  was stale.
- **Whatever that leaves — or finds — unhealthy gets restarted automatically**,
  covering both directions this used to require a second `make up` for: a
  service that crash-looped on a since-fixed password (keycloak), and, on a
  first-ever prod boot, pgsync/Dashboards, which start before their OpenSearch
  accounts exist and so crash-loop regardless of any password ever being
  stale.
- **If `up` itself exits non-zero** — a dependent service failing its own
  healthcheck over exactly this can make the whole compose command fail —
  the same reconcile-and-restart runs first, then `up` is retried once before
  the error is allowed to surface for real.

The result: `up` cannot leave the stack running on credentials that don't
match `.env`, no matter what state it started from — a first boot, a restart,
or a boot after `make step STEP=env ENV=prod FLAGS=--rotate`.

One ordering fact still worth knowing: **`docker compose restart` does not
re-read configuration.** After changing anything in `.env` or a compose file,
use `up -d --force-recreate <service>` (or the menu's "Start (up)", which
does this for you); a plain restart keeps the old environment and the change
appears to have had no effect.

### Certificates

The `certs` step creates a private **CA** and issues leaf certificates from it
([`lib/cert-utils.js`](scripts/lib/cert-utils.js)):

| File | For | Valid for |
|---|---|---|
| `docker/certs/ca/ca.crt` | the trust anchor everything else chains to | — |
| `docker/certs/nginx/server.*` | TLS termination | every `available_hostname`, plus localhost |
| `docker/certs/opensearch/node.*` | the cluster's transport + HTTP TLS | `opensearch-node` |
| `docker/certs/opensearch/admin.*` | a **client** certificate, for administering the cluster | — |

- The **CA is reused, never regenerated** — every leaf and every trust store
  chains to it, so replacing it invalidates all of them at once. Leaves are
  reissued automatically when `available_hostnames` or the subject changes.
- Leaves carry **subject alternative names**. The certificates this replaced had
  only a CN, which every current TLS client ignores — they would have been
  rejected regardless of anything else.
- Keys are PKCS#8 (`openssl genpkey`, not `genrsa`): OpenSearch's security
  plugin accepts nothing else.
- Subject fields live in `master.config.json` under `certificates`. The
  OpenSearch admin/node DNs are **derived** from them rather than written
  anywhere, because a DN that disagrees with the issued certificate does not
  fail loudly — it just locks the admin out.

**Using a real certificate**: set `certificates.nginx_external: true` in
`master.config.json` **first**, then drop the authority's `fullchain.pem` and
`privkey.pem` into `docker/certs/nginx/` as `server.crt`/`server.key`. Nothing
else changes — the topology already assumes certificates that verify.

**Leave `NODE_EXTRA_CA_CERTS` set on the backend service**, even with a real
nginx certificate. It is not there for nginx — OpenSearch's node and admin
certificates are *always* self-signed by this project's own CA, regardless of
`nginx_external`. Unsetting it would not change how nginx is trusted; it would
only break the backend's TLS connection to OpenSearch.

The flag matters: without it, the next time the `certs` step runs (a new
hostname, a full re-setup) it has no way to know `server.crt` isn't one of its
own and will silently reissue and overwrite it with a self-signed one. With
the flag set, the step instead verifies the two files exist and leaves them
alone — and fails loudly, naming the expected paths, if they're missing.

### How the backend reaches Keycloak

This is the part that is easy to get wrong, and it fails as "every token is
rejected" rather than as anything that looks like a configuration problem.

The backend validates tokens against `${KEYCLOAK_URL}` — both the `issuer` it
checks and the `jwksUri` it fetches
([`backend/src/core/auth/keycloak.strategy.ts`](../backend/src/core/auth/keycloak.strategy.ts)).
In prod that is the **public** HTTPS URL, which a container on an internal
network can neither resolve nor trust.

So nginx is given a **network alias equal to `PUBLIC_HOSTNAME`**, and the CA is
mounted into the backend as `NODE_EXTRA_CA_CERTS`. The backend then resolves the
public URL to nginx *inside* the network and trusts the certificate, so the
issuer and the JWKS endpoint stay the same URL a browser uses — with no change
to the application. This is split-horizon DNS, and it behaves identically once a
real certificate replaces the CA.

`NODE_EXTRA_CA_CERTS` is read by Node for both `https` and `undici`, so it also
covers the OpenSearch client with no further configuration.

> **The canonical hostname cannot be `localhost` in prod.** Every container
> resolves loopback names to *itself* through `/etc/hosts`, and no network alias
> overrides that — so the backend would never reach nginx, and every token would
> be rejected with nothing but `fetch failed` to go on. The `config` step
> refuses to generate a prod environment whose first `available_hostname` is
> `localhost`, `127.0.0.1` or `::1`. For local testing any real name works; add
> it to the host's `/etc/hosts` pointing at `127.0.0.1`.

### OpenSearch security

Prod runs the security plugin (dev disables it), so the cluster speaks HTTPS and
refuses anonymous requests. Configuration is split in two because the halves can
only run at different times:

1. **`osSecurity` step**, before the stack starts — writes `opensearch.yml`
   (TLS paths, admin/node DNs). It has to exist on disk first, or docker creates
   a directory in its place.
2. **`configureSecurity()`**, after the cluster is up — hashes the passwords
   with the cluster's own `hash.sh`, creates the application role and users,
   and **removes the demo accounts the image ships**. It authenticates with
   the admin *certificate*, so it works on a cluster whose credentials are
   still the defaults — which is also why it is always safe to re-run: it
   never depends on what the current credentials happen to be.

Step 2 is required, not optional: the image's `internal_users.yml` contains
accounts whose bcrypt hashes are published in the OpenSearch repository, and
`admin` is marked `reserved`, which means the REST API refuses to change it —
only `securityadmin` can. Between first boot and this step those accounts exist,
on a network that is `internal: true` and publishes no port. It is no longer
something you run yourself, though — `make up` calls it automatically every
time (see "Bringing it up" above), so it is covered whether this is a first
boot or the tenth.

Whether it has run is tracked in `.cli-state.json` (`steps.osSecured`) —
`up` keeps it current automatically now, but the manual `make docker
A=os-secure` action (and the Docker menu's "Configure OpenSearch security"
entry, which shows "already configured" once it has) are both still there if
you want to run just this without a full `up`.

| Account | Used by |
|---|---|
| `admin` | administration; `OPENSEARCH_INITIAL_ADMIN_PASSWORD` |
| `nbcg_app` | the backend and pgsync, limited to `records*`/`drafts*` |
| `kibanaserver` | Dashboards' own connection to the cluster |

The backend needs no OpenSearch-specific code for this: credentials ride in
`OPENSEARCH_URL` (the client reads `url.username`/`url.password`) and trust comes
from `NODE_EXTRA_CA_CERTS`. pgsync uses the discrete `ELASTICSEARCH_SCHEME` /
`HOST` / `USER` / `PASSWORD` / `CA_CERTS` variables rather than
`ELASTICSEARCH_URL`, because that one short-circuits pgsync's URL builder and
leaves no way to pass `verify_certs` or `ca_certs`.

### Migrations in prod

The backend container applies them itself on every start — its `start:prod` is
`prisma migrate deploy && node dist/src/main.js`. `make migrate` still works and
runs the same command inside the running container, for applying one without a
restart. `pgsync` waits on the backend being healthy for exactly this reason:
it needs the tables to exist.

### The frontend image is environment-specific

Quasar inlines every `import.meta.env.VITE_*` value at build time, reading
`frontend/.env` itself. Changing `available_hostnames` therefore needs a
**rebuild**, not a restart — which is why the `appImages` step depends on
`fbEnd`, so re-running `fbEnd` marks the images stale.

## Menus

All menus share one framework (`runMenu` / `runAction` in
[`lib/cli-util.js`](scripts/lib/cli-util.js)), so they behave the same:

- **Entries are never hidden**, only disabled with the reason shown — so you can
  always see what exists and what it is waiting on.
- **Every action reports its outcome** in a banner that survives the redraw:
  `✓` succeeded, `✗` failed, `–` ran but there was nothing to do, each with its
  duration. Failures pause so the error stays on screen.
- A status line in the header card shows the live state relevant to that menu.

Menus:

- **Start Setup** — checks prerequisites, then offers **Run all remaining steps**
  (which names exactly the steps it will run) above the individual steps. Each
  step shows `done` / `ready` / `stale`, and steps whose dependencies are unmet
  are disabled with `needs: …`. `stale` means it ran before but something it
  depends on has since been cleared or re-run.
- **Docker Menu** — up / stop / restart / create / build / pull / logs / status /
  down / down -v, each targetable at all services or one, plus migrate and health
  checks. Container actions are disabled while the compose files are missing;
  stop/restart/logs while nothing is running. Status line shows
  `N services · N running · N stopped · N healthy`.
- **App Menu** — pm2 setup/start/stop/restart/logs/list for frontend and backend.
  Start only offers apps that are set up and not already running; stop/restart/
  logs only offer running ones. Dev only.
- **Clear Environment** — each entry is disabled when it has nothing to do,
  shows how many files it owns, and reports the paths it removed. Destructive
  entries (volumes, CLI state, master.config) each carry their own confirmation
  wording.

`Ctrl+C` while following logs ends the log stream and returns to the menu rather
than killing the CLI (a second `Ctrl+C` force-kills the child). `Ctrl+C` at a
menu exits the CLI cleanly.

## State

`infrastructure/.cli-state.json` (gitignored) persists:

- `environment` — `"dev"` or `"prod"`
- `steps` — per-step completion flags, which gate menu visibility
- `docker` — `initialized` (compose files copied) and `containarized` (containers up)
- `apps` — per-app one-off setup completion
- `history` — the last 50 step outcomes

`make clear T=state --yes` resets it. **Reset, not delete**: `StateManager` is a
module-level singleton loaded at import, so deleting the file mid-process would
be undone by the next `save()` writing the old in-memory data straight back.

The reset keeps one field — `environment`. Everything else is progress that can
be regenerated, but the target environment is a choice: losing it would make the
next `make migrate` or `make setup` silently fall back to `dev`.

`ENV=dev make cli` seeds the environment on first run only; the state file is
otherwise the authority.

## master.config.json

Created automatically from `master.config.template.json` on first read, and
gitignored — edit the copy for machine-specific values.

Because it is only created when **absent**, a config written by an earlier
version keeps its old values and silently lacks any setting the template has
gained since — a step then quietly does nothing. `make check` reports that
drift, `make config A=diff` lists it in both directions (missing settings
and ones the template no longer defines), and `make config A=merge` fills in
what is missing without touching or deleting anything you have edited.

Drift detection covers objects **and arrays** — a template that gains a secret
or a rendered config file is reported and merged, not silently ignored.
`available_hostnames` is the one array exempt from this: its template entries
("localhost", "127.0.0.1") are illustrative starting values, and trimming them
for a real deployment is expected editing, not drift — so `make check` never
blocks Setup over it. The key itself is still checked: a config missing
`available_hostnames` entirely (a very old checkout) is still reported.

A merge only ever **adds**. It cannot change a value the template changed, nor
restore an ordering, nor remove anything. When the template alters an existing
value — as it did for `env_routing.backend.vars.OPENSEARCH_URL` — a merge will
report nothing and do nothing, and you want a reset instead.

`make clear T=config --yes` throws the file away and recreates it from the
template. It is described as a **reset** rather than a removal because
`ensureMasterConfig()` recreates it on the next read anyway — "absent" is not a
state this CLI can be in.

- **`available_hostnames`** — the single place hostnames are configured. The
  **first entry is canonical**: everything single-valued uses it, everything
  list-valued uses all of them. Put the host you actually browse to first.

  | Derived | From |
  |---|---|
  | `ALLOWED_HOSTNAMES` | all, comma separated |
  | `CORS_ORIGIN` (backend splits on commas) | all, as origins |
  | `KEYCLOAK_URL` (frontend + backend + `KC_HOSTNAME`) | the canonical one |
  | the realm's `nbcg-web` `redirectUris` / `webOrigins` | all, as origins |

  An origin is `http://<host>:${FRONTEND_PORT}` in dev and `https://<host>` in
  prod, where nginx terminates TLS on 443.

  Getting these four out of step is what makes Keycloak fail in ways that look
  like a frontend bug — `KEYCLOAK_URL` is the token *issuer* as well as the
  address the browser is redirected to, so the frontend, the backend and the
  realm must all agree on it. Adding a host here is now the whole change.

  `CORS_ORIGIN` and `KEYCLOAK_URL` are **derived unless pinned**: set either in
  `env/.env.<env>` and that value wins. The check reads the source `.env` files,
  not the generated root `.env`, so a derived value never mistakes itself for a
  manual override on the next run. `KEYCLOAK_BASE_PATH` (prod, default empty)
  covers nginx serving Keycloak under a path such as `/auth`.
- **`ports`** — `{ internal, external }` per service, emitted in **three** forms:

  | Variable | Value | Use for |
  |---|---|---|
  | `X` | host port in dev, container port in prod | app config that must work in both |
  | `X_INTERNAL` | always the container port | in-network addresses between containers |
  | `X_EXTERNAL` | always the host port | published/host addresses |

  All three exist in both environments. The unqualified name follows where the
  apps run (on the host in dev, inside the network in prod), which is why a
  container-to-container reference such as `KC_DB_URL` must use `_INTERNAL`
  explicitly — using the plain name there silently picked up dev's host port.
- **`secrets_to_generate`** — variables filled with random secrets in prod.
  They are **persisted** in `infrastructure/.secrets.prod.json` (gitignored,
  mode 600) and reused on every subsequent run; only missing ones are
  generated. `make step STEP=env ENV=prod FLAGS=--rotate` forces a fresh set,
  and warns that existing volumes still hold the old one — that warning is
  informational, not a to-do: `make docker A=up` (see below) reconciles it
  automatically.

  The store is a separate file rather than the root `.env` for a specific
  reason: the root `.env` belongs to whichever environment ran last, so
  generating a dev environment in between used to wipe every prod secret, and
  the next prod run would mint new ones while the volumes still held the old.
  That breaks Postgres, Keycloak and OpenSearch authentication simultaneously,
  and looks like nothing in particular. Deleting the store
  (`make clear T=secrets --yes`) is only correct alongside clearing the volumes
  that were initialised from it.

  Generated secrets are restricted to punctuation that is safe **inside a URL's
  userinfo component**, because they are interpolated straight into connection
  strings such as `DATABASE_URL`. That excludes more than it looks like: `@`
  ends the userinfo, `%` starts a percent-escape, `:` ends the username, `$` is
  interpolated by docker compose when it reads the `.env`, and `+` is decoded as
  a space by some parsers. At least one upper, lower, digit and special
  character is guaranteed — OpenSearch enforces a password policy and rejects
  anything weaker.

  The first character is always alphanumeric. Several images turn environment
  variables into command-line flags — Dashboards passes `OPENSEARCH_PASSWORD`
  through as `--opensearch.password` — and a value beginning with `-` is then
  parsed as the next flag instead of as the value.
- **`conf_templates`** — `{ template, output }` pairs (paths relative to
  `infrastructure/`) rendered by the `applyConf` step. These outputs are
  bind-mounted by compose; without them Docker creates *directories* at the
  mount points and the affected services come up misconfigured.
- **`env_routing`** — one entry per app, each `{ path, vars }`. `path` may be
  relative to the repo root or absolute, so a target can live outside this
  repository; a target whose directory does not exist is skipped with a warning.
- **`apps`** — `setup` and `run` commands for the pm2-managed frontend/backend.

### Placeholder syntax

Deliberately different in the two places, because they have different needs:

- `env_routing` values use **`${VAR}`**, resolved against the root `.env`. An
  unknown variable is left in place as a literal `${VAR}` so mistakes are visible
  rather than silently becoming empty.
- `conf_templates` substitute **`$(VAR)` only**, and leave `${...}` untouched —
  Keycloak realm exports contain Keycloak's own `${role_impersonation}` /
  `${authBaseUrl}` placeholders that must reach Keycloak verbatim. A `$(VAR)`
  with no value in the root `.env` fails the step.

  The realm's `nbcg-web` client takes its `redirectUris` / `webOrigins` this way,
  as whole JSON array literals built with `JSON.stringify`. (`nbcg-api` is
  `bearerOnly` with the standard flow disabled, so it needs neither.)

> **Keycloak imports a realm once.** `--import-realm` skips a realm that already
> exists, so regenerating `nbcg-realm.json` changes nothing on an existing
> `keycloak-data` volume. Clear that volume, or set
> `KC_IMPORT_STRATEGY=OVERWRITE_EXISTING`, for a new redirect URI to take effect.

## Migrations and health checks

Both live in [`scripts/lib/db-utils.js`](scripts/lib/db-utils.js).

**Migrate** follows `scripts/migrate.sh` for dev: it checks that the `db`
container is running (failing immediately if not, rather than polling a
container that does not exist), waits for `pg_isready` to accept connections,
then runs `prisma migrate deploy` in `backend/`. It reports how many migrations
were applied, or `already up to date` as an explicit no-op. Preflight checks
point at the step to run when `backend/.env` or Prisma itself is missing.

**Health checks** read `docker compose ps` and print each service's state and
health, using the healthchecks already declared in the compose files, then
summarise as `N/N running · N healthy · …`.

## Known gaps

- **No real domain or certificates yet.** `available_hostnames` is still
  `localhost` / `127.0.0.1` and the CA is our own. Both are one setting and one
  file swap away — see Certificates above — but nothing has been exercised
  against a public name.
- **Admin-UI routing is provisional.** `/pgadmin/` and `/dashboards/` are behind
  HTTP basic auth over TLS, which is the security-relevant part, but serving
  either correctly under a subpath needs more of their own configuration than is
  there now (pgAdmin rebuilds URLs from `X-Script-Name`; Dashboards needs
  `server.basePath` to agree with nginx). Expect broken links inside them until
  that is finished.
- **Keycloak's `resetPasswordAllowed` is on, but `smtpServer` is `{}`** — the
  password-reset flow will fail at the point of sending mail. Configure SMTP in
  the realm or turn the feature off.
- **SeaweedFS `filer`, `s3` and `webdav` may be unused.** The backend talks only
  to `master` and `volume`
  ([`seaweedfs.service.ts`](../backend/src/core/seaweedfs/seaweedfs.service.ts)),
  and `SEAWEEDFS_S3_SECRET` is generated but read by nothing. `filer` now has a
  volume so its metadata survives a recreate; dropping the three services
  outright is worth considering instead.
- **The backend logs every query** (`log: ['query', …]` in
  [`prisma.service.ts`](../backend/src/core/prisma/prisma.service.ts)), which is
  very noisy for production.
- **Volumes are plain docker volumes.** `config.template.yml` describes a ZFS
  dataset (`zfs.base`) for prod data; nothing implements that yet.
- **Backups are untouched.** `scripts/backup.sh` still names volumes that do not
  exist (`minio_data`, `postgres_data` — the real ones are `nbcg_postgres-data`
  and friends) and uses an unset `COMPOSE_FILE`, so it cannot currently run.
