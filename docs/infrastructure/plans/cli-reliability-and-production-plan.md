# NBCG CLI Reliability & Production Readiness Plan

**Status:** Phase 0 (Foundation, tasks A1–A6) **implemented and proven**
2026-10-15 — 42 specs green, all Phase 0 gate proofs executed (concurrency,
stale-up refusal, truth sync, health honesty, verified `up`). Remaining
phases (B–G) are proposals awaiting go-ahead.
**Scope:** make the infrastructure CLI reliable alongside out-of-band operations, add safe
self-repair, add verified config/app updates with revert, add a real verification/testing
subsystem, and close the production gaps. Aligns with (does not replace)
`docs/infrastructure/ansible-prod-setup.md`, which stays the blueprint for the remote prod path.

---

## 1. Architecture decision (first, because everything follows from it)

**Recommendation: keep Ansible as the sole remote build/send/deploy/test path; harden the CLI
as the local + day-2 operations tool; share one codebase of renderers, probes and gates between
them.** This is the standard split and it matches your blueprint's own premise ("the CLI is a
local dev machine orchestration tool… deliberately not the prod deployment path").

| Concern | Lives in | Why |
|---|---|---|
| Host provisioning, firewall, TLS, vault secrets | Ansible (`ansible/playbooks/01/02-…`) | remote, idempotent, auditable, no node/npm on server |
| App images | CI → GHCR, digest-pinned | server never builds (`appImages` needs Node) |
| Config rendering | **one shared renderer** — `run.js config --emit` used by both the CLI and `02-config.yml` | prevents CLI/Ansible render divergence (biggest long-term risk of running two paths) |
| Acceptance gate | **one shared verifier** — `run.js verify --json` | `03-deploy.yml`/`04-postdeploy.yml` call it; local `make verify` is the same code |
| Deploy + auto-revert algorithm | same manifest format on both sides (`deploys.jsonl`) | local `make update` and Ansible `03-deploy.yml` read/write the same ledger |
| Day-2 local ops: drift, repair, update, rollback, health | CLI (`make doctor/verify/config/update/rollback`) | what this plan implements |
| Backup/restore | `backup.sh`/`restore.sh` (done) — called by CLI *and* Ansible `05-backup.yml` | already shared |

If you later decide the CLI should never touch prod at all, nothing in this plan is wasted:
WS-A…WS-E are local-dev reliability; WS-F swaps the shared gates into Ansible.

---

## 2. Current state assessment

**Strengths to preserve**

- Fingerprint staleness system (`lib/fingerprint.js`): inputs/outputs/implementation hashed,
  three-state `done/stale/not-run` with reasons, cascade invalidation — genuinely good.
- Per-env state, atomic state writes, environment not switched until a run succeeds.
- Credential reconciliation around prod `up` (`reconcile-utils.js`), secrets never on argv.
- Backup/restore round-trip verified (5 restic snapshots, `restic check` clean).
- Menus: entries disabled-with-reason, every action reports outcome.

**Gaps this plan closes** (all verified in code)

| # | Gap | Evidence |
|---|---|---|
| G1 | **No drift detection.** Raw `docker compose up/down/stop` leaves `.cli-state.json` lying; `containarized` is write-only (nobody reads it). Already bit you: `plans/infrastructure-todo.md` #3 records `containarized:false` while containers were up. | `run.js:170-171` writers only |
| G2 | **Dispatcher ungated:** `run.js docker up` does not check `dockerFilesCopied` currency (the interactive menu does) — can `up` stale root compose files. | `cli-handle.js:140,177` vs `run.js:162-180` |
| G3 | **No locking** — concurrent runs race on `.cli-state.json` (load once, read-modify-write). | no lockfile anywhere |
| G4 | **No `--dry-run`** on any mutating command. | grep: none |
| G5 | **Health = a `compose ps` table.** No independent probes (HTTP/DB/ES/auth), `health` flag fingerprint is `null` (never stales), and it is marked done even when no containers exist. | `db-utils.js:129-167`, `fingerprint.js:265-267`, `run.js:173` |
| G6 | **No update/rollback.** No image digest recording, no deploy ledger, no revert; `appImages` blind to source changes (documented). | `steps.js:162-167` |
| G7 | **Migrate has no backup gate**, no post-verify, no documented failure path. | `db-utils.js:66-123` |
| G8 | **Flags set unconditionally** (`osSecured` on any prod `up`, `health` on any run). | `run.js:173-174` |
| G9 | CLI `up` does not wait for healthy (only `backup.sh`/`restore.sh` do). | `run.js:162-180` |
| G10 | **No test runner** for infra code (`state.spec.js` run by hand; no `npm test`, no CI). | `infrastructure/package.json` |
| G11 | Config apply = blind rewrite of `.env` and rendered files; no diff preview on the apply path, no history, no revert, full-stack bounce for any change. | `init-env.js:83,251-292` |
| G12 | Known prod gaps from your own docs: plaintext `DATABASE_URL` logging, hostname-IP guard, empty-htpasswd risk, committed pgAdmin password, no monitoring/sentinel, backups not yet off-box. | `ansible-prod-setup.md §7`, `plans/infrastructure-todo.md` |

