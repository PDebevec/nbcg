# Infrastructure Audit — Findings & To-Do List

Date: 2026-10-07
Scope: `infrastructure/` tree, dev and prod provisioning paths, plus cross-references to backend/frontend config it produces.
Method: read-through of all scripts/configs, `make check` for both envs, `state.spec.js` (32/32), `make list`, config diff, and an isolated scratch run of the full prod provisioning pipeline (`env` → `config` → `certs` → `opensearch.yml`).

---

## 1. Overall state

- **Dev environment: healthy and fully running.** The stack has been up 4+ days, 10/10 containers healthy (9 healthy + pgsync which has no healthcheck declared), both apps online under pm2. All four shared setup steps (`env`, `config`, `fbEnd`, `applyConf`, `dockerFilesCopied`) are done **and current**.
- **Prod environment: never provisioned.** All prod setup steps are `false`. The CLI is fully capable of provisioning it (verified end-to-end in a scratch copy), but it has never been run against prod, and the state file contains stale/inconsistent records.
- **State machine: sound.** The v2 fingerprint-based system (state tests 32/32) correctly distinguishes envs, detects drift, and prevents a `git pull` from masquerading as a deploy.

## 2. Verification results

| Check | Result |
|---|---|
| `state.spec.js` | 32 passed, 0 failed |
| `make check ENV=dev` | All prerequisites satisfied |
| `make check ENV=prod` | All prerequisites satisfied |
| `make config A=diff` | `master.config.json` matches template |
| `make clear T=list` | env ✓, compose ✓, templates ✓; certs –, secrets –, config (matches) |
| Prod provisioning pipeline (scratch) | `env` → `config` → `certs` → `opensearch.yml` — all succeed |
| `make docker A=ps` / `make health` (dev) | 10/10 running, 9 healthy |
| Generated configs for leftover placeholders | None found |

## 3. Dev environment

- **Status:** fully provisioned, 4+ days uptime, healthy.
- **Services:** db, redis, opensearch-node (healthy), opensearch-dashboards (healthy), keycloak, keycloak-db, pgadmin (healthy), master/volume (SeaweedFS, healthy), pgsync (no healthcheck), plus frontend/backend running on the host via pm2 (both online).
- **TLS in dev:** OpenSearch security plugin **disabled** (`DISABLE_SECURITY_PLUGIN=true`), so no OpenSearch certificates are generated and no admin accounts exist. This is the documented dev configuration — expected.
- **Secrets in dev:** plaintext weak secrets (e.g. `OPENSEARCH_INITIAL_ADMIN_PASSWORD=VelikiPassword1!`, passwords = `nbcg`). Expected and intentional — the dev `.env.dev` comments explain exactly why each is relaxed; these never leave the machine.

## 4. Prod environment — what's missing

**Prod has never been run through the setup pipeline.** Every prod setup step is `false`:

| Step | Current | Notes |
|---|---|---|
| `env` | false | root `.env` has `ENV=dev`; no prod `.secrets.prod.json` store |
| `config` | false | |
| `fbEnd` | false | no `frontend/.env` / `backend/.env` from infra |
| `applyConf` | false | `docker/nginx/nginx.conf` and `pgadmin/servers.json` on disk are the **dev**-rendered versions (password `nbcg`) |
| `certs` | false | no CA, no nginx, no opensearch leaves exist |
| `osSecurity` | false | `docker/opensearch/opensearch.yml` **does not exist** |
| `dockerFilesCopied` | false | |
| `appImages` | false | |

Consequences and inconsistencies to clean up once prod is provisioned:

1. **Stale `docker/certs/.issued.json` stamp** — describes nginx/opensearch certificates that were never written (or were deleted). It's a leftover artifact; the `certs` step is `false`, so it's inert but misleading.
2. **Inconsistent `osSecured` flag** — the state shows `steps.osSecured` as done-with-fingerprint for prod, but `opensearch.yml` (what that flag is keyed on) is missing. The fingerprint will evaluate as "not current", which is the system doing its job, but the step flag itself is from an old run and should be reset when prod is re-provisioned.
3. **`docker/opensearch/` directory is empty.** `opensearch.yml` is only created by the `osSecurity` step, which depends on `certs` — neither has run.
4. **The generated nginx.conf on disk (`docker/nginx/nginx.conf`) is the dev rendering** — it will be regenerated on `applyConf` for prod (self-signed leaf for the prod hostname). Nothing is wrong with it; it just belongs to dev.

### The prod path is verified to work

In an isolated scratch copy I ran the whole prod provisioning chain:

1. `initEnvironment('prod')` — reuses the 9 secrets, writes root `.env` ✓
2. `applyMasterConfig('prod')` — derives `KEYCLOAK_URL`, `CORS_ORIGIN`, `OPENSEARCH_URL` with TLS credentials ✓
3. `generateCertificates()` — creates the CA + nginx + opensearch-node + opensearch-admin leaves (PKCS#8, SANs, 825-day leaves) ✓
4. `generateNodeConfig()` — writes `opensearch.yml` with TLS + derived admin DN ✓

Two gates were confirmed working:
- A prod run **refuses** to derive `KEYCLOAK_URL` when the first `available_hostname` is `localhost`/`127.0.0.1`/`::1` (containers can't reach Keycloak that way) — with a clear message pointing at `master.config.json`.
- `--rotate` on the prod `env` step mints new secrets and warns that existing volumes still hold the old ones; `reconcileProdCredentials()` (invoked by `make docker A=up`) fixes credentials automatically on start.

## 5. Known gaps (documented in `infrastructure-cli.md`) + newly surfaced

### 5.1. Backup mechanism — absent (highest production risk)

`scripts/backup.sh` / `restore.sh` were removed when the CLI was rewritten and never rebuilt. `RESTIC_REPO`/`RESTIC_PASSWORD` exist in `.env.prod` (empty) and `Makefile`'s `cron-backup`/`cron-restore` targets still call those missing scripts.

This means: **no backup of the Postgres, Keycloak, OpenSearch, pgadmin or SeaweedFS volumes exists.** A lost host = total data loss. Nothing is more prod-critical than this.

### 5.2. ZFS dataset provisioning — not implemented

`config.template.yml` describes a `zfs.base: "lib-data/"` and per-service datasets for prod, but nothing in the repo creates or mounts ZFS datasets. Everything is plain Docker volumes. The comment even says "in prod this should be changed to the zfs path".

### 5.3. No real certificate (intentional for testing)

`certificates.nginx_external` is `false`; everything uses the self-signed CA. The docs' Known-gaps note covers this. **Given your note that prod is used for testing, staying self-signed is a deliberate and fine choice** — provided the alternative (dropping a real fullchain/privkey in and flipping the flag) is understood. No change needed unless you want Let's Encrypt / a real CA in the loop.

### 5.4. Admin-UI subpath routing is provisional

`/pgadmin/` and `/dashboards/` are behind HTTP basic auth over TLS (good), but serving either correctly under a subpath needs more of their own config (pgAdmin `X-Script-Name`, Dashboards `server.basePath` agreement with nginx). Links inside them will break until finished. Minor, but worth closing.

### 5.5. Keycloak password reset has no mail server

`resetPasswordAllowed` is on but `smtpServer` is `{}` in the realm — the reset flow fails at the point of sending mail. Either configure SMTP in the realm or disable the feature.

### 5.6. Backend logs every query

`log: ['query', …]` in `prisma.service.ts` — very noisy in production. A runtime log-level flag or env override would clean it up.

### 5.7. OpenSearch index changes pending for production

From `docs/infrastructure/opensearch-reindex.md` — the schema v2 rollout did **dev** but not **prod**:
- Accent-folding analyzer change (2026-09-25) — needs a full index delete + checkpoint reset + pgsync recreate.
- ISBN/ISSN normalized sub-field + publication year tokenizer (2026-09-29) — same procedure.
- `metadata.issue.date` as `keyword` — a one-off mapping put on live indices before the first `issue` is saved.

All three need the same procedure on prod; `opensearch-reindex.md` documents it.

### 5.8. Newly discovered during this audit

| Item | Severity | Notes |
|---|---|---|
| Duplicate hostname in `available_hostnames` | low (cleaned) | `10.10.12.1` appeared twice after it was promoted to canonical; `CORS_ORIGIN`/`KEYCLOAK_ISSUERS` contained the duplicate. Deduped — `master.config.json` still matches the template. |
| `.gitignore` references `docker/opensearch/.generated.json` | trivial | That file doesn't exist anywhere; stale ignore entry. |
| `nbcg.ddns.net` in `.issued.json`, not in config | low | DNS drift — the stack ran with ddns.net, now uses `nbcg.me` (which resolves today to a Cloudflare IP). Worth confirming the intended public host. |
| `nbcg.si` historically failed DNS | low | Seen in 2026-10-03 logs; another DNS iteration. |
| `COBISS_TOKEN` empty | prod blocker | External COBISS/IZUM imports silently fail. Must be set in `.env.prod` before imports. |
| `pgsync` has no healthcheck | minor | Can't be reported as healthy/unhealthy by `make health`; a stuck pgsync is invisible. |
| nginx logs have no rotation | minor | nginx writes directly to a volume (`/var/log/nginx`) with no logrotate; long-lived prod will grow that volume. |

## 6. Prioritized to-do list

### P0 — Production readiness (blocking)

1. **Decide the public hostname** and ensure it resolves from the host (`/etc/hosts` is enough for testing; real DNS for go-live). Note `nbcg.me` resolves today — confirm it's the intended one.
2. **Set production secrets**: `COBISS_TOKEN` in `.env.prod` (imports otherwise silently fail); confirm `KEYCLOAK_BASE_PATH=/auth` matches your deployment; keep `KEYCLOAK_SSL_REQUIRED=external` and hardening set as-is.
3. **Run the prod pipeline once** (`make setup ENV=prod` then `make docker A=up`, then `make health`). This creates CA + certs + `opensearch.yml`, builds images, and starts the stack. `up` self-heals credentials on retry.
4. **Configure OpenSearch security** (`make docker A=os-secure` or let `up` do it) — this removes the image's shipped demo accounts with published hashes. Required, not optional.
5. **Restore or replace the backup mechanism** — implement RESTIC-based `backup.sh`/`restore.sh` wired to `make cron-backup`/`cron-restore`. This is the single most important improvement for a production system.

### P1 — Harden and complete prod

6. **Close the OpenSearch reindex backlog** (schema v2): analyzer + ISBN/ISSN reindex + `metadata.issue.date` mapping, per `docs/infrastructure/opensearch-reindex.md`.
7. **Provision ZFS datasets** if the host is ZFS-based (`config.template.yml`), per your architecture (`zfs.base` comment).
8. **Fix Keycloak password reset**: configure `smtpServer` or set `resetPasswordAllowed: false`.
9. **Reduce backend query logging** in prod (env/log-level override on `prisma.service.ts`).

### P2 — Polish

10. **Fix admin-UI subpath routing** (`/pgadmin/`, `/dashboards/`) so internal links resolve.
11. **Add a liveness-ish check for pgsync** so a stuck replicator is visible in `make health`.
12. **Add nginx log rotation** (stdout symlink or sidecar, as noted in `docker-compose.prod.yml` comments).
13. **Clean up stale state artifacts** on first prod run: the `.issued.json` stamp and the `osSecured` flag inconsistency will reconcile themselves once `certs`/`osSecurity` run, but verify afterward.
14. **Remove the stale `.gitignore` line** for `.generated.json`.
15. **Document the self-signed-cert decision** briefly (a sentence in the certs section is enough) since prod deliberately uses them.

## 7. Things that work well (worth preserving)

- Environment isolation by design: `name:` prefixes (`dev-nbcg` vs `nbcg`), per-env state fingerprints, secrets store outside the root `.env`.
- The fingerprint system: a `git pull` cannot silently be "deployed", and prod can never inherit dev progress.
- `reconcileProdCredentials()` + automatic restart of unhealthy containers on `up`: credentials never go stale after a secret rotation.
- The `auth` network isolates Keycloak so trusting `X-Forwarded-Host` is safe; split-horizon DNS alias for the backend to reach the public Keycloak URL.
- No leftover placeholders in any generated config; `master.config.json` tracks the template (drift detection via `make config`).
- State machine tests pass and stay in sync with lib contents (test `every lib file is either hashed or explicitly excluded`).

## 8. Questions before proceeding

1. **Public hostname for prod:** `nbcg.me` resolves today (Cloudflare IP) — is that the intended deploy host, or do you want to pin a specific IP via `/etc/hosts` for testing? The `.issued.json` record of `nbcg.ddns.net` and the old failed `nbcg.si` suggest hostnames have moved.
2. **Do you want a real certificate in prod, or confirm self-signed stays?** You noted prod is used for testing, which explains the self-signed CA — confirming this is a deliberate choice.
3. **Backup policy:** what retention do you want for RESTIC (local path, frequency, destination — e.g. off-box / remote repo)? The Makefile targets exist but the scripts are gone.
4. **ZFS:** is the prod host a ZFS host? If so, who owns creating/maintaining the datasets described in `config.template.yml`?
5. **SMTP for Keycloak:** should password reset be enabled (needs an SMTP server config) or disabled?
6. **pgsync:** do you want a health/liveness check added so stuck replication is visible?
7. **Order of work:** do you want me to (a) write the backup implementation first, or (b) run the prod provisioning (`make setup ENV=prod`) first and validate it? These are independent and either order is fine, but I want to match your priority.
