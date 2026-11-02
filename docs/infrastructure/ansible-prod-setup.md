# NBCG — Production deployment blueprint for Ansible

**Purpose.** This document records every decision, file, and change needed to deploy and operate the NBCG production stack with **Ansible** instead of hand-entering commands on the remote server. It is written so that a new operator can read it and perform a full, correct production deployment, a rebuild after a server crash, or a disaster recovery — without depending on tribal knowledge.

**Authoritative references.**

- Production compose definition: `infrastructure/docker/docker-compose.yml` + `infrastructure/docker/docker-compose.prod.yml`
- Environment config: `infrastructure/env/` (`.env.shared`, `.env.dev`, `.env.prod`)
- Static configuration: `infrastructure/master.config.json` (+ `master.config.template.json`)
- Rendered templates: `infrastructure/docker/nginx/nginx.conf.template`, `infrastructure/docker/nginx/htpasswd.template`, `infrastructure/docker/keycloak/nbcg-realm.conf.json`
- The stateful setup CLI: `infrastructure/cli.js`, `infrastructure/scripts/`, `infrastructure/scripts/lib/steps.js` (current local dev machinery — **not** the prod deployment path)
- Backups: `infrastructure/scripts/backup.sh`, `infrastructure/scripts/restore.sh` (RESTIC-based; kept as-is)
- This file: `docs/infrastructure/ansible-prod-setup.md`

---

## 1. Architecture at a glance

Two genuinely different shapes live in one repo, driven by environment.

**Dev** — the apps (`frontend`, `backend`) run **on the host** under pm2 (port 3000 is intentionally *not* published to Docker, see `dev_unpublished_ports`). Every service publishes its port to the host. Services are reachable by `localhost:<port>`. Self-signed certs from an internal project CA are fine.

**Prod** — both apps are **containerized**, nginx is the *only* thing published to the host (ports 80/443), everything else is on internal Docker networks, and TLS terminates at nginx. The public domain is `nbcg.me`.

| Service | Dev | Prod | Image | Notes |
|---|---|---|---|---|
| db (Postgres) | yes | yes | `postgres:18.3` | `wal_level=logical` |
| keycloak-db (Postgres) | yes | yes | `postgres:18.3` | Keycloak's own DB |
| redis | yes | yes | `valkey/valkey:9.2` | Replaced `redis:8.6.1` (AGPL/RSAL/SSPL); see `docs/shared/license-audit.md` |
| pgadmin | yes | yes | `dpage/pgadmin4:9.12.0` | Internal only, via `/pgadmin/` |
| keycloak | yes | yes | `quay.io/keycloak/keycloak:26.5.4` | Realm imported from `nbcg-realm.json` |
| pgsync | yes | yes | `toluaina1/pgsync@sha256:3dad547f...` | **Pinned by digest**, not tag |
| opensearch-node | yes (no TLS) | yes (TLS on) | `opensearchproject/opensearch:3.5.0` | Heap 512m, `mem_limit: 1500m` |
| opensearch-dashboards | yes | yes | `opensearchproject/opensearch-dashboards:3.5.0` | `DISABLE_SECURITY_DASHBOARDS_PLUGIN: true` |
| seaweedfs master | yes | yes | `chrislusf/seaweedfs:4.23` | Only master+volume; S3/webdav not used |
| seaweedfs volume | yes | yes | `chrislusf/seaweedfs:4.23` | |
| frontend | host (pm2) | container | build from `./frontend` | Quasar; VITE_* baked at build time |
| backend | host (pm2) | container | build from `./backend` | NestJS; Prisma migrations on start |
| nginx | — | container | `nginx:1.29.5-perl` | Route: `/`, `/api/`, `/auth/`, `/pgadmin/`, `/dashboards/` |

Volumes that hold **non-reproducible data** (must be backed up / preserved across deploys):

`postgres-data`, `keycloak-data`, `pgadmin-data`, `opensearch-data`, `redis-data`, `seaweedfs-data`.

**Network topology (prod).** nginx sits on three networks: `frontend` (bridge, egress), `backend` (internal, no egress), and `auth` (internal, no egress). `auth` contains **only** `nginx`, `keycloak`, `keycloak-db`. Keycloak trusts `X-Forwarded-Host` to resolve its own hostname per request (`KC_HOSTNAME_STRICT: false`, `KC_PROXY_HEADERS: xforwarded`, `KC_HTTP_RELATIVE_PATH: /auth`) — this is safe **only** because nginx's catch-all `server_name _; return 444;` rejects any Host header not in `available_hostnames` before it reaches Keycloak. Do not remove that block.

**Ingress routes.**

| Path | Upstream |
|---|---|
| `/` | `frontend` container nginx (serves `dist/spa`) |
| `/api/` | `backend:3000` (prefix **not** stripped — backend has `setGlobalPrefix('api')`) |
| `/auth/` | `keycloak:8080` (Keycloak serves itself under `/auth`) |
| `/pgadmin/` | `pgadmin:80` — behind HTTP basic auth, provisional |
| `/dashboards/` | `opensearch-dashboards:5601` — behind HTTP basic auth |

---

## 2. What must change for Ansible-based deployment

The current `infrastructure/` CLI is a **local dev machine orchestration tool** (stateful fingerprinting, pm2 host processes, internal CA, per-env `.env`). It is deliberately **not** the prod deployment path. The following sections describe the concrete changes.

### 2.1 The setup process

**Remove from the prod path** (things that belong to a local laptop, not a bare remote server):

- `node`, `npm`, `pm2` on the host — dev only.
- The fingerprinted step registry (`.cli-state.json`) — no drift detection or audit trail on a rebuilt server.
- Building `frontend`/`backend` images on the prod host (needs Node/npm on the server).
- Interactive menus (`make cli`) — replace with a non-interactive playbook.
- OS hardening steps written ad-hoc (`osSecurity` writes `opensearch.yml` via openssl) — replace with Ansible tasks.
- **Stray gitignore entries:** root `.gitignore` references a `config.yml` that does not exist (only `config.template.yml` exists) — the Ansible entry point `ansible/playbooks/main.yml` takes its place.

**Move to Ansible (the new prod path):**

1. **Provisioning**: install Docker + compose plugin, create the app user, configure firewall/SSH, enable/disable swap as needed, set kernel params (OpenSearch needs `memlock` unlimited, `nofile` 65536 — currently `ulimits` in compose; keep those, and add host-level equivalents if you cap them).
2. **Configuration**: render the root `.env` from encrypted variables (ansible-vault or a secrets manager), merge `master.config.json`, generate app `.env` files.
3. **Images**: **build in CI, push to a registry, pull on the server**. No build on the prod host.
4. **Apply**: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` (read the compose files from the repo, not generated copies).
5. **Post-deploy** (run once, idempotently): apply Prisma migrations, configure OpenSearch security (`securityadmin`), import the Keycloak realm.

**Idempotency principle.** Every Ansible task must be re-runnable without side effects. Rebuilding the `.env` from the same variables must produce byte-identical output. A failed playbook run must leave the server in a known state, not half-applied.

### 2.2 Secrets and passwords — the biggest change

**Current state (must change):**

- Secrets are generated by the CLI on the local machine and stored in `infrastructure/.secrets.prod.json` (mode 0600, gitignored) — then shipped to the server by hand.
- The root `.env` contains **hardcoded plaintext passwords** (`POSTGRES_PASSWORD=nbcg`, `KEYCLOAK_ADMIN_PASSWORD=nbcg`, `OPENSEARCH_INITIAL_ADMIN_PASSWORD=VelikiPassword1!`, etc.) — on a remote server these would be copied into place and could be committed.
- `KEYCLOAK_WORKER_CLIENT_SECRET` was added to `secrets_to_generate` and routed to the backend in a later fix; confirm it is still present (`master.config.json` has 9 entries now) and that a value from vault actually reaches the Keycloak realm client (`nbcg-worker`).

**New design:**

1. **All secrets live in Ansible vault** (`infrastructure/group_vars/vault.yml` or individual `.vault` files). No plaintext secrets in the repo. Vault is encrypted with a public key / keyfile that only deployment operators hold.
2. **Derive, never hardcode, every value used by a container.** For production: do not pick static passwords. Generate them from the vault (a master seed + env fingerprint → deterministic secret, or a high-entropy random value written to vault). The deterministic approach gives the same password on rebuild, which is required so Postgres/Keycloak/OpenSearch volumes keep authenticating.
3. **No per-container random passwords.** When a service's DB password must persist across restarts, it comes from the vault, not from the image's init script. Postgres only applies `POSTGRES_PASSWORD` on an **empty** data directory — a rebuild that re-mints the password would lock you out of `postgres-data`.
4. **Vault file layout:**

```
infrastructure/
  vault/
    vault.yml                    # master seed / determinism config
    secrets.yml                  # POSTGRES_PASSWORD, KEYCLOAK_POSTGRES_PASSWORD,
                                  # KEYCLOAK_ADMIN_PASSWORD, PGADMIN_DEFAULT_PASSWORD,
                                  # OPENSEARCH_INITIAL_ADMIN_PASSWORD, OPENSEARCH_APP_PASSWORD,
                                  # OPENSEARCH_DASHBOARDS_PASSWORD, ADMIN_UI_PASSWORD,
                                  # KEYCLOAK_WORKER_CLIENT_SECRET, COBISS_TOKEN
    restic.yml                   # RESTIC_PASSWORD (also needed for backups)
```

5. **`.secrets.prod.json` is retired.** The Ansible playbook writes the root `.env` and app envs directly from vault variables, rendering the interpolation (`${...}`) itself. There is no intermediate secrets file; nothing gitignored on the server needs to be recovered separately.
6. **RESTIC_PASSWORD** — the backup scripts read it from `.env.prod` or the environment. Keep this (backups must be able to run without Ansible, e.g. from cron). Put it in vault (as `nbcg_restic_password`) and have the playbook inject it into `infrastructure/env/.env.prod`.
7. **COBISS_TOKEN** — an external API credential the backend passes straight into request URLs. It is empty by default in `.env.shared`; a value must be provided separately (not in this repo) and injected into `.env.prod` from a secrets store.

**Migration task:** audit every `PASSWORD`, `SECRET`, `TOKEN`, `KEY` across `.env.*`, `master.config.json`, compose files, and the app code. Anything not in vault yet is a finding.

### 2.3 Docker and images

**Current state:** prod `docker-compose.prod.yml` has `build: ./frontend` and `build: ./backend`. The local CLI builds these images on the host during `appImages`.

**New design:**

1. **CI builds both images and pushes them** (GitHub Actions, or the NPR's existing CI):

```
frontend: ghcr.io/nbcg/frontend:<sha>  (tag: <branch>-<short-sha>, latest on main)
backend:  ghcr.io/nbcg/backend:<sha>
```

    The backend build runs `npm ci`, `prisma generate`, then `npm run build`. The frontend build runs `npm ci` + Quasar build. Both produce a digest; **deploy by digest** (`@sha256:...`) so the running image is always reproducible and the rollback image is pinned.
2. **The prod host only pulls.** `docker compose` pulls the tagged/digested images. Node/npm must **not** be installed on the server.
3. **Remove `build:` from the prod compose file.** Keep `build:` only for local dev convenience (dev doesn't use it — dev runs apps on the host via pm2).
4. **Pin everything.** OpenSearch/SeaweedFS/Keycloak already use pinned tags or digests; extend this to every image. Add a `versions.md` table listing every image name+digest used by prod and its vendor link.
5. **Cache strategy:** for dev, the local build cache is fine; for prod, the registry is the cache. No host-side layer cache.

**Migration task:** add a `.github/workflows/build.yml` that builds, tests, and pushes both images; update `docker-compose.prod.yml` to `image: ghcr.io/nbcg/backend:<digest>` and `frontend:<digest>` instead of `build:`.

### 2.4 TLS and certificates

**Current state:** the `certs` step generates a private project CA (`infrastructure/docker/certs/ca/ca.key`), then issues nginx + OpenSearch leaves from it. The backend trusts the CA via `NODE_EXTRA_CA_CERTS`. This is **wrong for a public site**: public clients cannot be expected to trust an internal CA; browser access to `https://nbcg.me` would fail, and the internal CA key is a single point of compromise that must be backed up and is currently committed to the server.

**New design:**

1. **Public certificate authority for nginx** (TLS termination): use **Let's Encrypt via certbot** on the host (or via a reverse proxy like Caddy/Traefik with auto-renewal). This removes the entire internal-CA/leaf-nginx workflow for ingress:
    - Certbot obtains `nbcg.me` (+ optional `www.nbcg.me`, `api.nbcg.me`, `auth.nbcg.me`, `search.nbcg.me`) and writes certs to `/etc/letsencrypt/live/nbcg.me/`.
    - Point nginx at those certs: either (a) symlink `infrastructure/docker/certs/nginx/server.crt` → `/etc/letsencrypt/live/nbcg.me/fullchain.pem` and `server.key` → `privkey.pem` at deploy time, or (b) change `nginx.conf.template` (Ansible jinja2 render) to mount the `/etc/letsencrypt/...` paths directly.
    - Let's Encrypt renews automatically — keep `certbot renew` (or Caddy/Traefik auto-renew) running; the renewal hook should reload nginx.
    - Keycloak terminates nothing; it runs on `KC_HTTP_ENABLED: true` behind nginx over plain HTTP in-network — that does not change.
2. **Keep the internal CA only for OpenSearch.** OpenSearch's security plugin ships with TLS; its node/admin certificates **must** be issued by a CA the cluster trusts. The project CA stays here — it is internal only (cluster-to-cluster trust, not public). `NODE_EXTRA_CA_CERTS` on the backend stays set; pgsync's `ELASTICSEARCH_CA_CERTS` stays set.
3. **Where the certs live on the server (new layout):**

```
/etc/nbcg/
  nginx/
    fullchain.pem, privkey.pem          # Let's Encrypt (certbot manages these)
  certs/
    ca/ca.crt, ca/ca.key                # internal CA (backup this; it is the cluster trust root)
    opensearch/admin.crt, admin.key     # admin cert for securityadmin
    opensearch/node.crt, node.key       # node cert for the cluster
  opensearch.yml                        # generated by Ansible from master.config.json
```

4. **Retire `infrastructure/docker/certs/nginx/server.crt/.key`** and the `nginx_external` flag (`master.config.json` — currently `false`, a comment says set it to `true` when a real cert is placed at `docker/certs/nginx/server.crt + server.key`). Remove the `certs` step from prod; replace it with Ansible tasks: renew certbot, copy internal CA + OpenSearch certs to `/etc/nbcg`, reload nginx.
5. **Backup the CA private key** — it is the trust root for the whole cluster. The backup scripts already snapshot `docker/certs/` — after this change add `/etc/nbcg/certs/ca/ca.key` to the backup paths. See §7.

### 2.5 Other configurations

**`.env` derivation.** The CLI reads `master.config.json` and writes the root `.env` (`config` step: ports + hostnames; `fbEnd` step: frontend/backend envs). Ansible does the same:

- `infrastructure/env/.env.shared` — keys common to both environments (users, DB names, admin email, backend port).
- `infrastructure/env/.env.prod` — prod overrides: `POSTGRES_HOSTNAME=db`, `REDIS_HOSTNAME=redis`, `KEYCLOAK_BASE_PATH=/auth`, TLS hardening (`KEYCLOAK_SSL_REQUIRED=external`, `BRUTE_FORCE_PROTECTED=true`, `PASSWORD_POLICY=...`), `NODE_ENV=production`, `FRONTEND_PORT=443`.
- `master.config.json` stays the source of truth for hostnames (`available_hostnames`), ports (`ports`), allowed hostnames (`prod_published_ports: [HTTP_PORT, HTTPS_PORT]`), and the public URL derivation (`KEYCLOAK_URL` = `https://<first available_hostname>/auth`).

**`KEYCLOAK_URL` / issuers.** Keycloak's issuer and the backend's token-verifier issuer must be **the same URL a browser uses** (`https://nbcg.me/auth`). The first entry of `available_hostnames` is canonical (used to derive `KEYCLOAK_URL` and `ALLOWED_HOSTNAMES`). Add `nbcg.me` **first**, then `www.nbcg.me` if used, then any internal IPs. Do not put an IP first — then public login would issue tokens for an address users never typed.

**`available_hostnames` vs `PUBLIC_HOSTNAME`.** On the prod host there is no single "public hostname" variable — there is the `available_hostnames` list. Remove any reliance on a lone `PUBLIC_HOSTNAME` in the Ansible render; build every value from the list.

**Rendered config files** (currently produced by `applyConf`): `docker/nginx/nginx.conf`, `docker/nginx/htpasswd`, `docker/opensearch/opensearch.yml`, `docker/keycloak/nbcg-realm.json`, `docker/pgadmin/servers.json`. Ansible renders these the same way (`envsubst`/`jinja2` on the templates with the root `.env` as context), **on the server, from the repo** — do not commit rendered versions to git. The `.gitignore` under `infrastructure/` already lists them.