---

## 3. Design principles (safety rules for self-repair)

1. **Report → Plan → Apply.** New commands default to read-only; mutation requires an action
   word (`repair`, `apply`, `update`) and honors `--dry-run` (which prints the exact plan).
2. **Repair tiers** — `doctor` may only auto-do Tier 1:
   - **Tier 0 (always safe, always read-only):** report drift, staleness, probe results, state lies.
   - **Tier 1 (auto-repair with `A=repair`, never touches data):** resync state flags from
     reality, re-run stale steps (existing cascade), re-copy stale compose outputs, restart
     unhealthy containers, `compose up -d` to reconcile created-vs-config mismatch, wait-for-healthy.
   - **Tier 2 (confirm or explicit flag):** rebuild/pull images, run migrations, `down` (no -v),
     anything that rewrites secrets or rendered config outside a step re-run.
   - **Tier 3 (never automatic, interactive only):** `down -v`, volume removal, secret rotation,
     `docker system prune`, state reset.
3. **Every mutating run:** holds the repo lock, appends to `infrastructure/log/YYYY-M.log`,
   records history in `.cli-state.json`, and ends with a verify pass.
4. **Anything that changes data is preceded by a backup** (restic snapshot) or an explicit
   `--skip-backup` (refused in prod).
5. **Revert, never guess:** apply paths write previous versions to `.config-history/<ts>/` and
   record a `deploys.jsonl` entry first, so every failure has a known return path.
6. **Migrations are the one-way door:** no automatic `migrate down`; the protection is
   backup-before + old-image rollback + documented manual recovery.

---

## 4. Workstreams, tasks, expected outcomes

Priority: **P0** = foundation/correctness, **P1** = core value, **P2** = nice-to-have.
Size: S ≤ half-day, M 1–2 d, L 3–5 d.

### WS-A — Foundation: make the CLI truthful and safe (all P0)

| ID | Task | Expected outcome | Size |
|---|---|---|---|
| A1 | **Run lock.** `lib/lock.js`: `flock`-style lockfile (pid, host, timestamp, stale-TTL) acquired by `run.js` on any mutating command and by `backup.sh`/`restore.sh` (shell `flock` on same file). Second concurrent run fails fast with "held by pid N since T" (or `--wait`). | Two simultaneous `make` runs can never interleave state writes or docker ops; state file can never lose an update. Lock is released on exit/crash (stale detection by pid). | S |
| A2 | **`--dry-run` flag** wired through `runner.js` for `setup/step/config/docker/app/clear` (and later `doctor/update`): each action prints what it *would* do (commands, files written, services restarted) and exits 0. | Every mutating operation is inspectable first; safe to run in prod/CI previews. | M |
| A3 | **Truth-derived docker flags.** On state load (or in `reconcile`), recompute `containarized` from live `docker compose ps`; stop trusting stored value. Keep writing it only as a cache. | `.cli-state.json` can never contradict `docker compose ps`; the todo.md #3 incident class becomes impossible. `make list` shows reality. | S |
| A4 | **Gate the dispatcher like the menu.** `run.js docker up/create/build` refuse when `dockerFilesCopied` (or `fbEnd/applyConf`) is stale, naming the stale step; `--force` bypasses with warning. | Out-of-band or scripted `up` can no longer run against stale root compose files — the exact class of bug that made valkey ephemeral on Oct 15. | S |
| A5 | **Honest flags.** `health` set only when probes ran and passed (with `null`→real fingerprint or explicit "point-in-time" semantics documented); `osSecured` only when `configureSecurity()` actually executed in this run; "no containers" health run no longer marks done. | State flags mean what they say; `make list`/menus stop showing phantom `done`. | S |
| A6 | **Wait-for-healthy after `up`.** Extract the wait loop from `backup.sh` into the shared verify lib (B1) and call it from `run.js docker up` (timeout + per-service report, `--no-wait` opt-out). | `make docker A=up` ends in a verified statement ("all healthy in 41s" or a named list of failures), never a silent half-start — including the restart-loop case that valkey exposed. | S |

### WS-B — Verification & testing subsystem (`make verify`) — P0/P1

| ID | Task | Expected outcome | Size |
|---|---|---|---|
| B1 | **Probe library `lib/probe-utils.js`.** Layers: (1) config validity — yaml parse + `compose config` for base+ext, both envs; (2) containers — `ps -a` states/health; (3) service probes — HTTP `GET /` (frontend), `GET /api/health` (backend, exists at `health.controller.ts`), Keycloak realm endpoint, OpenSearch `_cluster/health` (TLS-aware), Valkey `PING`, Postgres `select 1`, seaweedfs, pgadmin ping; (4) data gates — migration drift (`_prisma_migrations` rows vs `backend/prisma/migrations/` dirs), htpasswd non-empty, cert expiry days, disk-space threshold. | One library answers "is it healthy and why not" with per-probe latency, retries and timeouts; no probe trusts another layer's opinion. | L |
| B2 | **`make verify` / `run.js verify`.** Runs all layers, prints a report (PASS/WARN/FAIL per probe + summary), `--json` for machines, exit code 0/1/2 (clean/degraded/down). | One command usable by humans, cron, CI, and as the Ansible gate. Catches "up but broken" states `compose ps` cannot. | M |
| B3 | **Smoke suite** (scripts under `infrastructure/scripts/smoke/`, invoked by `verify --smoke`): Keycloak token issuance → authenticated backend call → search query → (prod) asset fetch through nginx with correct Host → admin-UI basic-auth gate responds 401-without/200-with. | Routing/auth regressions of the `10.10.11.1:444` incident class are caught automatically, not by user report. | M |
| B4 | **Test wiring.** `npm test` in `infrastructure/` running all `*.spec.js` via `node --test`; new specs for lock, repair tier rules, probe parsers, deploy-manifest; add CI workflow running it. | Infra code changes are regression-tested before they can break a deploy; `state.spec.js` no longer orphaned. | M |
| B5 | **Sentinel cron** (`make verify --json >> log` + non-zero → alert file/mail): optional, prod-recommended. | Failures are noticed without anyone running anything. | S |

### WS-C — Self-repair (`make doctor`) — P1

| ID | Task | Expected outcome | Size |
|---|---|---|---|
| C1 | **`make doctor` (report).** One screen: stale steps with reasons, state-vs-reality lies (A3), live container drift (config hash vs running), probe results (B1/B2), repairability column (Tier auto / needs-confirm / manual). | After any out-of-band `docker` fiddling or `git pull`, one command explains exactly what diverged and what the CLI can safely fix. | M |
| C2 | **`make doctor A=repair`.** Executes Tier 1 only: resync flags, re-run stale steps (existing cascade machinery), re-copy compose outputs, restart unhealthy, `compose up -d` reconcile, wait-for-healthy. Prints the plan first; `--yes` skips the pause. | The stated goal — "self repair as long as it is safe and reliable": `stop`/`down`/`up`/`rm` by hand, stale flags, stale compose copies → one command returns to a consistent, verified state **without touching volumes, secrets, or data**. | M |
| C3 | **Tier guards + audit.** `doctor` refuses Tier 2/3 actions with instructions; every repair appends an `HISTORY` entry with what was changed. | Repair is predictable and auditable; nothing destructive can be automated by accident. | S |
| C4 | **Doctor tests.** Fixture-driven: planted stale state, planted flag lie, stopped container → assert report lines and (with repair) assert safe-only actions chosen. | The safety rules are provable, not aspirational. | M |