**`htpasswd`.** `ADMIN_UI_HTPASSWD` (from vault → `.env.prod`) generates a bcrypt row with `htpasswd -cbn`. The `admin_ui_password` entry in vault is the plaintext; render the bcrypt row with the `htpasswd` binary (install it during provisioning) or with Python's `bcrypt`. If you use Traefik/Caddy you can drop the htpasswd file and use their auth instead.

**pgAdmin / Dashboards subpath.** They are "provisional" per nginx comments: pgAdmin needs `X-Script-Name=/pgadmin`, Dashboards needs `SERVER_BASEPATH=/dashboards` + `SERVER_REWRITEBASEPATH=true`. Keep as-is; document in a TODO that this is the last open subpath work. Not prod-blocking.

**Prisma migrations.** `backend` applies `prisma migrate deploy` on start. On a fresh server the schema is already in the repo; a new server only needs the migrate step once. Make the playbook idempotent: check if the schema version matches the deployed DB, and run only if not.

### 2.6 The state machine (`.cli-state.json`)

**Current state:** `.cli-state.json` records which steps ran, with SHA-256 fingerprints of inputs/outputs. It has two known failure modes:

1. `"stale"` flags from an old run (e.g. `osSecured`, `migrate`, docker `containarized`) — they survive a pull and mislead.
2. A step that ran once but whose implementation changed reads as "done" and silently skips (documented as a KNOWN GAP in `steps.js` for `appImages`).

**New design:** Ansible provides the audit trail natively — every playbook run is a git commit + a log; `ansible-playbook --check` shows the diff before applying. **Retire `.cli-state.json` for prod.** For dev, keep it (it solves real local-machine problems), but reset it (`make clear T=state`) whenever the CLI implementation changes, and add a `make state-reset` target that deletes it. Document: "the state file is only valid for the CLI version that produced it."

### 2.7 Backups (keep, integrate)

The RESTIC-based `backup.sh`/`restore.sh` is **good engineering** — keep it unchanged. It: stops the stack, tarballs every volume, copies runtime config/secrets, writes a RESTIC repo with retention (7 daily / 4 weekly / 6 monthly), verifies, restarts the stack, waits for healthy.

**Changes for Ansible integration:**

1. **Make backup the Ansible playbook's last task** — run after `up`/`health`, so every deploy is followed by a verified snapshot. (Or run from host cron; the scripts are self-contained.)
2. **Restore procedure documented here (§5).** After a restore, `infrastructure/.cli-state.json` (if kept on dev machines) may read stale — that's expected and noted in `restore.sh`.
3. **Off-box replication** — set `RESTIC_REPO` to a remote target (`s3://...` or `ssh://user@host:path`) so a second copy of every snapshot lives off the server. The scripts support this; document the credentials in the Ansible vault under `restic.yml`.
4. **Restore steps** (copy verbatim into runbooks): `ENV=prod RESTIC_REPO=... ./infrastructure/scripts/restore.sh <timestamp>` then `make docker A=health`.
5. **Retention policy** — documented in the scripts (`RETENTION_KEEP_DAILY/KEEP_WEEKLY/KEEP_MONTHLY`, default 7/4/6). Adjust via environment on the host, not in code.

### 2.8 Development workflow (keep the CLI for dev)

The local CLI stays the development path — its problems (pm2 host processes, per-env `.env`, local CA, fingerprinted state) are dev-specific. Changes:

- Keep `make cli`, `make setup ENV=dev`, `make step ...` for local dev only.
- Add a README section `Development` that documents the local workflow separately from `Production` (Ansible).
- Document that `make check` is **not** a prod readiness test — prod is deployed via Ansible, checked via `make docker A=health` on the server.
- Keep `dev_unpublished_ports` (`BACKEND_PORT=3000`); prod does not use it.

### 2.9 CI/CD

**New CI job (`.github/workflows/deploy.yml` or per-NPR policy):**

1. On push to `main`: build + test both images, push digests to the registry, tag `latest`.
2. On explicit deploy trigger (e.g. a tag or a workflow_dispatch): run the Ansible playbook against the prod host **with the image digest that was just built** (`backend_image: ${{ steps.build.outputs.backend_sha }}`). This couples the deployed code to the exact image tested.
3. Emit a deployment summary in CI: compose diff, image digests, `docker compose config` validation result (`make docker A=ps` equivalent), and health check status.

**No CI secrets on the server:** CI pushes images; Ansible vault holds credentials. The server never needs write access to git.

### 2.10 Monitoring and health

**Current state:** healthchecks exist on every service; `make docker A=health` reports per-service status; pgsync has a complex custom health probe.

**Prod additions:**