### WS-D — Config update flow (`master.config.json` → everything) — P1

| ID | Task | Expected outcome | Size |
|---|---|---|---|
| D1 | **`make config A=apply [--dry-run]` (plan/apply).** Render new values for root `.env`, app `.env`s, templates, compose copies into `.config-staging/<ts>/`; diff against current; show per-variable change **and the affected services**; on apply: move current outputs to `.config-history/<ts>/`, write staged, re-run only affected steps. | Editing `master.config.json` becomes a reviewable operation: you see the diff and blast radius before anything changes. | L |
| D2 | **`make config A=revert [n]`.** Restores the previous history entry, re-runs affected steps, restarts affected services, verifies. | A bad config change is undone by one command with verification. | S |
| D3 | **Var→service dependency map** (small static table: ports → nginx+apps, `KEYCLOAK_*` → keycloak+backend, `OPENSEARCH_*` → opensearch+backend+pgsync, …). | Apply/revert restart only what actually depends on changed keys — no full-stack bounce for one port tweak. | S |
| D4 | **Validation before apply** (extend `make check` + hook into `D1` preflight): hostname-IP guard (`net.isIP` on `available_hostnames[0]` — Track B), non-empty `ADMIN_UI_HTPASSWD` in prod, template match, secrets audit report (`PASSWORD/SECRET/TOKEN` inventory, vault coverage). | The known incident classes (bare-IP first hostname, credential-less htpasswd, unvaulted secret) are blocked *before* apply, not discovered in production. | M |

### WS-E — Update & rollback for the running app/env — P1 (core of "update anything… revert on error")

| ID | Task | Expected outcome | Size |
|---|---|---|---|
| E1 | **Deploy ledger** `infrastructure/log/deploys.jsonl`: `{id, env, ts, gitSha, images:{svc:digest}, configHash, migrations:{applied,pendingBefore}, verifyResult, status: planned|applied|verified|reverted|failed}`. | Every update is addressable and has a recorded "last known good" to return to. | S |
| E2 | **`make update` orchestration** (`run.js update`): preflight (`check` + `verify` baseline + staleness plan) → lock → **mandatory backup** (`backup.sh`, `--skip-backup` refused in prod) → plan printed (config diffs, images to pull/build, pending migrations) → apply in order: render config → copy compose → build/pull (digest-pinned where defined) → `compose up -d` → migrate (E4) → **verify gates (B2)** → record `verified` or trigger E3. | One command updates "anything in the env — config, database, ES, API, frontend" with a printed plan, a backup, and machine-checked acceptance. | L |
| E3 | **Auto-revert on failure.** Restore `.config-history/<pre>` + pre-apply compose copies → `compose up -d` pinned to the **previous image digests** recorded in the ledger → re-run verify → final report states both versions and what failed. Never attempts `migrate down`. | A failed update leaves the stack running the previous known-good version with an explicit explanation — the requested "in case of some error revert back". | L |
| E4 | **Migration safety in `update`/`migrate`.** Before `prisma migrate deploy`: restic snapshot (dev: at least `pg_dump`), print pending migration list; after: verify schema version + app probes. On failure: old app image is already the rollback target; document manual recovery (`migrate reset` from snapshot) in the report. | Database changes are recoverable without guessing; the one-way door has a documented path. | M |
| E5 | **Base-image updates.** At apply, record running digests of *all* services (not just app images); upstream image bumps (postgres/opensearch/…) are pinned in compose by digest once pulled; revert = repin previous digest. | Even infrastructure-image updates are revertible. | M |
| E6 | **Close the `appImages` blind spot:** `--force-rebuild` flag (already flagged in your blueprint as 05-02) **plus** cheap source detection at `update` preflight only (sha of `git ls-files frontend/src backend/src` vs last recorded in ledger — not in menu repaints). | Shipping app-code changes never silently skips a rebuild; menu performance unchanged. | S |
| E7 | **Dev pm2 path:** document + thin wrapper: dev rollback = `git checkout <ledgerSha>` + `make app A=restart` + `verify`. No image machinery for host processes. | Dev has an equivalent (documented) recovery story without over-engineering. | S |