1. **`docker compose` health is the source of truth** — don't add ad-hoc probes. If a service is unhealthy, fix the healthcheck in the compose file.
2. **Add a centralized health endpoint** if the backend serves one (it already exposes Keycloak `KC_HEALTH_ENABLED` and OpenSearch `_cluster/health`); expose a single `/health` route behind nginx that aggregates: compose status (via a sidecar `healthcheck` against `docker.sock` is not portable; instead have nginx GET the app's health endpoint and check `docker compose ps` in CI).
3. **Log rotation** — the nginx comment notes `json-file` driver limits don't cover nginx (it writes directly to files on the `nginx-logs` volume). Add a `logrotate` config or a `volumes` bind-mount to `/var/log/nginx` with rotation, plus a container log policy. Document as a required post-setup task.
4. **Uptime monitoring** — external (NPR ops) pings `https://nbcg.me/` and `https://nbcg.me/api/...`. Add the check URL to `available_hostnames` (it already is: `nbcg.me`).
5. **Document the port map** (internal/external) in `docs/infrastructure/ansible-prod-setup.md` §10 so ops can open firewall rules once.

### 2.11 Networking

**Prod publishes only 80 and 443** (`prod_published_ports`). Everything else (5432, 8082, 5601, 9200, 9333, 8083, 6379, 25432) is **not** bound to the host. **Do not open those ports in the cloud firewall.** Only 80 and 443 inbound; SSH (22) for Ansible.

**DNS.** Point `nbcg.me` (and `www.nbcg.me` if used) at the server's public IP. Add each entry to `available_hostnames` **before** or **at the same time** as deploying TLS; the nginx catch-all returns 444 for unlisted hosts.

**Internal IP changes.** The earlier incident (`10.10.11.1` vs `10.10.12.1`) happened because a LAN IP was added to `available_hostnames` after the machine's address changed. Rule: **hostnames/dns names, not LAN IPs, go in `available_hostnames`**. If an IP must be used, add it and then immediately run `make step STEP=config ENV=prod` to regenerate the `.env`, nginx config, certs, and Keycloak realm — a plain `docker compose restart` will *not* pick up the change (documented in `infrastructure-cli.md`; the README warning stands: use `up -d --force-recreate`).

---

## 3. Proposed Ansible playbook structure

```
ansible/
  inventory/
    hosts.yml                 # prod group + vars (hosts, ansible_user, etc.)
  group_vars/
    vault.secrets.yml         # all passwords/secrets/tokens (vault-encrypted)
    vault.yml                 # (reserved: master seed / determinism config)
    prod.yml                  # env-agnostic prod vars (domains, org name)
  playbooks/
    main.yml                  # entry point: provision -> config -> deploy -> health -> backup
    01-provision.yml
    02-config.yml
    03-deploy.yml
    04-postdeploy.yml
    05-backup.yml
  roles/
    docker/                   # install docker + compose plugin, user, firewall, docker defaults
    certs/                    # certbot renewal, internal CA + opensearch certs layout
    config/                   # render .env, app envs, rendered templates (jinja2)
    deployment/               # image pull, compose up, migrations, openSearch security, keycloak realm import
    monitoring/               # logrotate, health endpoint wiring, uptime check
  templates/
    root.env.j2               # root .env (from .env.shared + .env.prod + vault)
    frontend.env.j2           # env_routing frontend vars
    backend.env.j2            # env_routing backend vars
    nginx.conf.j2             # nginx.conf.template with jinja2 (keeps $(...) style OR converts)
    keycloak-realm.j2         # nbcg-realm.conf.json with jinja2
    opensearch.yml.j2         # opensearch.yml generation (currently osSecurity step)
    htpasswd.j2               # ADMIN_UI_HTPASSWD row
```

**Recommended variable naming:** all vault secrets as `nbcg_<NAME>` (e.g. `nbcg_postgres_password`). Render `.env` with those. This makes the mapping one-to-one and auditable against `secrets_to_generate`.

**Recommended task order in `main.yml`:**

1. `01-provision`: docker install, compose plugin, app user, firewall (80/443/22 only), kernel limits for OpenSearch, swap off.
2. `02-config`: render all `.env` files and template outputs **to a staging dir**, validate with `docker compose -f ... config` (dry-run validation — catches invalid templates before applying), then copy into place.
3. `03-deploy`: copy `docker-compose.yml` + `docker-compose.prod.yml` (from repo), `docker compose pull`, `docker compose up -d`, `docker compose ps --format json` health poll.
4. `04-postdeploy`: `prisma migrate deploy` (idempotent check first), `opensearch securityadmin` run, Keycloak realm import check.
5. `05-backup`: invoke `backup.sh` (ENV=prod) as the post-deploy snapshot.
6. Emit a deployment report (JSON) to a git-tracked run log for audit.

---

## 4. Migration checklist (ordered)

Execute in this order. Stop and verify each task's **Verify** steps before moving on — a phase gate (listed under *Phase ordering and gates*) must pass before starting the next phase. Every task below is self-contained: **What** (the change), **Why** (the risk it mitigates), **How** (numbered steps), **Before**/**After** (acceptance states), **Verify** (commands). 66 tasks across 11 phases.

**Status:** Plan mode — nothing executed. All items below are pending.

**Cross-references:** `docs/infrastructure/infrastructure-audit.md`, `docs/infrastructure/infrastructure-cli.md`, `docs/infrastructure/plans/keycloak-internal-routing-fix.md`, `docs/infrastructure/opensearch-reindex.md`.

### How to use this checklist

Each task is a self-contained unit of work. Before starting, read the **Before** and **After** states — they are the acceptance criteria. After completing the **How** steps, run the **Verify** commands. If the **After** / **Verify** results don't match, the task is not done.

- **ID** — unique task identifier (e.g. `01-01`).
- **Phase** — the phase this task belongs to (phases are ordered: later phases depend on earlier ones).
- **What** — the concrete change.
- **Why** — the reason / risk it mitigates.
- **How** — exact steps to perform.
- **Before** — observable state before starting.
- **After** — observable state after finishing.
- **Verify** — commands to confirm the task is correct.

**Priority key:** `P0` = blocking for production; `P1` = should be done before first real deployment; `P2` = polish / nice-to-have.

---

### What has been done so far (plan mode only)

No execution has taken place. Everything to date is documentation and planning, all reversible:

1. **Incident diagnosis & fix plan** (Aug 2026) — diagnosed `https://10.10.11.1:443` returning no payload; root cause = `10.10.11.1` (the host's real NIC address) was missing from `available_hostnames`, so nginx's anti-spoofing catch-all (`return 444`) dropped the request. Documented the 5-step fix mechanism in `docs/infrastructure/plans/infrastructure-todo.md`.
2. **Keycloak worker secret diagnosis** — the `KEYCLOAK_WORKER_CLIENT_SECRET is not set` error: two gaps — the secret wasn't in `secrets_to_generate`/`env_routing` AND the realm client had a literal `**********` placeholder. The template side has since been wired (`"secret": "$(KEYCLOAK_WORKER_CLIENT_SECRET)"` — verified at `nbcg-realm.conf.json:1029`), but the live Keycloak realm still holds a stale value, so a manual Keycloak admin-console action (Track A) is still outstanding.
3. **Internal-keycloak-routing plan (Track B)** — a plan to extend the guard in `init-env.js:149` from loopback-only to **all** IP literals via `net.isIP()` (currently only `["localhost","127.0.0.1","::1"]` are blocked). Still pending — the repo is verified to still have the loopback-only guard.
4. **OpenSearch reindex backlog** — `docs/infrastructure/opensearch-reindex.md` documents three schema v2 changes that were done on dev but not prod: accent-folding analyzer (2026-09-25), ISBN/ISSN + publication-year sub-fields (2026-09-29), and the one-off `metadata.issue.date` mapping.
5. **This document** (the production deployment blueprint) records all decisions: the 11 change sections (§2), the proposed Ansible tree (§3), this detailed checklist (§4), the operational runbook (§5), file inventory (§6), 12 known risks (§7), the secrets list (§8), the version matrix (§9), and the port map (§10).

The repository itself is at its **pre-execution state**: the prod `docker-compose.prod.yml` still has `build: ./frontend` / `build: ./backend`; root `.env` still contains plaintext passwords; `config.template.yml` still carries the ZFS reference and the aspirational FQDNs; the internal CA is still the nginx cert source. Nothing has been executed.

---

### Phase ordering and gates

```
00 Prep ──► 01 Secrets ──► 02 Images/CI ──► 03 TLS ──► 04 Ansible core
        └─────────────────────────────────────────────────────────────►
                                    CLI-side fixes (05) run in parallel
                                          │
                                          ▼
                                   06 OpenSearch reindex (prod)
                                          │
                                          ▼
                                   07 Security hardening
                                          │
                                          ▼
                                   08 Dev / CLI hygiene
                                          │
                                          ▼
                                   09 Drills ──► 10 Handover
```

Gates — do not pass a phase until its Verify steps pass:

- **00 → 01:** Ansible controller provisioned, SSH key authorized on prod host, `ansible --version` works.
- **01 → 02:** Vault created, all secrets in vault, `ansible-vault view` works, no plaintext passwords remain in the repo.
- **02 → 03:** Both images built and pushed to the registry with digests; `docker-compose.prod.yml` uses `image:` not `build:`.
- **03 → 04:** Let's Encrypt cert obtained; `curl -vk https://<hostname>/` returns 200 with the LE cert visible.
- **04 → 06:** `ansible-playbook --check` runs cleanly and a real `--diff` run applies with zero changes on second run.
- **06 → 07:** `GET https://<hostname>/records,drafts/_count` returns expected row counts after pgsync completes.
- **07 → 08:** All `docker ps` services `healthy`; htpasswd non-empty; no plaintext secrets in git history.
- **08 → 09:** Phase 8 hygiene closed — port map verified, `available_hostnames` deduped with no stale SANs, orphan images cleaned; phases 0–7 complete.
- **09 → 10:** All drills pass — clean-redeploy, restore, rebuild, certificate renewal, and the hostname-allowlist check.

---

### Phase 0 — Foundation

#### 00-01 Set up the Ansible controller, the prod server, and SSH access

- **What:** Provision the Ansible controller and the prod server (Ubuntu LTS, SSH hardened key-only, sudo-capable user), generate an SSH key pair, and authorize the public key on the prod host.
- **Why:** The whole prod path is Ansible-based; hand-editing the server is retired. A key-only credential is required for the hardened SSH posture (audit item P0 #2).
- **How:**
  1. Confirm the prod server preconditions: Ubuntu LTS installed, a sudo-capable user exists, SSH running with `PasswordAuthentication no` (key-only, no password login).
  2. On the controller: `ssh-keygen -t ed25519 -C "nbcg-prod"`, passphrase-protect it.
  3. On the prod host: append `~/.ssh/authorized_keys` with the public key; restrict with `AuthorizedKeysFile .ssh/authorized_keys` in `sshd_config`.
  4. Test from controller: `ssh -o BatchMode=yes prod-host echo ok`.
  5. Optionally add `ControlPersist` / a bastion if the prod host has no direct access.
- **Before:** No Ansible controller; no key authorized; server SSH posture unverified (password login may still be on).
- **After:** Prod server confirmed as Ubuntu LTS with key-only SSH and a sudo user; `ssh -o BatchMode=yes prod-host echo ok` prints `ok` from the controller.
- **Verify:** `ssh -o BatchMode=yes -o ConnectTimeout=10 prod-host echo ok`; `ssh prod-host "sudo -n true"` (passwordless sudo works); `ansible --version` on controller; prod host shows the key's comment in `authorized_keys`.

#### 00-02 Install Docker + Docker Compose plugin on the prod host

- **What:** Install Docker Engine and the Compose plugin on the Ubuntu LTS prod host; verify versions.
- **Why:** Phase 4 `01-provision.yml` depends on this; `docker compose` is the deployment command.
- **How:**
  1. Follow Docker's official Ubuntu install steps (repo or script); enable the user to run docker without sudo if preferred (`sudo usermod -aG docker $USER`), or have Ansible manage this.
  2. Verify: `docker --version` and `docker compose version`.
- **Before:** Docker absent (or a different package manager version).
- **After:** `docker compose version` reports v2.x (Compose plugin).
- **Verify:** `docker compose version` and `docker info | grep -i compose`.

#### 00-03 Open the firewall — 80, 443, 22 only

- **What:** Cloud firewall / host firewall (ufw/iptables) allows inbound TCP 22 (SSH), 80 (HTTP), 443 (HTTPS) and **nothing else**.
- **Why:** Only nginx is published in prod; every other port is Docker-internal. Opening 5432/8080/5601 etc. exposes DBs and admin UIs to the internet (blueprint §10 — port map and firewall rules).
- **How:**
  1. Check current rules (`ufw status` or cloud security-group listing).
  2. Delete any unnecessary inbound rules; add `22, 80, 443` only.
  3. Confirm no other ports are exposed.
- **Before:** Firewall open to more than 80/443/22 (or unknown).
- **After:** Firewall allows inbound only 22, 80, 443.
- **Verify:** `ufw status` (or `aws ec2 describe-security-groups` / cloud panel) shows only 22/80/443; a scan of e.g. `nmap -sT -p- <host>` shows 80/443 open and 22 open, all other ports filtered/filtered.

#### 00-04 Create the Ansible directory tree and commit it

- **What:** Add the Ansible tree from blueprint §3 to the repo and commit it (before running against prod).
- **Why:** A git commit is the pre-flight gate; it also documents the configuration for audit and rollback.
- **How:**
  1. Create: `ansible/inventory/hosts.yml`, `ansible/group_vars/vault.secrets.yml`, `ansible/group_vars/vault.yml`, `ansible/group_vars/prod.yml`, `ansible/playbooks/main.yml`, `01-provision.yml`, `02-config.yml`, `03-deploy.yml`, `04-postdeploy.yml`, `05-backup.yml`, `ansible/roles/{docker,certs,config,deployment,monitoring}/{tasks,handlers,templates,vars}`, `ansible/templates/{root.env.j2,frontend.env.j2,backend.env.j2,nginx.conf.j2,keycloak-realm.j2,opensearch.yml.j2,htpasswd.j2}`.
  2. Fill skeletons with idempotent content (see Phases 4).
  3. `git add ansible/ && git commit -m "Add Ansible prod playbook tree"`
- **Before:** `ansible/` directory does not exist.
- **After:** `ansible/` tree exists on a committed branch; `ansible-playbook --syntax-check ansible/playbooks/main.yml` passes.
- **Verify:** `git status` clean; `ansible-playbook --syntax-check ansible/playbooks/main.yml` returns 0.

#### 00-05 Verify prod prerequisites with `make check ENV=prod`

- **What:** Confirm the local machine is ready (node/npm/docker/compose installed, ports available) so the playbook's own checks can be trusted.
- **Why:** The CLI's `requirements.js` derives checks from `master.config.json`; it's the canonical prerequisite check.
- **How:**
  1. From the repo root, run `make check ENV=prod`.
2. Read the output: `node`, `npm`, `docker` + compose plugin (always); `openssl`, `pm2` only as the env requires; every hostname in `available_hostnames` must resolve; every prod-published port (80/443) must be free.
3. Fix any failing prerequisite (install the tool, correct the hostname, free the port) and re-run.
4. Do **not** proceed to deploy until `make check ENV=prod` reports "All prerequisites satisfied" (exit 0).
- **Before:** Not run, or `make check ENV=prod` reports failures.
- **After:** "All prerequisites satisfied".
- **Verify:** `make check ENV=prod` prints all prerequisites satisfied.

#### 00-06 Remove stray `config.yml` from root `.gitignore`

- **What:** Remove the `config.yml` line from root `.gitignore`; the Ansible entry point `ansible/playbooks/main.yml` has replaced the old `config.yml` CLI entry point.
- **Why:** Blueprint §2.1 — the root `.gitignore` references a file that does not exist; it is a stale entry from the old prod entry point (`config.yml` was the old CLI entry, `ansible/playbooks/main.yml` is the new one). Removing it avoids confusing new operators.
- **How:**
  1. Edit root `.gitignore`: delete the `config.yml` line (line 6).
  2. Confirm `config.yml` does not exist anywhere in the repo (`find . -name config.yml` — only `config.template.yml` exists).
  3. Commit: `git add .gitignore && git commit -m "infra: remove stale config.yml entry from root .gitignore"`.
- **Before:** Root `.gitignore` line 6: `config.yml`.
- **After:** Root `.gitignore` has no `config.yml` line.
- **Verify:** `grep -n "config.yml" .gitignore` returns nothing; `git status` shows the deletion staged.

#### 00-07 Add README sections separating Dev and Prod workflows

- **What:** Add a `## Development` section and a `## Production` section to `README.md` so the local CLI workflow is documented separately from the Ansible prod path.
- **Why:** Blueprint §2.8 — the two shapes (host pm2 dev vs containerized prod) are genuinely different and are currently conflated in the unified README; separation prevents dev commands from being misused on prod.
- **How:**
  1. Edit `README.md`: add a "## Development" subsection describing `make cli`, `make setup ENV=dev`, host pm2, per-env `.env`, and the local internal CA; then a "## Production" subsection pointing to `docs/infrastructure/ansible-prod-setup.md` with the Ansible entry point and the `make docker A=health` check.
  2. Add the note: "`make check` is not a prod readiness test — prod is deployed via Ansible and checked on the server with `make docker A=health`."
  3. Note the README warning about `docker compose restart` not re-reading config (applies to both dev and prod).
- **Before:** `README.md` describes one unified workflow.
- **After:** `README.md` has distinct "Development" and "Production" sections.
- **Verify:** `grep -n "## Development\|## Production" README.md` returns both headers.

---

### Phase 1 — Secrets and vault (P0)

#### 01-01 Run the secret audit

- **What:** Enumerate every `PASSWORD`, `SECRET`, `TOKEN`, `KEY` used by the stack — in `.env.*`, `master.config.json`, compose files, and app code.
- **Why:** This audit is the input to the vault (§2.2, §8). Anything not in the audit is a risk of being left as plaintext.
- **How:**
  1. Grep: `rg -i "PASSWORD|SECRET|TOKEN|KEY" --glob '!node_modules' .` (backend, frontend, infrastructure).
  2. Compare against the canonical list in blueprint §8 (11 entries).
  3. Write findings to `docs/plans/secret-audit.md` (include a "still in plaintext" section).
- **Before:** No consolidated inventory.
- **After:** `docs/plans/secret-audit.md` lists every secret, its producer, consumer, and current location; the 11 entries from blueprint §8 all accounted for.
- **Verify:** Every variable in `secrets_to_generate` (9 in `master.config.json`) plus `RESTIC_PASSWORD`, `COBISS_TOKEN`, `KEYCLOAK_WORKER_CLIENT_SECRET`, `PGADMIN_DEFAULT_PASSWORD`, `ADMIN_UI_PASSWORD` appears in the audit.

#### 01-02 Create `ansible/group_vars/vault.secrets.yml`

- **What:** Create the Ansible vault file containing all secrets from the audit, encrypted with `ansible-vault encrypt`.
- **Why:** Blueprint §2.2 §1 — all secrets in vault, none in the repo. Vault is the single source of truth for the playbook.
- **How:**
  1. Unencrypted skeleton: `ansible/group_vars/vault.secrets.yml.unencrypted` with the 11 blueprint-§8 secrets (`nbcg_postgres_password`, `nbcg_keycloak_postgres_password`, `nbcg_keycloak_admin_password`, `nbcg_keycloak_worker_client_secret`, `nbcg_pgadmin_default_password`, `nbcg_opensearch_initial_admin_password`, `nbcg_opensearch_app_password`, `nbcg_opensearch_dashboards_password`, `nbcg_admin_ui_password`, `nbcg_cobiss_token`, `nbcg_restic_password`) plus `nbcg_master_seed` / determinism config if using derived secrets.
  2. Generate high-entropy values (e.g. `openssl rand -base64 48`) **off the prod host**, or derive from a master seed + env fingerprint (blueprint §2.2 §2).
  3. Encrypt: `ansible-vault encrypt ansible/group_vars/vault.secrets.yml.unencrypted && mv vault.secrets.yml ansible/group_vars/ && rm .unencrypted`.
  4. Record the vault key location/owner in the runbook (Phase 10).
- **Before:** No `vault.secrets.yml`; secrets live in plaintext in `.env.dev`/`.env`/`.secrets.prod.json`.
- **After:** `ansible/group_vars/vault.secrets.yml` is vault-encrypted; `ansible-vault view ansible/group_vars/vault.secrets.yml` (with the vault key) shows 11 secret variables; no plaintext secrets remain in the repo (confirmed by `rg -i "PASSWORD\|SECRET\|TOKEN\|KEY" | grep -v "\.env\.\(shared\|dev\)\|master.config\|nbcg-"`).
- **Verify:** `ansible-vault view ansible/group_vars/vault.secrets.yml` (prompted decrypt) shows exactly the 11 vars; `git grep -i password` finds no 8+ char secrets outside `.env.dev`, `.env.shared`, and `nbcg_` prefixed comments.

#### 01-03 Wire `KEYCLOAK_WORKER_CLIENT_SECRET` into the Ansible render

- **What:** Ensure the Ansible render injects `nbcg_keycloak_worker_client_secret` into `backend/.env` (via `env_routing.backend.vars.KEYCLOAK_WORKER_CLIENT_SECRET`), which is already in `master.config.json` (verified: `env_routing.backend.vars` includes `KEYCLOAK_WORKER_CLIENT_SECRET`).
- **Why:** The backend's `KeycloakAdminService` needs it; it's in `secrets_to_generate` and `env_routing` already (verified in `master.config.json`), so the Ansible render must pass the vault variable through.
- **How:**
  1. Confirm the vault variable name for the worker secret (`nbcg_keycloak_worker_client_secret`) in `ansible/group_vars/vault.secrets.yml`.
2. In `ansible/templates/backend.env.j2`, ensure there is a line: `KEYCLOAK_WORKER_CLIENT_SECRET={{ nbcg_keycloak_worker_client_secret }}` (this mirrors `env_routing.backend.vars.KEYCLOAK_WORKER_CLIENT_SECRET` in `master.config.json`, which is already present — verified).
3. Confirm the rendered backend env (dry-run) contains the line with the vault value and is not empty.
4. Confirm no other place emits a literal secret for this var.
- **Before:** Render template does not emit `KEYCLOAK_WORKER_CLIENT_SECRET` for the backend.
- **After:** Rendered backend `.env` contains `KEYCLOAK_WORKER_CLIENT_SECRET=...` (non-empty).
- **Verify:** `ansible-playbook ... 02-config.yml --check`; `grep KEYCLOAK_WORKER_CLIENT_SECRET <rendered backend/.env>` returns the value.

#### 01-04 Extend the `available_hostnames` guard (Track B) — CLI-side

- **What:** Extend the guard in `infrastructure/scripts/init-env.js:deriveOrigins()` (currently at line ~149) from loopback-only to reject **any** IP literal in first position for prod.
- **Why:** Blueprint risk #1 / keycloak plan Track B. Currently only `["localhost","127.0.0.1","::1"]` are blocked; a bare IP like `10.10.12.1` in first position silently breaks JWT validation on **every** request (`jwksUri` fetch + `KeycloakAdminService`) with `fetch failed` as the only clue. The `net.isIP()` check turns a silent failure into a loud error in `make step STEP=config ENV=prod`.
- **How:**
  1. Edit `infrastructure/scripts/init-env.js` around `deriveOrigins`:
     ```js
     import net from "node:net"
     if (env === "prod" && (["localhost", "127.0.0.1", "::1"].includes(canonicalHost) || net.isIP(canonicalHost)))
       throw new Error(
         `available_hostnames starts with "${canonicalHost}", which cannot work in prod.\n` +
         `The backend reaches Keycloak internally (JWT validation, user directory sync) through an ` +
         `nginx network alias keyed on this hostname — loopback names and bare IP addresses never go ` +
         `through that resolution, so the backend cannot reach it that way, and both would fail with ` +
         `"fetch failed" as the only clue.\n` +
         `Put a real hostname first in master.config.json (a /etc/hosts entry on the host is enough for testing) — ` +
         `an IP address can still be listed afterward for direct browser access.`
       )
     ```
  2. Commit: `git commit -m "prod: reject IP-literal first entry in available_hostnames"`.
  3. Note: this is a dev-tooling guard; it does **not** change prod behavior for a correctly configured deployment, but it prevents the misconfiguration from being silently deployed.
- **Before:** `deriveOrigins` blocks only `localhost`, `127.0.0.1`, `::1`.
- **After:** `deriveOrigins` throws on any IP-literal first entry for `env === "prod"`.
- **Verify:**
  1. `node --check infrastructure/scripts/init-env.js`.
  2. With `master.config.json` temporarily set to `["10.10.12.1", "nbcg.me"]` and `ENV=prod`, run `make step STEP=config ENV=prod` (or invoke `deriveOrigins` directly) — it must throw with the new message.
  3. `["nbcg.me", "10.10.12.1"]` must still succeed.
  4. `node scripts/run.js config diff` still reports match with template.

#### 01-05 Retire `infrastructure/.secrets.prod.json` from the prod path

- **What:** Ansible writes the root `.env` and app envs directly from vault; stop shipping `.secrets.prod.json` by hand. Add a cleanup step (or ensure the file is never written on prod) and document the retirement.
- **Why:** Blueprint §2.2 §5 — the secrets store is an intermediate file that must be manually shipped to the server; it's a secrets-handling risk and a source of drift.
- **How:**
  1. `02-config.yml` renders the envs from vault (Phase 4).
  2. Add a cleanup task in the playbook (idempotent): remove `.secrets.prod.json` from the repo root on prod if present, or leave it — the important change is that Ansible no longer reads it. Document in `ansible-prod-setup.md` §2.2 that the CLI-side `--rotate` behavior is deprecated for prod.
  3. Optionally add a playbook pre-check that errors if `.secrets.prod.json` exists (fail fast: you're using the retired path).
- **Before:** `infrastructure/.secrets.prod.json` exists (gitignored) and the CLI reads it for prod secrets.
- **After:** The Ansible playbook generates all prod envs from vault; `.secrets.prod.json` is unused by prod; the playbook refuses or warns if it's present on prod.
- **Verify:** `ansible-playbook ... --check` shows no dependency on `.secrets.prod.json`; a prod run does not read it (grep `ansible/playbooks/*.yml` — `secrets.prod.json` absent).

#### 01-06 Set `COBISS_TOKEN` in vault

- **What:** Place a real COBISS/IZUM API token into `nbcg_cobiss_token` in `vault.secrets.yml`; ensure the render injects it into backend env.
- **Why:** Audit item P0 #3 — an empty `COBISS_TOKEN` makes COBISS/IZUM imports **silently fail**. It must be set before any import runs. It's external data, provided separately (not in the repo).
- **How:**
  1. `ansible-vault edit ansible/group_vars/vault.secrets.yml` → set `nbcg_cobiss_token` from the value the NPR ops team provides (or from their secrets store; if using an external store, render a proxy var that pulls it).
  2. Render `backend.env.j2` already has `COBISS_TOKEN=${COBISS_TOKEN}` in `env_routing` — confirm the vault var maps to it.
- **Before:** `COBISS_TOKEN=` empty in root `.env`; imports fail silently.
- **After:** `nbcg_cobiss_token` set in vault; rendered backend `.env` has a non-empty `COBISS_TOKEN`; a test COBISS lookup returns a record instead of an error.
- **Verify:** `grep COBISS_TOKEN <rendered backend/.env>` non-empty; `curl`-a test COBISS endpoint with the token returns data (no timeout/401/empty).

#### 01-07 Decide and document the `nginx_external` TLS posture for the Ansible path

- **What:** Record the decision on how nginx TLS material is supplied in prod: (a) Let's Encrypt via certbot managed outside Ansible (preferred, per blueprint §2.4), with Ansible only pointing nginx at `/etc/letsencrypt/...`; or (b) a real authority certificate dropped in and `nginx_external: true`.
- **Why:** Blueprint §2.4 §4 — the `certs` step and `nginx_external` flag belong to the local CLI path, not the server. The Ansible render must not overwrite a production certificate.
- **How:**
  1. Decision: use Let's Encrypt via `certbot` on the host (manual cron renewal or a systemd timer), **not** Ansible-managed cert generation. Ansible `nginx.conf.j2` mounts `/etc/letsencrypt/live/nbcg.me/fullchain.pem` + `privkey.pem` as `/etc/nginx/certs/`.
  2. Set `nginx_external: true` **after** the real cert is in place — document that Ansible skips cert generation and that `nginx_external: true` makes the `certs` role verify the files exist and leave them alone.
  3. Write the decision into `ansible-prod-setup.md` §2.4 for the handover doc.
- **Before:** `certificates.nginx_external: false`; `nginx.conf.template` mounts `server.crt/server.key` from `docker/certs/nginx/` (internal CA leaves).
- **After:** Prod nginx serves a Let's Encrypt certificate; `nginx.conf.j2` points at `/etc/letsencrypt/...`; `nginx_external` is `true` in prod config; internal CA retained only for OpenSearch.
- **Verify:** `curl -vk https://nbcg.me/ | grep -i "issuer\|subject"` shows a public CA (e.g. Let's Encrypt / ISRG); `nginx -T | grep -i letsencrypt` shows the cert path.

---

### Phase 2 — Images and CI (P0)

#### 02-01 Confirm frontend/backend Dockerfiles are buildable

- **What:** Review `frontend/Dockerfile` and `backend/Dockerfile`; ensure they build without host Node/npm and produce the `dist/` artifact the Ansible path pulls.
- **Why:** Blueprint §2.3 §3-4 — images must be built in CI and pulled; the Dockerfiles are the build definition. `backend/Dockerfile` and `frontend/Dockerfile` already exist (verified), but must be verified against the Ansible path (no local `node_modules`, correct working dir, `prisma generate` for backend).
- **How:**
  1. Review both Dockerfiles; confirm: multi-stage build (builder → final, slim), `npm ci` not `npm install`, backend runs `prisma generate` + `prisma migrate deploy`? (migrate on start is in `start:prod` — confirm it's in the image), copies `dist/` correctly, non-root user.
  2. Build locally as a proxy for CI: `docker build -t nbcg/backend:test ./backend` and `./frontend`.
  3. Fix anything that can't run in a clean builder image.
- **Before:** Dockerfiles exist; build may rely on dev-time artifacts.
- **After:** Both build cleanly in an isolated container with only `npm ci` + app build steps.
- **Verify:** `docker build -t nbcg/backend:test ./backend && docker build -t nbcg/frontend:test ./frontend` succeed; `docker run --rm nbcg/backend:test node -e "require('./dist/src/main.js')"` (dry-run) or equivalent smoke test.

#### 02-02 Add `.github/workflows/build.yml`

- **What:** A CI workflow that builds, tests, and pushes both images on push to `main`, tagging with `<branch>-<short-sha>` and `latest`, and recording the digests.
- **Why:** Blueprint §2.3 §1 + §2.9 §1 — no Node/npm on the prod host; images come from a trusted registry with pinned digests. This is the replacement for the local `appImages` build.
- **How:**
  1. Add `.github/workflows/build.yml` using GitHub-hosted runners; secrets: `GHCR_TOKEN` (repo, `write:packages`).
  2. Steps: `npm ci` (frontend/backend), run each project's test suite, `docker build --pull ...` with `ghcr.io/nbcg/frontend:<sha>` / `ghcr.io/nbcg/backend:<sha>` and `latest`; `docker push`; write digests to an artifact or step output (`backend_image_sha: ${{ steps.build.outputs.sha }}`).
- **Before:** No CI build workflow; images are built on the local dev machine.
- **After:** `github.com/<owner>/<repo>/actions/workflows/build.yml` exists; a push to `main` produces two digested images.
- **Verify:** Push a test commit to a branch; the workflow runs; `ghcr.io/nbcg/backend` and `ghcr.io/nbcg/frontend` list the pushed digests; `docker pull` one and run a smoke test.

#### 02-03 Add `.github/workflows/deploy.yml` (explicit deploy trigger)

- **What:** A CI workflow triggered explicitly (workflow_dispatch, or a release tag) that runs the Ansible playbook against prod **using the digest that was just built**.
- **Why:** Blueprint §2.9 §2-3 — couples deployed code to the exact tested image; emits a deployment summary (compose diff, digests, `docker compose config` validation, health status).
- **How:**
  1. Trigger: `workflow_dispatch` with an input for the image tag, or `on: push` on `main` if deployments are fully automated.
  2. Get the built digests from the build job (share via outputs/artifacts) or read from a registry query.
  3. Run: `ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/main.yml -e "backend_image=<digest> frontend_image=<digest> vault_pass_file=..."` with `--check` first, then apply.
  4. Emit summary: image digests, `docker compose config` dry-run result, health check results.
- **Before:** No CI deploy path; deploys are manual `make setup` on the server.
- **After:** One explicit CI action deploys the tested images to prod via the playbook; a summary is posted.
- **Verify:** Manually dispatch a deploy; playbook runs; summary shows the exact digests deployed; prod services are healthy after.

#### 02-04 Update `docker-compose.prod.yml` to `image:` references with digests

- **What:** Replace `build: ./frontend` / `build: ./backend` with `image: ghcr.io/nbcg/frontend@sha256:<digest>` / `image: ghcr.io/nbcg/backend@sha256:<digest>`.
- **Why:** Blueprint §2.3 §3 — the prod host only pulls; no build on the server. Deploy by digest for reproducibility and rollback.
- **How:**
  1. Edit `docker-compose.prod.yml` lines 101/112 (verified locations): replace the `build:` blocks with `image: ghcr.io/nbcg/<app>@sha256:<digest>`.
  2. Commit to a feature branch; on each deploy, update the digests (via the CI deploy job or manually with the value from the build workflow).
  3. Add a `.github/ISSUE_TEMPLATE` or keep a `deploy.sh` snippet that the operator pastes the digests into.
- **Before:** `docker-compose.prod.yml` has `build: ./frontend` and `build: ./backend` (lines 101, 112).
- **After:** `docker-compose.prod.yml` has `image: ghcr.io/nbcg/frontend@sha256:...` and `image: ghcr.io/nbcg/backend@sha256:...`.
- **Verify:** `docker compose -f infrastructure/docker/docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml config` shows the two digest images; `docker pull ghcr.io/nbcg/backend@sha256:<digest>` succeeds.

#### 02-05 Create `docs/infrastructure/deploy-versions.md` (version matrix)

- **What:** A file recording every image name + digest used by prod, per the blueprint §9 matrix, updated on every deploy.
- **Why:** Blueprint §2.3 §4 — pin everything; an immutable record of what is running is essential for audits, rollbacks, and incident investigation.
- **How:**
  1. Create `docs/infrastructure/deploy-versions.md` with the table from blueprint §9 (static images with versions + frontend/backend with CI digests).
  2. Every deploy updates the frontend/backend digest rows.
- **Before:** No version record.
- **After:** `docs/infrastructure/deploy-versions.md` lists all images with pinned versions; frontend/backend rows show the current prod digests.
- **Verify:** `grep ghcr.io/docs/infrastructure/deploy-versions.md` returns two digest entries matching what's in prod (`docker images` / registry query).

---

### Phase 3 — TLS (P0)

#### 03-01 Install certbot and obtain a public certificate

- **What:** Set up `certbot` on the prod host and obtain `nbcg.me` (+ optional `www.nbcg.me`, `api.nbcg.me`, `auth.nbcg.me`, `search.nbcg.me`) via HTTP-01 (or DNS-01 if the host is behind Cloudflare in proxy mode).
- **Why:** Blueprint §2.4 §1 — public clients must trust a public CA; the internal CA can never be trusted by real browsers. Let's Encrypt renewal is automatic.
- **How:**
  1. Install certbot (`apt install certbot python3-certbot-nginx` or standalone).
  2. Test the domain resolves to the host (`dig +short nbcg.me`).
  3. Run `certbot certonly --webroot -w /var/www/html -d nbcg.me [-d www.nbcg.me ...]` or `--standalone` if nginx must be stopped during issuance.
  4. Record the cert paths: `/etc/letsencrypt/live/nbcg.me/fullchain.pem` + `privkey.pem`.
- **Before:** nginx serves the internal-CA self-signed leaf (`docker/certs/nginx/server.*`, CN=`10.10.12.1`).
- **After:** `/etc/letsencrypt/live/nbcg.me/` contains valid, unexpired certificates from a public CA for `nbcg.me`.
- **Verify:** `openssl x509 -in /etc/letsencrypt/live/nbcg.me/fullchain.pem -noout -issuer -subject`; `curl -vk https://nbcg.me/` shows the public CA chain.

#### 03-02 Point nginx at the Let's Encrypt certificates

- **What:** Configure nginx to serve `/etc/letsencrypt/live/nbcg.me/fullchain.pem` + `privkey.pem`; update `nginx.conf.j2` so the Ansible render mounts these paths.
- **Why:** Blueprint §2.4 §2 — nginx is the TLS termination point; the Ansible render must not overwrite the live cert.
- **How:**
  1. If using a systemd certbot renew hook (or cron), run `certbot renew --dry-run` and confirm nginx reloads cleanly (`nginx -t && systemctl reload nginx`).
  2. In `nginx.conf.j2` (or the host nginx config), set `ssl_certificate     /etc/letsencrypt/live/nbcg.me/fullchain.pem;` and `ssl_certificate_key /etc/letsencrypt/live/nbcg.me/privkey.pem;` (or symlink into `/etc/nginx/certs/`).
  3. Ensure `/etc/nginx/certs/` exists and is owned by the nginx user.
- **Before:** nginx `ssl_certificate` points at `/etc/nginx/certs/server.crt` (internal CA leaf).
- **After:** nginx serves `/etc/letsencrypt/live/nbcg.me/fullchain.pem`.
- **Verify:** `nginx -T | grep -i ssl_certificate` shows `/etc/letsencrypt`; `curl -vk https://nbcg.me/` chains to a public CA; `curl -vk http://nbcg.me/` redirects or rejects.

#### 03-03 Retire the legacy nginx internal cert + `nginx_external` flag

- **What:** Remove `infrastructure/docker/certs/nginx/server.crt/.key` from the Ansible/prod path, remove the `certs` step from the prod playbook, remove the `nginx_external` flag handling, and document the retirement.
- **Why:** Blueprint §2.4 §4 — these belong to the local CLI path; leaving them creates a latent risk that Ansible overwrites the production certificate on re-run.
- **How:**
  1. Keep `infrastructure/docker/certs/nginx/` for dev only; mark it "dev only" in comments and the inventory (it's gitignored under `infrastructure/.gitignore: docker/certs/`).
  2. `01-provision.yml` does not regenerate nginx leaves; `02-config.yml` does not touch `/etc/letsencrypt/`.
  3. Update `master.config.json` comments: remove the `nginx_external` flag section or document it as "CLI path only, retired for prod".
- **Before:** `infrastructure/docker/certs/nginx/server.crt` exists; `certificates.nginx_external: false`; the `certs` step exists.
- **After:** The Ansible playbooks don't manage nginx certificates; `nginx_external` documented as retired for prod; dev keeps its internal CA.
- **Verify:** `grep -rn "nginx_external\|certs step" ansible/playbooks/` — no certificate-generation tasks remain; `git grep "docker/certs/nginx/server" ` only matches the `.gitignore`/dev comments.

#### 03-04 Back up the internal CA private key off-server

- **What:** Copy `infrastructure/docker/certs/ca/ca.key` to an off-server secure location (operator's password manager / encrypted USB / secrets store) and document the location.
- **Why:** Blueprint §2.4 §5 — the CA is the trust root for the whole cluster (nginx leaves, OpenSearch node/admin certs). Losing it means the whole TLS ecosystem must be rebuilt. The backup scripts already snapshot `docker/certs/` **only on the server**.
- **How:**
  1. `scp infrastructure/docker/certs/ca/ca.key <secure-offserver-path>/nbcg-ca.key` (or paste into the ops password manager).
  2. Verify: `openssl x509 -in ca.key -noout -subject` matches `ca.crt`.
  3. Record the storage location + access procedure in the runbook (Phase 10).
- **Before:** `ca.key` exists only on the server (and in the local dev clone).
- **After:** `ca.key` has an off-server backup; the location and access procedure are documented; the backup is verified to decrypt.
- **Verify:** Off-server location contains a file whose SHA-256 matches `infrastructure/docker/certs/ca/ca.key`; runbook documents the location.

#### 03-05 Document the Let's Encrypt renewal runbook

- **What:** Write the renewal steps into the operational runbook (§5 of the blueprint): check cert expiry, force renewal, reload nginx, verify.
- **Why:** Certificates expire; a documented, drilled procedure prevents an unplanned outage when renewal fails.
- **How:**
  1. Add to `ansible-prod-setup.md` §5 a subsection "Certificate renewal": `certbot certificates` (list expiries), `certbot renew --dry-run` (monthly check), `certbot renew` + `systemctl reload nginx` when expiry < 30 days, `curl -vk https://nbcg.me/` verify.
  2. Set a monitoring alert at 30/7/1 days before expiry (external uptime monitor already pings `nbcg.me` — add the cert expiry check).
- **Before:** No documented renewal procedure.
- **After:** Runbook has a certificate-renewal subsection; a `certbot renew --dry-run` succeeds.
- **Verify:** `certbot renew --dry-run` returns success; the runbook subsection exists and is referenced from §5.

---

### Phase 4 — Ansible playbooks (core migration, P0)

#### 04-01 Write `01-provision.yml`

- **What:** Idempotent provisioning: install Docker + compose plugin, create the `nbcg` app user, configure firewall (80/443/22), set kernel limits for OpenSearch, disable swap.
- **Why:** Blueprint §3 (task order 1); this is the bootstrapping playbook. Idempotency is the core principle (§2.1).
- **How:**
  1. Tasks: `apt` update + install docker.io + docker-compose-plugin; `useradd -m -s /bin/bash nbcg` (with sudoers entry); `ufw allow 22,80,443` (or cloud security group module); `sysctl` kernel params (`vm.overcommit_memory`, `kernel.shmmax` if needed); swap off (`swapoff -a` + comment out in `/etc/fstab`); set host-level limits — OpenSearch needs `memlock unlimited`, `nofile 65536` via `/etc/security/limits.conf` and `systemd` drops (blueprint §2.1; compose already has `ulimits` — set host-level equivalents).
  2. Use `become: yes` where needed; all tasks `changed_when: false` where idempotent.
  3. `ansible-playbook ansible/playbooks/01-provision.yml --check` then `--diff`.
- **Before:** Server has no Docker, no app user, default firewall.
- **After:** Docker + Compose installed; `nbcg` user exists with sudo; firewall allows 22/80/443; swap off; OpenSearch kernel/limits set.
- **Verify:** `docker compose version`; `id nbcg`; `sudo su - nbcg`; `ufw status` (22/80/443); `grep -i swap /proc/swaps` empty; `sysctl -a | grep -i memlock`; second run reports zero changes.

#### 04-02 Write `02-config.yml` — render envs and validate before applying

- **What:** Render the root `.env` (from `.env.shared` + `.env.prod` + vault), frontend/backend envs, and template outputs; **validate with `docker compose config` dry-run before writing anything**.
- **Why:** Blueprint §3 (task order 2) — validate templates before applying; `--check`/`--diff` gives a pre-flight diff; idempotent rendering produces byte-identical output from the same inputs.
- **How:**
  1. Render to a staging dir on the server (e.g. `/etc/nbcg/stage/`): `envsubst`/`jinja2` templating with vault vars; write `.env`, `frontend/.env`, `backend/.env`, `nginx.conf`, `htpasswd`, `nbcg-realm.json`, `opensearch.yml`, `servers.json`.
  2. Validate: `docker compose -f docker-compose.yml -f docker-compose.prod.yml -p nbcg-validate config` inside the staging context (or pass `--env-file` / `--project-directory`).
  3. Only if validation passes, copy into place (atomic: write to `.new`, `mv` into place).
  4. Emit a report (JSON) of rendered values used (hash of vault, image tags) to a git-tracked run log.
- **Before:** `.env` and rendered configs are created by the local CLI; no staged validation on the server.
- **After:** Playbook renders configs to a staging dir, validates with `docker compose config`, then applies atomically; re-runs produce identical output.
- **Verify:** `ansible-playbook ... 02-config.yml --check` shows the files it will write; re-run shows **zero changes**; `docker compose -f ... -f ... config` passes with the rendered values; a second run of the same inputs yields byte-identical files (`sha256sum` stable).

#### 04-03 Write `03-deploy.yml`

- **What:** Copy `docker-compose.yml` + `docker-compose.prod.yml` from the repo (not generated copies), pull the digested images, `docker compose up -d`, poll until all services are `healthy`.
- **Why:** Blueprint §2.1 §4-5 + §3 (task order 3); the deploy is the actual production change and must be healthy-gated.
- **How:**
  1. `copy` or `synchronize` the two compose files to the server's working dir (read from repo — the source of truth).
  2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml pull` (digests pinned → no tag churn).
  3. `docker compose -f ... up -d` with `--wait` (Compose v2.23+) or a loop polling `docker compose ps --format json | jq .State` until `healthy`.
  4. On failure, print the compose diff (`docker compose config --services`) and health statuses.
- **Before:** `make docker A=up` is run manually by hand on the server.
- **After:** `ansible-playbook ... 03-deploy.yml` pulls and starts all services; the playbook waits for healthy.
- **Verify:** `ansible-playbook ... 03-deploy.yml` ends with all services `healthy`; `docker compose ps` shows `Up (healthy)` for all; a stale image pull changes the running image and the stack recovers (digest pull).

#### 04-04 Write `04-postdeploy.yml`

- **What:** Apply Prisma migrations (idempotent), run OpenSearch `securityadmin`, check Keycloak realm import.
- **Why:** Blueprint §2.1 §5 + §3 (task order 4); these are the one-time-per-version bootstraps that must be idempotent.
- **How:**
  1. **Migrations:** check the schema version vs deployed DB (`prisma migrate resolve --list` or inspect `prisma/migrations` vs DB), run `prisma migrate deploy` only if out of sync. Wrap in a try/except so a failure doesn't halt the playbook.
  2. **OpenSearch security:** run `securityadmin.sh` with the admin cert (blueprint §2.1 §5 — the post-deploy security step; `infrastructure-cli.md` "OpenSearch security" — step 2). This is safe to re-run (never depends on current credentials; uses the cert).
  3. **Keycloak realm:** check whether the realm exists; only import if absent (or if `KC_IMPORT_STRATEGY=OVERWRITE_EXISTING` is set explicitly).
  4. Emit a report of what ran.
- **Before:** Migrations run on every container start (in the image's `start:prod`); securityadmin is invoked via `make docker A=os-secure`; realm import is automatic-once.
- **After:** These three runs are playbook tasks with an idempotency check before each; re-running reports "no change" where nothing needed doing.
- **Verify:** `ansible-playbook ... 04-postdeploy.yml --diff` shows zero changes on a second run (migrations "already up to date", securityadmin unchanged, realm already imported).

#### 04-05 Write `05-backup.yml`

- **What:** Run `backup.sh` (ENV=prod) as the post-deploy snapshot, with off-box `RESTIC_REPO` if configured.
- **Why:** Blueprint §2.7 §1 — every deploy followed by a verified snapshot; the playbook becomes the single trigger for backups.
- **How:**
  1. Task: `command: ./infrastructure/scripts/backup.sh` with `ENV=prod` and `RESTIC_REPO={{ nbcg_restic_repo | default(omit) }}` — note: RESTIC_REPO goes in vault (`restic.yml`) so the script doesn't hardcode it.
  2. `nbcg_restic_password` from vault is exported as `RESTIC_PASSWORD`.
  3. Add a timeout and fail the playbook if backup takes too long (e.g. `async/ poll` or `command` with `timeout`).
- **Before:** Backups are run manually / from host cron; no playbook link.
- **After:** Every full-playbook run ends with a verified RESTIC snapshot; `RESTIC_PASSWORD` comes from vault.
- **Verify:** `ansible-playbook ... 05-backup.yml`; `restic snapshots` (or `ls backups/prod/`) shows a new timestamped snapshot; the snapshot verifies (backup.sh does this).

#### 04-06 Write `main.yml` orchestration + deployment report

- **What:** `main.yml` includes the five playbooks in order (01 → 05); each playbook emits JSON that `main.yml` aggregates into a deployment report.
- **Why:** Blueprint §3 (task order 6) — a single entry point with a git-tracked audit log; enables `--check` of the full flow.
- **How:**
  1. `main.yml`: roles `import`/`include` for 01-05 with vault variable passing (`-e "@ansible/group_vars/vault.secrets.yml"`); collect each playbook's report into `/var/log/nbcg/deploy-report-<timestamp>.json`; optionally `git commit` it if a repo clone exists on the host.
  2. Document the entry point in the runbook: `ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/main.yml -e "@ansible/group_vars/vault.secrets.yml"`.
- **Before:** No orchestration entry point; manual invocation of steps.
- **After:** One command provisions/configures/deploys/verifies/backups; a JSON report is produced per run.
- **Verify:** `ansible-playbook ansible/playbooks/main.yml --check` parses; `--diff` shows the planned changes; a run produces `/var/log/nbcg/deploy-report-*.json`.

#### 04-07 Validate the whole flow with `--check` + real dry-run on a clone

- **What:** Before touching prod, run the full playbook tree against a **clone** of the server (or the prod host in `--check`/`--diff` mode) and confirm idempotency: re-run twice, zero changes on the second run.
- **Why:** Blueprint §4 Phase 4 last bullet; the single most important correctness gate for an automated deploy.
- **How:**
  1. `ansible-playbook ansible/playbooks/main.yml --check` — confirm all 5 playbooks are in the diff and nothing is destructive.
  2. Run once (on the clone): `ansible-playbook ansible/playbooks/main.yml`.
  3. Run again: confirm zero changes.
  4. Review `--diff` output for anything surprising (e.g. a config being overwritten).
- **Before:** Playbooks exist but untested end-to-end.
- **After:** Two consecutive runs of the full playbook produce zero changes; the diff is reviewed and approved.
- **Verify:** Second run output contains no `changed:` lines; the playbook exit code is 0.

---

### Phase 5 — CLI-side fixes (run in parallel; not prod-blocking)

These improve the local dev CLI and prevent misconfiguration; they do not affect the Ansible prod path.

#### 05-01 Remove the plaintext DATABASE_URL log

- **What:** Delete `console.log(process.env["DATABASE_URL"])` from `backend/prisma.config.ts`.
- **Why:** Blueprint risk #10 / audit item — the full Postgres connection string (with password) is printed to stdout on every Prisma invocation (migrations, generate, CLI). If logs are exported/collected, the password leaks. It prints on every dev boot too.
- **How:**
  1. Edit `backend/prisma.config.ts`: remove the `console.log` line; optionally keep a redacted log like `console.log('Prisma datasource configured for', process.env.DATABASE_URL ? 'postgres' : 'NO DATABASE_URL')` (never the value).
  2. Commit: `git commit -m "backend: stop logging DATABASE_URL on boot"`.
- **Before:** `backend/prisma.config.ts:5` prints the full `DATABASE_URL` (password included) to stdout.
- **After:** `prisma.config.ts` has no plaintext credential log.
- **Verify:** `grep -n "console.log.*DATABASE_URL" backend/prisma.config.ts` finds nothing; `npx prisma generate` (run from `backend/`) emits no password in output.

#### 05-02 Add `--force-rebuild` to the `appImages` step

- **What:** Add a `--force-rebuild` flag to the CLI's `appImages` step so source changes trigger a rebuild (the fingerprinting gap — blueprint risk #2).
- **Why:** Blueprint risk #2 — the fingerprint system cannot see source-only changes; without a nudge, a source change is silently not rebuilt. On the Ansible path this is moot (CI rebuilds every push), but the dev CLI should be forceable.
- **How:**
  1. In the `appImages` step (`infrastructure/scripts/lib/steps.js` or wherever `appImages` is defined), add `FLAGS.includes('--force-rebuild')` → always mark images stale / run the build regardless of fingerprint.
  2. Document the flag in `infrastructure-cli.md` Known gaps / the `make cli` menu help.
- **Before:** Editing `frontend/src` or `backend/src` leaves `appImages` as "done"; rebuilding must be triggered manually.
- **After:** `make step STEP=appImages FLAGS=--force-rebuild` rebuilds both images regardless of fingerprint.
- **Verify:** `make step STEP=appImages FLAGS=--force-rebuild` runs the Docker builds; a change to a hardcoded string in the frontend is reflected after the rebuild.

#### 05-03 CLI-side enforcement of the hostname-first guard (Track B)

- **What:** Same as task 01-04 (implemented in `infrastructure/scripts/init-env.js`, not in the playbook). Cross-reference only — do not re-implement.
- **Why:** Blueprint risk #1 — the guard (now extended to all IP literals via `net.isIP()`) prevents a bare-IP-first `available_hostnames` from silently breaking JWT validation on every request.
- **How:** Covered by task 01-04: extend `deriveOrigins()`'s guard, commit, and run the before/after verification there.
- **Before:** Guard blocks only loopback names.
- **After:** See task 01-04 (implemented in the CLI).
- **Verify:** See task 01-04.

---

### Phase 6 — OpenSearch schema reindex (prod)

The three schema v2 changes from `opensearch-reindex.md` were done on **dev** but **not prod**. On prod they are **still pending** (status as of the latest audit; verify at execution that prod indices still lack them).

#### 06-01 Perform the full prod reindex (analyzer + ISBN/ISSN/years)

- **What:** On the prod host: delete the `records,drafts` indices, delete pgsync's Redis checkpoints, and recreate pgsync so it rebuilds the indices with the v2 settings (accent-folding analyzer + ISBN/ISSN normalizer + years analyzer).
- **Why:** Blueprints/opensearch-reindex — both the 2026-09-25 analyzer change and the 2026-09-29 sub-field changes require a full index rebuild (`pgsync` only creates mappings when an index does not exist).
- **How:**
  1. **Delete indices:** `curl -XDELETE 'https://nbcg.me:9200/records,drafts' -u nbcg_app:<OPENSEARCH_APP_PASSWORD>` (or via `localhost` from a container with network access).
  2. **Delete checkpoints:** `docker exec nbcg-redis-1 redis-cli DEL queue:nbcg_records:meta queue:nbcg_drafts:meta`.
  3. **Recreate pgsync:** `docker compose -f docker-compose.yml -f docker-compose.ext.yml up -d --force-recreate pgsync`.
  4. **Wait** for pgsync to finish syncing (monitor `docker logs -f pgsync-1` / Redis checkpoint keys).
  5. **Check with `_count`** — not `_cat/indices` (nested `file_attachments` inflate `docs.count`).
- **Before:** Prod indices exist with v1 settings (no accent folding, ISBN as plain text, no years sub-field).
- **After:** Both indices rebuilt with v2 settings; `_count` matches Postgres row counts (roughly, allowing for nested doc inflation).
- **Verify:** `curl 'https://nbcg.me:9200/records,drafts/_count'` returns expected counts; `curl -XPOST 'https://nbcg.me:9200/records/_analyze' -d '{"text":"Nikšić"}'` returns tokens `niksic` **and** `nikšić`; `curl -XPOST 'https://nbcg.me:9200/records/_analyze' -d '{"field":"metadata.publication.year.years","text":"[ca. 1850?]"}'` returns `1850`; an ISBN filter matches `978-9940-34-341-5` → `9789940343415`.

#### 06-02 Verify the `metadata.issue.date` mapping on prod

- **What:** Ensure prod indices have `metadata.issue.date` mapped as `keyword` (a one-off mapping put on live indices before the first `issue` is saved).
- **Why:** opensearch-reindex.md — this field is needed for issue-date sorting/filtering; if it's already mapped (e.g. dynamically as `text`), a reindex would be required.
- **How:**
  1. Check: `curl 'https://nbcg.me:9200/records,drafts/_mapping/field/metadata.issue.date'`.
  2. If missing or wrong type: apply `curl -XPUT 'https://nbcg.me:9200/records,drafts/_mapping' -d '{"properties":{"metadata":{"properties":{"issue":{"properties":{"date":{"type":"keyword"}}}}}}}'`
  3. Verify again.
- **Before:** `metadata.issue.date` absent or not `keyword` on prod indices.
- **After:** `metadata.issue.date` is `keyword` on both prod indices.
- **Verify:** `_mapping/field/metadata.issue.date` returns `"type": "keyword"`; a query by issue date works.

#### 06-03 Pin the reindex as a documented one-off deploy step

- **What:** Move the reindex procedure from `opensearch-reindex.md` into `ansible-playbooks/04-postdeploy.yml` as a guarded task (or keep it as an explicit separate runbook step with an approval gate), and note whether it's a "run once" check.
- **Why:** Reproducibility — after a fresh prod deploy the indices are gone, so the reindex must be re-run; document the gate so it isn't forgotten or double-applied.
- **How:**
  1. Define a version anchor in `infrastructure/docker/pgsync/schema.json` — e.g. a top-level `"schema_version": "v2.2"` — that changes whenever mapping/analyzer settings change.
2. In `04-postdeploy.yml`, add a task `opensearch_reindex` that is gated (tags: `check_mode: false`, `when: reindex needed`).
3. The gate step: query each index (`GET records,drafts/_settings`); parse the returned `index.version` or a tag you wrote when last reindexed; compare against `schema.json`'s `schema_version` (passed in as a playbook var).
4. If they differ, run the sequence in task 06-01 (delete indices, delete checkpoints, recreate pgsync container) — reuse a shared include/role so the sequence is defined once.
5. Run a final `_count` and assert it matches Postgres (`SELECT count(*) FROM ...)` in the same ballpark, with a tolerance for nested docs.
6. Make it idempotent: a second run sees matching versions and skips.
- **Before:** Reindex is a manual, ad-hoc curl sequence.
- **After:** Reindex is a playbook task with a version check; it's idempotent (only runs when the schema version changed).
- **Verify:** A second run reports no-op; when `schema.json` changes, the task runs.

---

### Phase 7 — Security hardening (from blueprint §7 risks, P1/P2)

#### 07-01 Ensure non-empty htpasswd for admin UIs in prod

- **What:** The Ansible render must produce a non-empty `infrastructure/docker/nginx/htpasswd` with a bcrypt row for `ADMIN_UI_HTPASSWD` (sourced from vault `nbcg_admin_ui_password`).
- **Why:** Blueprint risk #9 — an empty `ADMIN_UI_HTPASSWD` produces a **credential-less** htpasswd, exposing both `/pgadmin/` and `/dashboards/` to anyone on the network. Dashboards' own security plugin is disabled, so nginx auth is the only gate.
- **How:**
  1. In `02-config.yml` (htpasswd render): `{{ nbcg_admin_ui_password | bcrypt }}` — use the `htpasswd -cbn` binary (installed in provisioning) or Python `bcrypt`. Ensure a salted bcrypt hash, not plaintext.
  2. Guard: fail the playbook if the rendered htpasswd would be empty (`assert nbcg_admin_ui_password | length > 0`).
  3. Verify the rendered file is non-empty **before** enabling prod access.
- **Before:** `ADMIN_UI_HTPASSWD` is empty in the root `.env` (dev) / unset in prod; `htpasswd` template renders a credential-less file.
- **After:** Rendered `htpasswd` contains one bcrypt row; nginx `auth_basic` on `/pgadmin/` and `/dashboards/` requires a credential.
- **Verify:** `htpasswd -cn <rendered> someuser <password>` returns true; `cat <rendered htpasswd>` shows a `$2y$...` hash, not a plaintext password; `curl -s -o /dev/null -w '%{http_code}\n' -k https://nbcg.me/pgadmin/` returns `401` without auth and `200` with correct creds.

#### 07-02 Rotate the committed plaintext DB password in pgAdmin configs

- **What:** Rotate `POSTGRES_PASSWORD` (and `KEYCLOAK_POSTGRES_PASSWORD`), regenerate `infrastructure/docker/pgadmin/servers.json` with the new password, and **remove `backend/pgadmin-servers.json` from git history**.
- **Why:** Blueprint risk #7 — `backend/pgadmin-servers.json` was committed to git (init commit cde47d2) with a plaintext password (`postgres`/`postgres`). The security audit flagged it; `docker/pgadmin/servers.json` (gitignored) contains `Password: nbcg`.
- **How:**
  1. Rotate in vault: change `nbcg_postgres_password` (and `nbcg_keycloak_postgres_password`) — **note the in-place rotation warning** (blueprint §5) — rotate on a **fresh deploy** or follow the careful in-place procedure with `ALTER ROLE ... WITH PASSWORD`.
  2. Regenerate `servers.json` from the render (it's a `conf_template` output — re-run the render step).
  3. Scrub git history: `git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch backend/pgadmin-servers.json' --all` (or use `git filter-repo`), then force-push; confirm `git log --all -- backend/pgadmin-servers.json` is empty.
  4. Add a `.gitignore` note / CI check so no `pgadmin-servers.json` can be committed.
- **Before:** `backend/pgadmin-servers.json` is in git history with plaintext `postgres` password; `docker/pgadmin/servers.json` has plaintext `nbcg`.
- **After:** No plaintext DB password anywhere in git history; `servers.json` rendered from the vault password on each deploy.
- **Verify:** `git log --all -- backend/pgadmin-servers.json` empty; `git grep -i "Password" backend/` shows only the templated `servers.conf.json` (template, not committed) and no committed password; `docker/pgadmin/servers.json` (rendered) hashes to the vault password.

#### 07-03 Review the `/api/files/:fileId/download` token-exposure endpoint

- **What:** Audit `backend/src/modules/files/` (or wherever the download route is) for the `nbcg_at` cookie usage on `/api/files/:fileId/download`, and decide whether to tighten to Bearer-only (with a refresh flow).
- **Why:** Blueprint risk #8 — this is the ONLY route accepting a JWT from a cookie (`SameSite=Lax`, `Path=/api/files`) instead of an `Authorization` header. A token in a cookie on a public download URL is more exposed (referers, logs, shoulder surfing via browser dev tools on a compromised machine).
- **How:**
  1. Locate the route (`grep -rn "download\|nbcg_at" backend/src`); confirm it's the only cookie-JWT route.
  2. Decide: (a) keep cookie auth scoped strictly to this route + add `Secure`, `HttpOnly`, tighter `SameSite`; or (b) move to Bearer-only + implement a token-refresh flow for browser downloads (preflight fetch of a short-lived bearer token via an authenticated API call, then `fetch(url, {headers:{Authorization}})`).
  3. Document the decision and the blast radius (only frontend file downloads affected).
- **Before:** Cookie-based JWT on a public download URL.
- **After:** A documented decision: either scoped cookie (Secure/HttpOnly/SameSite=strict) with rationale, or Bearer-only + refresh flow.
- **Verify:** Code review of the route + tests; `keycloak.strategy.ts:16-24` comparison showing the difference.

#### 07-04 Complete pgAdmin / Dashboards subpath routing

- **What:** Wire `X-Script-Name=/pgadmin` on pgAdmin and `server.basePath=/dashboards` + `server.rewriteBasePath=true` on Dashboards so internal links resolve under the nginx subpaths.
- **Why:** Blueprint risk #3 — both UIs are "provisional" (documented in nginx comments); links inside them break until finished. Not prod-blocking but blocks useful use of the admin UIs.
- **How:**
  1. pgAdmin (`pgadmin4-config.py` / env): set `SERVER_NAME` + `SCRIPT_NAME=/pgadmin`; nginx adds `proxy_set_header X-Script-Name /pgadmin;` and `proxy_pass http://pgadmin:80/pgadmin;` if the upstream doesn't strip it.
  2. Dashboards (`opensearch-dashboards.yml`): set `server.basePath: "/dashboards"`, `server.rewriteBasePath: true`; nginx `location /dashboards/` `proxy_pass http://dashboards:5601/dashboards/` with matching `proxy_rewrite`.
  3. Update `available_hostnames` origins so the UIs generate correct URLs.
  4. Test: open `/dashboards/app`, check a link navigates without 404; same for `/pgadmin/`.
- **Before:** `/pgadmin/` and `/dashboards/` show a blank page or broken links (404s inside the UI).
- **After:** Both UIs fully functional under their subpaths; internal links resolve.
- **Verify:** `/dashboards/app` loads and a search/list link navigates without 404; `/pgadmin/` login and server-list work.

#### 07-05 Decide the ZFS question in `config.template.yml`

- **What:** Decide whether the `zfs.base: "lib-data/"` section (and per-service datasets) in `config.template.yml` is still relevant; if the host is not ZFS (it isn't — everything uses plain Docker volumes), delete the ZFS section; if ZFS is planned, add a provisioning task.
- **Why:** Blueprint risk #11 / audit §5 (§5.2) — the config describes ZFS datasets but nothing creates or mounts them. A stale config section misleads new operators.
- **How:**
  1. Confirm the host filesystem (likely ext4/btrfs; the audit found ZFS unused).
  2. Decision: delete the `zfs:` block from `config.template.yml`; remove `lib-data/*` from root `.gitignore` if it was added solely for ZFS; remove the ZFS mention from `infrastructure-cli.md` Known gaps; update `ansible-prod-setup.md` risk #11 to "resolved: ZFS removed".
- **Before:** `config.template.yml` has `zfs.base: "lib-data/"` and a comment "in prod this should be changed to the zfs path"; root `.gitignore` has `lib-data/*`.
- **After:** No ZFS references remain; all storage is documented as Docker volumes; `.gitignore` no longer ignores `lib-data/`.
- **Verify:** `grep -rn "zfs" . --exclude-dir=node_modules --exclude-dir=.git` returns nothing; `lib-data/` (if it exists) is no longer gitignored.

#### 07-06 Decide the FQDN targets in `config.template.yml`

- **What:** Decide which of `www.`, `api.`, `auth.`, `search.` are actually needed; add the chosen ones to `available_hostnames`; create the DNS records (A or CNAME).
- **Why:** Blueprint risk #12 / audit §6 (§6.2) — these are aspirational hostnames currently only in the template; unused entries add no value but unused ones are harmless. A decision removes ambiguity.
- **How:**
  1. Decision per host: e.g. `www.nbcg.me` (CNAME → nbcg.me) — optional; `api.nbcg.me` — if a separate API entry point is wanted; `auth.nbcg.me` (CNAME → nbcg.me/auth) — if you want Keycloak at a separate hostname; `search.nbcg.me` (CNAME → nbcg.me/dashboards) — optional.
  2. Create DNS records at the registrar/Cloudflare.
  3. Add chosen hosts to `available_hostnames` **before or at the same time** as deploying TLS for them; update `config.template.yml: fqdn` section to record the decision (keep template values as comments).
  4. Update nginx `nginx.conf.template` allowlist (it derives from `available_hostnames` already — verify the derivation).
- **Before:** `config.template.yml` lists `fqdn: nbcg.me` + `www.`, `api.`, `auth.`, `search.` as aspirational; not in `available_hostnames`; no DNS records.
- **After:** Decision documented; chosen FQDNs have DNS records and are in `available_hostnames`; unused ones removed from the template or commented as "not deployed".
- **Verify:** `dig www.nbcg.me` returns the host IP; `curl -vk https://www.nbcg.me/` works; nginx 444 is not returned for the chosen hosts.

#### 07-07 Document / implement a rollback or blue-green deploy path

- **What:** Document the rollback procedure (revert `docker-compose.prod.yml` to the previous digest + `up -d`) or implement a simple blue/green (two compose projects, nginx flip).
- **Why:** Blueprint risk #4 — `docker compose up -d` restarts services; there's no zero-downtime or safe rollback today.
- **How:**
  1. Minimum: document that a rollback = `git checkout <old digest version of docker-compose.prod.yml>` + `docker compose pull` + `up -d --force-recreate`. Emphasize this is safe because images are pinned by digest.
  2. Preferred: add a `docker-compose.prod.blue.yml` / `...green.yml` pattern with an `nbcg-deploy` switch env var, nginx config serving the active project.
  3. Record in the runbook.
- **Before:** Deploy = `docker compose up -d`; rollback = manual `git checkout` + rebuild.
- **After:** Runbook documents a rollback procedure; optionally a blue/green compose layout exists.
- **Verify:** A test rollback (on dev clone) restores the previous image and the stack is healthy.

#### 07-08 Set `KEYCLOAK_PASSWORD_POLICY`/`resetPasswordAllowed` — fix the mail gap

- **What:** Decide on Keycloak password reset: configure `smtpServer` in the realm if reset is wanted, otherwise set `resetPasswordAllowed: false`.
- **Why:** Audit item P1 #8 — `resetPasswordAllowed: true` (realm line 36) with `smtpServer: {}` (line 1903) means the reset flow fails at send time — users hit an error with no indication SMTP is misconfigured.
- **How:**
  1. Decision: for now, `resetPasswordAllowed: false` (no mail server available) — document why. If SMTP should be enabled, fill `smtpServer` fields per `docker/keycloak/smtp.example.json` (already present as a template — verify its content).
  2. The realm template is rendered by the playbook — update `nbcg-realm.conf.json` accordingly.
  3. Note: `resetPasswordAllowed` only takes effect on a realm re-import; document that a fresh realm import (or `KC_IMPORT_STRATEGY=OVERWRITE_EXISTING`) is needed for the change to apply to a live realm.
- **Before:** `resetPasswordAllowed: true`, `smtpServer: {}` — reset fails at send.
- **After:** Either a working SMTP config, or `resetPasswordAllowed: false` documented.
- **Verify:** `grep "resetPasswordAllowed" infrastructure/docker/keycloak/nbcg-realm.conf.json`; if true, `smtpServer` has `host`, `port`, `from`, `enableTLS` filled; if false, documented in the runbook.

#### 07-09 Reduce backend query logging in prod

- **What:** Override the Prisma `log: ['query']` so prod does not log every query, via an env/log-level override on `prisma.service.ts` or the datasource.
- **Why:** Audit item P1 #9 — `log: ['query', 'info', 'warn', 'error']` in `prisma.service.ts:15` is very noisy in production (every query in logs — could also leak parameters).
- **How:**
  1. Option A (env): Prisma supports log levels via `process.env.PRISMA_LOG_QUERY_LEVEL`? Actually Prisma logs are configured in the datasource `log` field; override via `env` — set `NODE_ENV=production` plus a custom level. The simplest: change `prisma.service.ts` to `log: process.env.NODE_ENV === 'production' ? ['error'] : ['query','info','warn','error']`.
  2. Option B: keep the setting but ensure query **text** isn't logged at info level (the current config logs queries at info).
  3. Commit with a comment explaining the prod default.
- **Before:** Every query logged to stdout at info level in prod.
- **After:** Prod logs only errors/warnings; queries logged only in dev.
- **Verify:** `grep -n "log:" backend/src/core/prisma/prisma.service.ts` shows the conditional; a prod run does not emit query lines.

#### 07-10 Add a healthcheck for pgsync

- **What:** Add a simple liveness/health check for the pgsync service so a stuck replicator shows up in `make health`.
- **Why:** Audit item P2 #11 — pgsync has no healthcheck; a stuck replicator is invisible (the blueprint table notes "no healthcheck declared").
- **How:**
  1. pgsync doesn't expose a health endpoint; add a check that pgsync's Redis checkpoint keys are refreshed: e.g. a sidecar or `healthcheck` that verifies `queue:nbcg_records:meta` / `queue:nbcg_drafts:meta` was touched in the last N minutes (via redis-cli from within the network), or simply a `--exec` on a file timestamp that pgsync updates.
  2. Alternative minimal: `healthcheck` that runs `pg_isready`-ish check on the source DB + redis reachability (proves pgsync container is alive and its deps are reachable); note it doesn't prove replication is progressing, and document that limitation.
  3. Add to `docker-compose.yml` pgsync block.
- **Before:** pgsync block has no healthcheck.
- **After:** pgsync reports healthy/unhealthy; `make health` shows pgsync's status.
- **Verify:** `make health` (dev) shows pgsync with a health state; the healthcheck command is reviewed for false positives.

#### 07-11 Add nginx log rotation

- **What:** Configure log rotation for nginx access/error logs (nginx writes directly to the `nginx-logs` volume).
- **Why:** Audit item P2 #12 + blueprint §2.10 §3 — long-lived prod will grow the `nginx-logs` volume unbounded; no rotation today.
- **How:**
  1. Option A: bind-mount `/var/log/nginx` from the host and manage `logrotate` on the host (the volume is just the host dir).
  2. Option B: a small sidecar/logshipper that tailers the volume and ships to a log aggregator.
  3. `docker-compose.prod.yml` comment already notes this; implement it: add `logrotate` config `/etc/logrotate.d/nginx-nbcg` with daily/weekly rotation, `copytruncate`, and `postrotate` to reload nginx.
  4. Set a volume size limit on `nginx-logs` in case rotation fails (defense in depth).
- **Before:** `nginx-logs` volume grows unbounded; no rotation.
- **After:** Nginx logs rotate daily with retention; volume is bounded.
- **Verify:** `logrotate -f /etc/logrotate.d/nginx-nbcg` runs cleanly; `nginx -t`; rotated files appear in the volume.

#### 07-12 Verify host memory sizing for OpenSearch

- **What:** Confirm the prod host has enough RAM for all containers (blueprint risk #5: OpenSearch `mem_limit: 1500m` with 512m heap, plus host processes and all other containers; recommend 4–8 GB RAM for this stack).
- **Why:** Blueprint risk #5 — an under-provisioned host OOM-kills OpenSearch (and possibly host processes), which appears as a flaky service.
- **How:**
  1. Check: `free -g` or `grep MemTotal /proc/meminfo` on the prod host.
  2. Compute the sum of container `mem_limit` values from `docker-compose.prod.yml` (opensearch 1500m + the other services, typically 256–512m each, ≈ 3–4 GB total).
  3. Confirm host RAM ≥ (sum of mem_limits) + ~1 GB headroom + host process needs.
  4. Record the result and the host spec in the runbook; if insufficient, raise a server-sizing change before first deploy.
- **Before:** No documented host-sizing check; `mem_limit: 1500m` assumed safe.
- **After:** Host RAM verified sufficient; result documented in the runbook.
- **Verify:** `free -g` on prod shows enough memory; a sizing note exists in the runbook with the math.

#### 07-13 Audit docker.sock access / privilege (risk #6)

- **What:** Confirm no role grants root-equivalent socket access to the app user, and verify no component binds `docker.sock` in prod.
- **Why:** Blueprint risk #6 — mounting `/var/run/docker.sock` grants full host root-equivalent control; if present, the stack could compromise the host.
- **How:**
  1. Check on prod: `ls -la /var/run/docker.sock` — owner/group should be `root:docker`; confirm the `nbcg` app user is not in the `docker` group (unless intentionally documented).
  2. Check compose files: `grep -rn docker.sock infrastructure/docker/docker-compose.prod.yml` — should find nothing.
  3. Check sudoers: `sudo -l -U nbcg` — confirm no root-equivalent commands.
  4. Record the findings in the runbook.
- **Before:** No documented audit of socket access.
- **After:** A documented audit showing docker.sock ownership, the app user's group membership, absence of socket mounts in prod compose, and minimal sudoers.
- **Verify:** `ls -la /var/run/docker.sock`; `groups nbcg` excludes `docker`; `grep -c docker.sock infrastructure/docker/docker-compose.prod.yml` returns 0.

#### 07-14 Document the self-signed certificate decision

- **What:** Record the TLS certificate policy in `ansible-prod-setup.md`: nginx uses a public CA (Let's Encrypt); Keycloak runs on plain HTTP inside the network (no certificate of its own); OpenSearch node/admin certificates are issued by the internal project CA; the backend trusts the CA via `NODE_EXTRA_CA_CERTS`.
- **Why:** Audit P2 #15 — the deliberate self-signed choice must be documented so a future operator understands why the internal CA exists and why it is never served to public browsers.
- **How:**
  1. Add a "Certificate policy" subsection to `ansible-prod-setup.md` (append to §2.4 or add to §10) stating: public CA for nginx (Let's Encrypt); internal CA only for OpenSearch cluster trust and backend→OpenSearch TLS; Keycloak plain HTTP in-network.
  2. Document why each internal service does not need a public cert (isolated networks; nginx terminates TLS at the edge).
  3. Confirm `NODE_EXTRA_CA_CERTS` stays set on the backend (already documented in `infrastructure-cli.md`; reference it).
- **Before:** The self-signed decision is only implied; no explicit policy statement exists.
- **After:** `ansible-prod-setup.md` contains a clear certificate-policy statement.
- **Verify:** `grep -n "Certificate policy" docs/infrastructure/ansible-prod-setup.md` finds the documented decision.


---

### Phase 8 — Dev / CLI hygiene (P2)
These are dev-tooling and housekeeping tasks that run in parallel with the prod migration (they do not depend on it, and prod does not depend on them).

#### 08-01 Retire `.cli-state.json` for the prod path

- **What:** Document that the fingerprinted step state (`.cli-state.json`) is dev-only; for prod, the Ansible playbook log plus the git commit is the audit trail. Add a preflight note so the playbook never reads or depends on the state file on prod.
- **Why:** Blueprint §2.6 — the state machine has two known failure modes on prod (stale flags surviving a pull; a step that ran once silently skipping when its implementation changes). Prod has a native audit trail (git commit + playbook log), so the state file is retired there.
- **How:**
  1. Write the retirement note into `ansible-prod-setup.md` (extend §2.6: "retire `.cli-state.json` for prod; the Ansible audit trail is git + playbook logs").
  2. Add a preflight task (e.g. in `02-config.yml`) that warns if `.cli-state.json` is present on prod (do not depend on it; optionally remove it).
  3. For dev, document: reset (`make clear T=state --yes`) whenever the CLI implementation changes; add a `make state-reset` target if it does not already exist.
- **Before:** `.cli-state.json` exists; the CLI tracks prod steps in it with known staleness failure modes.
- **After:** `ansible-prod-setup.md` documents the retirement; the playbook does not depend on the state file on prod; dev has a reset mechanism.
- **Verify:** `grep -n "cli-state.json" ansible-prod-setup.md` shows the retirement note; `git grep "cli-state.json" ansible/` shows no playbook reads it.

#### 08-02 No reliance on a lone `PUBLIC_HOSTNAME` in the Ansible render

- **What:** Ensure every hostname-derived value in the Ansible render is built from `available_hostnames` (via the rendered root `.env`), and that no template uses a single `PUBLIC_HOSTNAME` variable for prod config.
- **Why:** Blueprint §2.5 — the prod host has no single "public hostname" variable; there is only the `available_hostnames` list. A lone `PUBLIC_HOSTNAME` in the render is an untested shortcut that could drift from the allowlist.
- **How:**
  1. Review `ansible/templates/` — confirm no template references `{{ PUBLIC_HOSTNAME }}`; `KEYCLOAK_URL`, `CORS_ORIGIN`, `KEYCLOAK_ISSUERS`, and nginx `server_name` come from the rendered `.env` (which itself is derived from `available_hostnames` by the `config` step / or by the render).
  2. Note in the playbook: `PUBLIC_HOSTNAME` is the CLI's internal canonical-host variable; the Ansible render must not use it directly.
  3. Document the rule in the deploy runbook.
- **Before:** Unknown — no Ansible templates exist yet; must be ensured at creation.
- **After:** No template uses `PUBLIC_HOSTNAME`; all hostname values trace to `available_hostnames`.
- **Verify:** `grep -rn "PUBLIC_HOSTNAME" ansible/templates/` returns nothing; rendered `.env` values match a manual derivation from `available_hostnames`.

#### 08-03 Verify the port map against the real config

- **What:** Validate the port map in `ansible-prod-setup.md` §10 against `master.config.json` and `docker-compose.prod.yml` so the documented firewall rules (80/443 only) are correct.
- **Why:** Blueprint §10 + §2.10 §5 — ops open firewall rules based on this map; a stale map opens the wrong ports (blueprint §10: only 80, 443, 22 inbound).
- **How:**
  1. For each service row, derive internal = the `*_INTERNAL` value and external = the `*_EXTERNAL` value from `master.config.json`; compare with the `ports` declarations in `docker-compose.prod.yml`.
  2. Confirm every prod-external column is "—" except HTTP/HTTPS (80/443).
  3. Fix any discrepancy and re-run.
- **Before:** The map may drift from the actual compose configuration.
- **After:** Every row of the map matches `master.config.json` + `docker-compose.prod.yml`.
- **Verify:** `make check ENV=prod` passes (port availability); a diff check of `ansible-prod-setup.md` §10 against `master.config.json` shows no differences.

#### 08-04 Clean orphaned images and stale artifacts

- **What:** Remove the orphaned `nbcg-tika:latest` image (leftover from the "removed tika" commit, ~1.51 GB) and any other unused local images; confirm remaining images match the version matrix.
- **Why:** Audit secondary item — reclaim disk space and avoid confusion about which images are actually in use.
- **How:**
  1. List images: `docker images -a`.
  2. Remove the orphan: `docker rmi -f nbcg-tika:latest` (dev machine; on prod only CI-pushed images exist, so no action needed there).
  3. Run `docker image prune -f` for any other dangling images; cross-check the remainder against `deploy-versions.md` / the version matrix.
- **Before:** `nbcg-tika:latest` (1.51 GB) present locally.
- **After:** No orphaned images; only images named in the version matrix remain.
- **Verify:** `docker images -a | grep -i tika` returns nothing; remaining images match the matrix.

#### 08-05 Confirm `available_hostnames` dedup and check for stale SAN entries

- **What:** Confirm `available_hostnames` has no duplicates and that no stale hostname (e.g. `nbcg.ddns.net`, which lives only in `.issued.json`) remains in issued certificates.
- **Why:** Audit secondary items — a duplicate hostname pollutes `CORS_ORIGIN`/`KEYCLOAK_ISSUERS`/realm redirect URLs; a stale SAN in an issued cert signals drift between config and issued material.
- **How:**
  1. Check for duplicates: `jq .available_hostnames | sort | uniq -d` on `master.config.json` (should be empty — the duplicate `10.10.12.1` was already deduped).
  2. Check issued material: compare `.issued.json` leaf SANs against `available_hostnames`; any entry in `.issued.json` not in the config is stale.
  3. If stale SANs are found, regenerate the nginx leaf cert (CLI `certs` step) and re-deploy; update `.issued.json`.
  4. Document the rule: `available_hostnames` and issued SANs must stay in sync.
- **Before:** Duplicate `10.10.12.1` was in config (deduped); `.issued.json` contains a stale `nbcg.ddns.net` SAN.
- **After:** No duplicates in config; every SAN in issued certs is present in `available_hostnames` (plus internal aliases like `nginx`, `localhost`).
- **Verify:** `jq .available_hostnames | sort | uniq -d` returns nothing; `.issued.json` leaves contain only hosts in `available_hostnames` (+ `localhost`, `nginx` which are internal aliases).

---

### Phase 9 — Drills (P1)

All drills assume a working Ansible deployment (Phases 0–7 complete, Phase 8 hygiene closed).

#### 09-01 Clean-redeploy drill

- **What:** Wipe all volumes + data on a **clone/test** host, run the playbook end-to-end, verify every service is healthy.
- **Why:** Blueprint §4 Phase 9 — proves the playbook provisions a server from scratch without hand-holding.
- **How:**
  1. Spin a fresh Ubuntu VM (or a clean Docker host).
  2. Provision SSH, install Docker (or let `01-provision.yml` do it).
  3. `ansible-playbook ansible/playbooks/main.yml -e "@ansible/group_vars/vault.secrets.yml"` — watch the full run.
  4. `make docker A=health` — all services healthy.
  5. Smoke test: `curl -vk https://nbcg.me/` (200), login flow.
- **Before:** Playbook only tested in `--check` mode.
- **After:** Fresh host provisioned and healthy from a single playbook invocation.
- **Verify:** Full run completes; `docker ps` shows 10/10 (or all) services `Up (healthy)`; public endpoint returns 200.

#### 09-02 Restore drill

- **What:** Take a backup, then restore to a timestamp in a separate env, verify data integrity.
- **Why:** Blueprint §4 Phase 9 + §2.7 §4 — a restore that can't be verified is a backup you can't trust.
- **How:**
  1. `ENV=prod make cron-backup` (or `./infrastructure/scripts/backup.sh`).
  2. `ENV=prod RESTIC_REPO=... ./infrastructure/scripts/restore.sh <timestamp>` on a **separate** test host.
  3. Verify: record counts match Postgres; a sample file exists in SeaweedFS; Keycloak users exist; OpenSearch counts match.
  4. Also test `--yes` (non-interactive) path.
- **Before:** Backup exists but restore has never been tested.
- **After:** A restored stack matches the backed-up state.
- **Verify:** `restic snapshots` shows the snapshot; restore completes; `docker compose ps` healthy; data comparison (`SELECT count(*) FROM ...` vs the snapshot's `backups/<env>/<timestamp>/` contents).

#### 09-03 Rebuild drill

- **What:** Delete deployed containers (or the whole compose project), re-run the playbook, verify the stack recovers automatically.
- **Why:** Blueprint §4 Phase 9 — proves the playbook (not the state of the containers) is authoritative.
- **How:**
  1. `docker compose -p nbcg down -v` (or delete containers only).
  2. `ansible-playbook ansible/playbooks/03-deploy.yml` (or full main).
  3. Wait for health; verify data persisted (volumes untouched).
- **Before:** State depends on the running containers.
- **After:** A deleted stack recovers to healthy from the repo + vault alone.
- **Verify:** Container IDs differ before/after; data identical; healthy.

#### 09-04 Certificate expiry drill

- **What:** Verify certbot renewal triggers and nginx reloads; optionally test with a staging/renewal in a scratch domain.
- **Why:** Blueprint §4 Phase 9 + task 03-05 — an unnoticed cert expiry = outage.
- **How:**
  1. `certbot renew --dry-run` — success.
  2. Check the renewal hook (systemd timer or cron) is installed: `systemctl list-timers | grep certbot` or `/etc/cron.d`.
  3. Optionally: force a real renewal on a subdomain (`certbot renew --force-renewal -d foo.nbcg.me`) and confirm nginx serves the new cert (`curl -vk https://foo.nbcg.me/` shows updated not-before/not-after).
- **Before:** No proven renewal path.
- **After:** Renewal is automatic; nginx reloads on renewal; a forced renewal produces a new cert and a 200.
- **Verify:** `certbot renew --dry-run` returns success; renewal hook exists; forced renewal yields a new cert.

#### 09-05 Verify the prod hostname allowlist state (incident follow-up)

- **What:** Confirm the prod host's current state matches the incident-fix expectation: a real hostname first in `available_hostnames`, `10.10.11.1` reachable, `10.10.12.1`/`nbcg.me` still functional, and all containers healthy.
- **Why:** The port-443 incident was fixed live by the operator; `docs/infrastructure/plans/infrastructure-todo.md` notes "final confirmation is pending". This task closes that loop and confirms the guard from task 01-04 would block a future bare-IP-first change.
- **How:** (Performed on the live host — record the result in §4's verification notes.)
  1. Check the rendered nginx allowlist, e.g. `docker exec nbcg-nginx-1 grep -o 'server_name[^;]*' /etc/nginx/conf.d/default.conf` (adjust the path to where the template renders).
  2. Confirm the first `available_hostnames` entry is a real hostname (not an IP).
  3. `curl -vk https://10.10.11.1/` — should return 200 with a real body (not 444/empty).
  4. Confirm `10.10.12.1` and `nbcg.me` still return 200 if they are still meant to (all intended addresses can coexist).
  5. `docker ps` — all containers `healthy`.
- **Before:** Incident fix applied live; final confirmation pending (per infrastructure-todo.md).
- **After:** Documented confirmation that 10.10.11.1 works and the allowlist is correct; a bare-IP-first change would now be rejected by task 01-04's guard.
- **Verify:** On prod: nginx `server_name` includes `10.10.11.1`; `curl -vk https://10.10.11.1/` returns 200 with a body (not 444); `docker ps` shows all services healthy. Record the result in `docs/infrastructure/plans/infrastructure-todo.md`.


---

### Phase 10 — Handover (P2)

#### 10-01 Document the operational runbook

- **What:** Consolidate / finalize `ansible-prod-setup.md` §5 (Operational runbook) with the actual commands used in Phases 0-9 (real vault path, real cert path, real playbook names).
- **Why:** A new operator must be able to start, deploy, rotate secrets, backup, and restore without tribal knowledge.
- **How:**
  1. Open `docs/infrastructure/ansible-prod-setup.md` §5 (Operational runbook).
2. Replace every placeholder with the real path used in Phase 4 — `ansible/playbooks/main.yml`, `ansible/inventory/hosts.yml`, `ansible/group_vars/vault.secrets.yml`.
3. Add a **Certificate renewal** subsection: `certbot renew --dry-run`; `systemctl list-timers` for the certbot timer; `certbot renew` + `docker compose reload nginx` in the renewal hook; `curl -vk https://nbcg.me/` verify (sources: task 03-05).
4. Add a **Rollback** subsection: the `git checkout` of the previous `docker-compose.prod.yml` digest + `docker compose pull` + `docker compose up -d`; confirm health (sources: task 07-07).
5. Add a **First boot walkthrough**: from a fresh server — `01-provision → 02-config → 03-deploy → 04-postdeploy → 05-backup → health`, with the expected `docker compose ps` output.
6. Cross-link each subsection back to §4 of this document (e.g. "see task 05-03 for the hostname guard").
7. Validate: walk the runbook end-to-end (at least in prose / against the clone drill from 09-01) and fix any unreachable step.
- **Before:** Runbook has placeholder commands from the blueprint.
- **After:** Runbook is a working, tested, complete guide.
- **Verify:** A fresh operator follows §5 from "install Docker" to "healthy prod" and succeeds.

#### 10-02 Record deployed image digests

- **What:** Populate `docs/infrastructure/deploy-versions.md` with the actual prod digests from the first real deployment.
- **Why:** Blueprint §4 Phase 10; audit §6 (§6.2); immutable record of what runs.
- **How:**
  1. On prod (after a clean deploy / drill): `docker images` and note the digests.
2. Confirm each: `docker inspect --format '{{.RepoDigests}}' <container>` for `frontend`, `backend`, and each pinned infra image.
3. Open `docs/infrastructure/deploy-versions.md`; paste the exact digests into the frontend/backend rows of the version matrix (§9 of the blueprint); update the date.
4. Commit: `git add docs/infrastructure/deploy-versions.md && git commit -m "deploy: record versions for <date>"`.
5. Verify: the matrix digests equal the output of `docker inspect --format '{{.RepoDigests}}'` on prod.
- **Before:** Matrix has `digest (CI)` placeholders.
- **After:** Matrix has the real digests for the running images.
- **Verify:** Matrix digests match `docker images` on prod.

#### 10-03 Document vault access procedure

- **What:** Write down who holds the Ansible vault key, how to decrypt it, and where the off-server CA backup is stored.
- **Why:** Blueprint §4 Phase 10; a vault without a documented access path is a single point of failure.
- **How:**
  1. Add a "Vault & certificate access" section to `ansible-prod-setup.md` §5.
2. Record the Ansible vault key custodians — at least two operators who each can run `ansible-vault view ansible/group_vars/vault.secrets.yml`.
3. Document the decryption command and where the vault password file / key lives (reference task 01-02; do **not** commit it).
4. Document the off-server CA backup location (from task 03-04): the secure store where `nbcg-ca.key` was copied, the decryption/verification command (`openssl x509 -in nbcg-ca.key -check -noout` or SHA-256 compare), and the access procedure.
5. Verify: a second operator (not the author) performs both decryption and CA location from the doc alone.
- **Before:** Vault key existence known to one person; no documented procedure.
- **After:** Runbook documents vault decryption and CA recovery; at least two operators can decrypt the vault and locate the CA backup.
- **Verify:** A second operator decrypts `vault.secrets.yml` from the documented procedure; locates the CA backup and verifies its hash.

#### 10-04 Archive the old CLI-prod steps

- **What:** Archive the deprecated CLI production steps (the `make setup ENV=prod` path, the fingerprinted state, the certs step) in a dedicated section of `ansible-prod-setup.md` (or a separate `archive/` doc) rather than deleting them.
- **Why:** Blueprint §4 Phase 10 + §2.1 — preserved for reference (debugging old snapshots) but clearly marked deprecated.
- **How:**
  1. Read the blueprint §2.1 "Remove from the prod path" list and §2.6, §2.7, §2.8 to enumerate the retired CLI prod mechanics: `make setup ENV=prod`, `.cli-state.json`, the `certs` step (internal CA), building images on-host via `appImages`, interactive menus, ad-hoc `osSecurity`.
2. Add a **Deprecated / legacy CLI production path** appendix to `ansible-prod-setup.md` with:
   - a `NOT FOR PROD` banner,
   - a table mapping each retired step → its Ansible replacement (e.g. `certs` → `03-05`/`05-backup.yml`, `appImages` → CI `build.yml`+digest pins, `.cli-state.json` → git+playbook log),
   - the file paths still kept on disk for dev (`infrastructure/cli.js`, `lib/steps.js`, `cli-handle.js`) noted as dev-only.
3. Verify: a new reader can see at a glance what the CLI still does (dev) vs what it must never do (prod).
- **Before:** Deprecated steps are only described inline in §2.1.
- **After:** A clearly-marked archive section exists.
- **Verify:** Section titled "Deprecated / legacy CLI production path" exists in the document.

#### 10-05 Add a CI pre-commit guard against committing secrets / pgadmin files

- **What:** Add a pre-commit hook (or a CI check) that blocks commits containing plaintext credentials or `pgadmin-servers.json`.
- **Why:** Extend risk #7 (task 07-02) — scrubbing history is not enough; prevent future commits of the same mistake (`backend/pgadmin-servers.json` with a plaintext `postgres` password was committed in the init commit).
- **How:**
  1. Add `.pre-commit-config.yaml` with a hook that scans staged files for plaintext credential patterns (e.g. `PASSWORD=\S{8,}`) — or use `detect-secrets` / `gitleaks`.
  2. Add `pgadmin-servers.json` to a blocklist via a custom hook that fails on it.
  3. Optionally add a CI step that scans the PR diff for 8+ char `PASSWORD=` / `SECRET=` / `TOKEN=` assignments.
  4. Document the guard in `CONTRIBUTING.md` / the README.
- **Before:** No guard existed; `backend/pgadmin-servers.json` (with plaintext `postgres` password) was committed in the init commit.
- **After:** A pre-commit / CI guard rejects plaintext secrets and `pgadmin-servers.json` from being committed.
- **Verify:** A test commit with a fake `PASSWORD=fakepassword123` is rejected by the hook/CI; `pgadmin-servers.json` is in the blocklist.


---

### Open decisions
These are not tasks — they are decisions that gate tasks. Each needs an explicit answer.

| # | Question | Options | Affects |
|---|---|---|---|
| Q1 | Public hostname(s) for prod: only `nbcg.me`, or also `www.nbcg.me`? | `nbcg.me` only / `www.nbcg.me` CNAME too / `api.`, `auth.`, `search.` needed | 07-06, 03-01 |
| Q2 | ZFS on the prod host? | Yes — add dataset provisioning; **No** — delete the ZFS section in `config.template.yml` | 07-05 |
| Q3 | Keycloak password reset: enable with SMTP or disable (`resetPasswordAllowed: false`)? | Enable (need an SMTP server) / Disable | 07-08 |
| Q4 | COBISS_TOKEN value: provided by NPR ops — where does it live (vault directly or external secrets store)? | Vault `nbcg_cobiss_token` / external store → proxy var | 01-06 |
| Q5 | Backup destination: local `backups/prod/` only, or off-box (`RESTIC_REPO=s3://` / `ssh://`)? | Local only / Off-box S3 / Off-box SSH | 04-05 |
| Q6 | `pgsync` health: minimal (container alive + deps reachable) or real replication-progression check (Redis checkpoint freshness)? | Minimal / real | 07-10 |
| Q7 | Download endpoint auth: keep cookie (tightly scoped, Secure/HttpOnly) or Bearer-only + refresh flow? | Keep scoped cookie / Bearer-only + refresh | 07-03 |
| Q8 | Zero-downtime: document rollback procedure only, or build a blue/green compose layout? | Document rollback / build blue-green | 07-07 |
| Q9 | Prod `KEYCLOAK_WORKER_CLIENT_SECRET` live value: has Track A (Keycloak admin-console regeneration) been run since the realm was last imported? | Yes — value known; No — must be run via Track A | 01-03 / incident follow-up |
| Q10 | Ansible vault encryption: passphrase (interactive entry) or encrypt keys (`--encrypt-key` / KMS)? | Passphrase / encrypt keys | 01-02, 10-03 |

---

### Checklist inventory

| Phase | Count | Tasks |
|---|---|---|
| 00 — Foundation | 7 | 00-01 ... 00-07 |
| 01 — Secrets & vault | 7 | 01-01 ... 01-07 |
| 02 — Images & CI | 5 | 02-01 ... 02-05 |
| 03 — TLS | 5 | 03-01 ... 03-05 |
| 04 — Ansible playbooks | 7 | 04-01 ... 04-07 |
| 05 — CLI-side fixes | 3 | 05-01 ... 05-03 |
| 06 — OpenSearch reindex (prod) | 3 | 06-01 ... 06-03 |
| 07 — Security hardening | 14 | 07-01 ... 07-14 |
| 08 — Dev / CLI hygiene | 5 | 08-01 ... 08-05 |
| 09 — Drills | 5 | 09-01 ... 09-05 |
| 10 — Handover | 5 | 10-01 ... 10-05 |
| **Total** | **66** | |

*Note on numbering:* this checklist replaces the original six-phase outline (0 Prep, 1 Secrets, 2 Images, 3 TLS, 4 Ansible, 5 Drills, 6 Handover). Supporting work became its own phases — 5 CLI-side fixes, 6 OpenSearch reindex, 7 security hardening, 8 Dev/CLI hygiene — which pushed drills to 9 and handover to 10. Phases 0–4 keep their original meaning.

---

### Verification notes

All **Before**/**After** states in this checklist were cross-checked against the repository as of 2026-10-13:

- `master.config.json` — `available_hostnames` = `["localhost","127.0.0.1","10.10.12.1","nbcg.me"]`; 9 secrets in `secrets_to_generate` incl. `KEYCLOAK_WORKER_CLIENT_SECRET`; `nginx_external: false`; `docker-compose.prod.yml` still has `build:` at lines 101/112. ✓
- `init-env.js` guard blocks only loopback — no `net.isIP` check. ✓
- `nbcg-realm.conf.json:1029` — `"secret": "$(KEYCLOAK_WORKER_CLIENT_SECRET)"` already wired (Track B template side done; live realm value still pending). ✓
- `resetPasswordAllowed: true` / `smtpServer: {}` in realm. ✓
- `backend/prisma.config.ts:5` — `console.log(process.env["DATABASE_URL"])` present. ✓
- `backend/pgadmin-servers.json` — committed to git (init cde47d2) with plaintext password. ✓
- pgsync has no healthcheck; `docker/opensearch/` is empty (no `opensearch.yml`). ✓
- `infrastructure/.gitignore` (root) has a stray `config.yml` line; `infrastructure/.gitignore` (infra/) ignores `docker/opensearch/.generated.json`. ✓
- Backup/restore scripts exist and are RESTIC-based; `RESTIC_PASSWORD` is not set in any env file. ✓
- `docker/certs/` holds the internal CA + an nginx leaf (CN=`10.10.12.1` per `.issued.json`) plus a stale `nbcg.ddns.net` SAN entry. ✓
- `config.template.yml` still carries the ZFS section + aspirational FQDNs. ✓
- The port-443 incident (10.10.11.1 missing from the allowlist) was fixed live by the operator; the `net.isIP` guard (Track B) was not applied. ✓

This checklist is a superset of §7's 12 risks and `infrastructure-audit.md`'s P0–P2 list, with every item expanded into actionable, verifiable tasks.

---

## 5. Operational runbook (for ops after Ansible is live)

**Start the stack:**

```sh
ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/main.yml -e "@ansible/group_vars/vault.secrets.yml"
```

**Health check:**

```sh
make docker A=health    # or: docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

**Deploy a new image version (after CI push):**

```sh
ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/03-deploy.yml \
  -e "backend_image=ghcr.io/nbcg/backend@sha256:<new-sha>" \
  -e "frontend_image=ghcr.io/nbcg/frontend@sha256:<new-sha>"
```

**Rotate a secret (e.g. POSTGRES_PASSWORD):**

1. Change it in `ansible/group_vars/vault.secrets.yml`.
2. `ansible-playbook ... 02-config.yml` — renders a new `.env`.
3. **Critical — changing the password in `.env` does NOT rotate the password stored in the database.** The official Postgres image applies `POSTGRES_PASSWORD` only during `initdb` of an **empty** data directory; on an existing volume the stored role password is unchanged, so the stack would fail to authenticate. **Fresh server** (Phase 5 clean deploy, volume wiped): init runs with the new password and everything works. **In-place rotation**: after rendering the new `.env`, you must also apply the new password to the DB roles (e.g. `ALTER ROLE postgres WITH PASSWORD '<new>'` and `ALTER ROLE nbcg ...` for each role) or re-init the cluster from a dump. This is the single most dangerous operation; **back up first** (`make cron-backup`), and test in dev before prod.

**Backup (cron):** `ENV=prod BACKUP_DIR=/var/backups/nbcg/prod make cron-backup` — or better: `./infrastructure/scripts/backup.sh` directly from the server cron with `RESTIC_REPO=s3://...` for off-box copies.

**Restore:**

```sh
# 1. Ensure docker + docker compose are installed and the compose files are in place.
# 2. Point to the repo used at backup time (same version of the compose files).
ENV=prod RESTIC_REPO=/path/to/repo ./infrastructure/scripts/restore.sh <timestamp>
# 3. Verify:
make docker A=health
```

**Troubleshooting:**

- Stack won't start → `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f <service>`.
- Keycloak login loops → check `KEYCLOAK_URL` equals the URL the browser used (first `available_hostnames` entry + `/auth`).
- 444 on a host → that hostname is not in `available_hostnames`; add it to `master.config.json`, then run the config step and regenerate certs — **do not** `docker compose restart` (config won't be re-read; use `up -d --force-recreate nginx`).
- OpenSearch security plugin errors → run `04-postdeploy.yml` (the securityadmin step).

---

## 6. File inventory (where everything lives)

| Path | Purpose | Prod? | In git? | Managed by |
|---|---|---|---|---|
| `docker-compose.yml` | Base compose (all services, shared logging, volumes) | yes | no (generated) | CLI copy from `infrastructure/docker/`; Ansible copies from repo |
| `docker-compose.prod.yml` | Prod overlay (networks, build→image, paths, TLS mounts) | yes | yes | — |
| `docker-compose.dev.yml` | Dev overlay (port publishing, start-dev) | no | yes | — |
| `docker-compose.ext.yml` | External apps (nbcg-external) | no | yes | — |
| `infrastructure/env/.env.shared` | Common keys | both | yes | Ansible (prod) / CLI |
| `infrastructure/env/.env.prod` | Prod overrides + backup vars | yes | yes | Ansible (rendered) |
| `infrastructure/env/.env.dev` | Dev overrides | dev | yes | CLI |
| `.env` (root) | Root env (ENV + secrets) | both | **no** (.gitignore) | CLI (dev) / Ansible (prod) |
| `infrastructure/master.config.json` | Ports, hostnames, secrets list, templates, routing | both | yes | — |
| `infrastructure/master.config.template.json` | Template for `master.config.json` drift check | both | yes | — |
| `infrastructure/docker/certs/ca/*` | Internal CA (OpenSearch trust root) | prod (CA only) | no (.gitignore) | old: CLI `certs` step; new: Ansible |
| `infrastructure/docker/certs/nginx/*` | nginx leaf (legacy internal cert) | **retire** | no | **remove** for prod |
| `/etc/letsencrypt/live/nbcg.me/*` | Production nginx TLS (Let's Encrypt) | prod | no | certbot |
| `infrastructure/docker/nginx/nginx.conf.template` | nginx routing template with allowlist | both | yes | Ansible renders |
| `infrastructure/docker/nginx/htpasswd.template` | admin UI basic auth | both | yes | Ansible renders |
| `infrastructure/docker/keycloak/nbcg-realm.conf.json` | Keycloak realm template | both | yes | Ansible renders |
| `infrastructure/docker/opensearch/opensearch.yml` | OpenSearch TLS config | prod | no (.gitignore) | Ansible renders |
| `infrastructure/docker/pgadmin/servers.json` | pgAdmin server conf | prod | no (.gitignore) | Ansible renders |
| `infrastructure/scripts/backup.sh` | Backup (RESTIC) | both | yes | — |
| `infrastructure/scripts/restore.sh` | Restore (RESTIC) | both | yes | — |
| `infrastructure/.secrets.prod.json` | **Retire** — intermediate secrets store | prod | no (.gitignore) | removed by Ansible |
| `infrastructure/.cli-state.json` | **Retire for prod** — fingerprinted step state | dev | yes (per infra/.gitignore) | removed from prod |
| `infrastructure/.gitignore` | Excludes generated + secret files | both | yes | — |
| `backups/<env>/<timestamp>/` | RESTIC snapshots | both | no (.gitignore) | backup.sh |

---

## 7. Known gaps and risks to track

1. **`available_hostnames[0]` must be a real resolvable hostname — never a bare IP — in prod.** The backend reaches Keycloak internally (JWT validation via `jwks-rsa`'s `jwksUri`, `keycloak.strategy.ts:66`; and user-directory sync via the worker secret at `keycloak-admin.service.ts:48-51,162`, tracked in `docs/infrastructure/plans/keycloak-internal-routing-fix.md`) through nginx's network alias, which is keyed on `PUBLIC_HOSTNAME` = `available_hostnames[0]` (`init-env.js:141` — the canonical host; alias defined at `docker-compose.prod.yml:33`, applied at `:82,85`). Docker never DNS-resolves an IP literal, so an IP in first position makes the backend silently target a raw address instead of the alias → both call sites fail with `fetch failed`. A guard exists in `init-env.js:149` but only for loopback strings (`["localhost","127.0.0.1","::1"]`); extend it to reject any `net.isIP(canonicalHost)` (see Track B in `docs/infrastructure/plans/keycloak-internal-routing-fix.md`). Rule of thumb: first entry = real DNS name; LAN IPs only in later positions for direct browser access. A bare-IP first entry will silently break JWT validation on every request.
2. **`appImages` fingerprinting gap** (documented in `steps.js`) — source changes don't trigger a rebuild; on the Ansible path this is moot because CI builds from the repo every push. Still worth fixing in the CLI: add a `--force-rebuild` flag.
3. **pgAdmin / Dashboards subpath routing is "provisional"** — documented in nginx comments; complete the `X-Script-Name` / `SERVER_REWRITEBASEPATH` work in nginx before relying on those UIs in prod.
4. **No rolling updates / zero-downtime** — `docker compose up -d` restarts services; for zero-downtime deploys add a blue/green stage or move to a single-node Kubernetes (k3s) / Nomad later.
5. **`mem_limit` vs host memory** — OpenSearch `mem_limit: 1500m` with 512m heap assumes the host has enough RAM for host processes + all containers. Size the server accordingly (recommend 4–8 GB RAM for this stack).
6. **`docker.sock` access / privilege** — no component binds `docker.sock` in prod; the `app` actions (pm2, host processes) don't apply. Confirm no role grants root-equivalent socket access to the app user.
7. **`pgadmin-servers.json` contains a plaintext DB password that was committed** — the security audit flagged it; rotate `POSTGRES_PASSWORD`, regenerate `servers.json`, and confirm the file is not in git history. (The file is at `docker/pgadmin/servers.json` and `backend/pgadmin-servers.json`; the latter was committed and is flagged.)
8. **Token exposure surface on the download endpoint** — `/api/files/:fileId/download` is the ONLY route that accepts a JWT from a cookie (`nbcg_at`, `SameSite=Lax`, `Path=/api/files`) instead of an `Authorization` header (`keycloak.strategy.ts:16-24`); this is intentional for browser-native loads, but a token present in a cookie on a public download URL is more exposed than header auth. Keep the scope strictly limited to this route and review whether Bearer-only auth (with a refresh flow) is feasible.
9. **htpasswd for the admin UIs must be non-empty in prod.** nginx puts `auth_basic` on both `/pgadmin/` and `/dashboards/`, but renders the row from `ADMIN_UI_HTPASSWD` only — an empty value produces a **credential-less** htpasswd (confirmed in dev logs: "ADMIN_UI_HTPASSWD is empty — wrote a credential-less htpasswd"), exposing both UIs. The Ansible render must source a bcrypt row from vault; verify the rendered `infrastructure/docker/nginx/htpasswd` is non-empty before enabling prod access. Dashboards' own security plugin stays disabled (`DISABLE_SECURITY_DASHBOARDS_PLUGIN: true`), so nginx auth is the only gate.
10. **DB password printed on prod boot** (`prisma.config.ts`) — ensure the prod `.env` doesn't leak into logs; the CLI prints reconciled passwords only to the CLI stdout, which is a concern if logs are collected — document whether prod logs are redacted.
11. **zfs (`lib-data/`) referenced in `config.template.yml`** — check whether ZFS is actually used; if yes, include ZFS pool mount in provisioning; if no, delete the reference.
12. **FQDN targets in `config.template.yml`** (`fqdn: nbcg.me`, `www.`, `api.`, `auth.`, `search.`) — these are aspirational hostnames. Decide which to actually provision and add each to `available_hostnames`; add `www.nbcg.me`, `api.nbcg.me`, `auth.nbcg.me`, `search.nbcg.me` DNS CNAMEs or A records accordingly.

---

## 8. Secrets — full list

Every secret below must be in `ansible/group_vars/vault*` and nowhere else.

| Secret | Producer | Consumer |
|---|---|---|
| `POSTGRES_PASSWORD` | vault (deterministic) | `db`, pgsync |
| `KEYCLOAK_POSTGRES_PASSWORD` | vault | `keycloak-db`, pgAdmin |
| `KEYCLOAK_ADMIN_PASSWORD` | vault | Keycloak bootstrap |
| `KEYCLOAK_WORKER_CLIENT_SECRET` | vault | backend UserSyncService (wired up after the initial audit — confirm present) |
| `PGADMIN_DEFAULT_PASSWORD` | vault | pgAdmin |
| `OPENSEARCH_INITIAL_ADMIN_PASSWORD` | vault | OpenSearch bootstrap |
| `OPENSEARCH_APP_PASSWORD` | vault | backend, pgsync (`nbcg_app`) |
| `OPENSEARCH_DASHBOARDS_PASSWORD` | vault | Dashboards (`kibanaserver`) |
| `ADMIN_UI_PASSWORD` | vault | nginx htpasswd (pgAdmin + Dashboards basic auth) |
| `COBISS_TOKEN` | vault (external) | backend external API |
| `RESTIC_PASSWORD` | vault | backup/restore scripts |

---

## 9. Version matrix (pin everything)

Record here after each deploy. Update every release.

| Service | Image (prod) | Pinned tag / digest |
|---|---|---|
| postgres | `postgres` | `18.3` |
| pgadmin | `dpage/pgadmin4` | `9.12.0` |
| valkey/redis | `valkey/valkey` | `9.2` (was `redis:8.6.1` — AGPLv3/RSALv2/SSPLv1; see `docs/shared/license-audit.md`) |
| keycloak | `quay.io/keycloak/keycloak` | `26.5.4` |
| pgsync | `toluaina1/pgsync` | `@sha256:3dad547f2f428db79302fa807bc3ea438186a2ff63b364f52ed6a29420f1b547` |
| opensearch-node | `opensearchproject/opensearch` | `3.5.0` |
| opensearch-dashboards | `opensearchproject/opensearch-dashboards` | `3.5.0` |
| seaweedfs master | `chrislusf/seaweedfs` | `4.23` |
| seaweedfs volume | `chrislusf/seaweedfs` | `4.23` |
| nginx | `nginx` | `1.29.5-perl` |
| frontend | `ghcr.io/nbcg/frontend` | **digest (CI)** |
| backend | `ghcr.io/nbcg/backend` | **digest (CI)** |

---

## 10. Port map (firewall rules)

Only **80** and **443** are inbound on the host. All others are Docker-internal only.

| Service | Internal | Prod external | Dev external |
|---|---|---|---|
| Postgres (app) | 5432 | — | 15432 |
| Keycloak DB | 5432 | — | 25432 |
| Keycloak | 8080 | via nginx `/auth/` | 8082 |
| pgAdmin | 80 | via nginx `/pgadmin/` | 8081 |
| Redis | 6379 | — | 6379 |
| OpenSearch node | 9200 / 9600 | — | 9200 / 9600 |
| OpenSearch Dashboards | 5601 | via nginx `/dashboards/` | 5601 |
| SeaweedFS master | 9333 / 19333 / 9324 | — | 9333 / 19333 / 9324 |
| SeaweedFS volume | 8080 / 18080 / 9325 | — | 8083 / 18083 / 9325 |
| nginx | 80 / 443 | **80, 443** | (host proxy) |

---

*Document last reviewed: 2026-10-13. This is a living document — update it whenever a change in §2, §4, or §8 is made.*