### WS-F — Prod/remote path (Ansible) — recommendations, mostly aligning with your blueprint

Keep `ansible-prod-setup.md` as the authoritative checklist; these are the additions/decisions
this plan proposes on top of it:

| ID | Task | Expected outcome | Size |
|---|---|---|---|
| F1 | **Single renderer for both paths.** Add `run.js config --emit <dest> --env prod` (pure function: inputs → rendered files, no state mutation) and have `02-config.yml` invoke it instead of Ansible templates re-implementing interpolation. | CLI and server can never disagree about what a config should render to; one code path to fix. | M |
| F2 | **Shared gate in playbooks.** `03-deploy.yml`/`04-postdeploy.yml` run `run.js verify --json --gate prod` (node is a controller-side dependency, not on the server — run via `delegate_to: localhost` against the target's published endpoints, or copy the static probe script). Playbook fails ⇒ automatic redeploy of previous digests (same ledger file kept at `/var/lib/nbcg/deploys.jsonl`). | Prod deploys get the same acceptance criteria and the same auto-revert semantics as local. | M |
| F3 | **Images: CI-only, digest-pinned** (your phases 02-01…04) — confirmed as the sole build path; CLI `appImages` stays dev-only. | Server never needs Node/npm; deploys are reproducible by digest. | (blueprint) |
| F4 | **Secrets: vault only** (your §2.2) — `.secrets.prod.json` retired from prod path; dev keeps local generation. | No plaintext on server; rebuild-deterministic passwords preserve volumes. | (blueprint) |
| F5 | **Prod day-2 sentinels (add to blueprint):** (a) systemd timer → `run.js verify --json` with alert on non-zero; (b) backup cron with `RESTIC_REPO` **off-box** (s3/ssh) + monthly restore drill into a scratch dir; (c) certbot renewal hook → `verify` cert probe; (d) log rotation audit (compose `logging` driver max-size on every service); (e) host patch + image rebuild cadence (weekly CI rebuild, monthly base-image bump via `make update` dry-run review); (f) resource guards — disk threshold in `verify`, OOM-kill scan in `doctor`. | The unattended-server failure modes (full disk, expired cert, failed backup, OOM, silent drift) all have a detector and a documented response. | M |
| F6 | **Fold your P0 gaps into this plan's Phase G** (below): hostname guard, htpasswd, plaintext log redaction, pgAdmin password rotation, `nbcg-worker` secret fix. | One prioritized list instead of two docs. | — |

### WS-G — Hardening & hygiene (shortcomings found) — P1/P2

| ID | Task | Expected outcome | Size |
|---|---|---|---|
| G-a | Redact `DATABASE_URL`/passwords from backend logs (`prisma.config.ts`, CLI reconcile prints) — your 05-01 + `todo.md` finding #1. | No secrets in collected logs. | S |
| G-b | Hostname guard: reject `net.isIP(available_hostnames[0])` (Track B). | Bare-IP first entry impossible → JWT-validation incident class gone. | S |
| G-c | Render refuses to produce an empty prod htpasswd (fail loud). | Admin UIs can never come up credential-less. | S |
| G-d | Rotate pgAdmin committed plaintext password; purge from git history; regenerate `servers.json`. | Known committed secret closed. | S |
| G-e | `nbcg-worker` Keycloak secret fix (Track A of todo.md). | Worker auth broken since incident is closed. | S |
| G-f | Orphan/`prune` report in `doctor` (e.g. the 1.5 GB `nbcg-tika` image) — report-only, Tier 2 to delete. | Disk junk visible, never auto-deleted. | S |
| G-g | Docs: update `infrastructure-cli.md` (new commands, doctor/verify/update sections, repair-tier table) + `ansible-prod-setup.md` cross-links. | Docs match reality after each phase lands. | S |

---

## 5. Phasing (order & dependencies)

| Phase | Contents | Gate to next phase |
|---|---|---|
| **0 — Foundation** | A1–A6 (lock, dry-run, truth flags, gating, honest flags, wait-for-healthy) | `npm test` green; two concurrent runs proven safe; stale-`up` refused |
| **1 — Verify** | B1–B4 (probes, `make verify`, smoke, tests) | `make verify` exit codes correct against: healthy stack / stopped stack / broken config / stopped db |
| **2 — Repair** | C1–C4 (`doctor`, `A=repair`, guards, tests) | Y1 scenario suite passes (see §6) |
| **3 — Config apply** | D1–D4 (staging/diff/history/revert, var→svc map, preflight validation) | Y3: edit → plan → apply → revert demonstrated end-to-end |
| **4 — Update & rollback** | E1–E7 | Y4: injected failure during update auto-reverts to verified previous version |
| **5 — Ansible integration** | F1, F2, F5 (rest is your existing blueprint) | playbook `--check` + real dry-run on clone passes with shared gate |
| **6 — Hardening** | G-a…G-g | all doc'd P0/P1 gaps closed |

Phases 5–6 can start in parallel with 2–4 (different files, no coupling).

---

## 6. Global expected outcomes (acceptance criteria)

1. **Y1 — out-of-band operations are survivable:** after any mix of raw
   `docker compose stop/down/up`, container `rm`, hand-edited root compose, or `git pull`,
   `make doctor` reports exactly what diverged (with reasons), and `make doctor A=repair`
   returns the system to a consistent, verified state with **zero** changes to volumes,
   secrets, or database data; `.cli-state.json` never contradicts reality.
2. **Y2 — health is proven, not assumed:** `make verify` distinguishes *config invalid /
   container down / probe failing / data drift*, in human and JSON form, with exit codes safe
   for cron/CI/Ansible; smoke suite catches routing/auth regressions.
3. **Y3 — config changes are reviewable and reversible:** `master.config.json` edit →
   `make config A=apply` shows a variable-level diff and restart set → applies only affected
   services → `make config A=revert` restores the previous behavior.
4. **Y4 — updates are safe by construction:** `make update` = preflight → backup → plan →
   apply → verify; any failure auto-reverts to the previous known-good version (config +
   image digests) and reports; `make rollback <deploy-id>` is available manually; migrations
   never run without a backup.
5. **Y5 — concurrency-safe:** overlapping CLI/backup runs queue or fail cleanly; no state
   corruption possible.
6. **Y6 — tested:** `npm test` covers the new safety logic and runs in CI; every new mutating
   command supports `--dry-run`.
7. **Y7 — prod path:** server deploys go CI → registry → Ansible with the shared verify gate
   and shared revert ledger; secrets only in vault; backups verified off-box with a periodic
   restore drill; no interactive CLI dependency on the server.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| CLI vs Ansible render divergence | single `--emit` renderer (F1) — one source of truth |
| Auto-revert complexity causes double-fault | revert = restore recorded history + repin recorded digests only; never invent; verify after revert; rehearse in dev first (E4 tests) |
| `doctor` overreaches into destructive action | hard tier table + default report-only + fixture tests asserting safe-only actions (C3/C4) |
| Probe false negatives (slow startup, timing) | per-probe timeout/retry/start-grace; `start_period` respected; degraded vs down distinction (exit 2) |
| Migrations unrecoverable | backup gate + old-image rollback + documented manual recovery; never auto `migrate down` |
| Scope explosion | phases are independently shippable; Phase 0 alone already fixes the classes of bugs you hit (stale-up, lying state, restart-blind health) |

## 8. Out of scope (recorded, not planned)

- Blue/green or k3s/Nomad for zero-downtime (your gap #4) — revisit after Phase 4 if
  downtime windows become unacceptable; the ledger/gate design ports to either.
- ZFS datasets, full metrics stack (Prometheus/Grafana) — sentinels only (F5).
- Keycloak SMTP/password reset, pgAdmin/Dashboards subpath routing — tracked in
  `infrastructure-cli.md` Known gaps.
- Remote-hosting details (inventory, hardening values) — owned by `ansible-prod-setup.md`.

## 9. Open decisions (defaults proposed — flag if you disagree)

1. `make update` backup gate: **on by default**, `--skip-backup` allowed in dev only. 
2. Verify from cron: **recommended for prod (F5), optional in dev (B5)**.
3. Deploy ledger location: **`infrastructure/log/deploys.jsonl`** locally, `/var/lib/nbcg/`
   on servers (gitignored both places, captured by `backup.sh` runtime-config copy).
4. Repair default: **`make doctor` is report-only forever; `A=repair` is always explicit.**
