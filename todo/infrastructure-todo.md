# Incident: `10.10.11.1:443` returning no payload

## Status

- **Root cause identified and confirmed** — matches what you diagnosed independently.
- **You applied a fix live in production** while this investigation was running (outside this session — this session made no changes, read-only only, as instructed).
- Your initial check confirms `10.10.11.1` is now working.
- **Final confirmation is pending.** You asked to wait and report back on whether it happens again / stays working — this document reflects that; nothing below should be read as "still broken."
- **Separate issue, investigated at your request:** the backend's `KEYCLOAK_WORKER_CLIENT_SECRET is not set` error (originally surfaced as secondary finding #1 below) — root cause found, see the dedicated section below. Not yet fixed; this needs a manual step in Keycloak plus a config change, both still to be done.

---

## Context

You reported `https://10.10.11.1:443` returning nothing — no payload — and asked for a read-only investigation (this is production; no fixes were to be made in this session) into the running Docker stack, with a concrete plan written to this file. Two parallel investigations were run: one against the codebase/config (`infrastructure/README.md`, compose files, nginx/Keycloak config), one against the live host (`docker ps`, container logs, port/listener checks, a direct `curl` against the endpoint). Both converged on the same root cause independently.

---

## Investigation summary

**This was never a crash or outage.** All 13 containers (`nginx`, `backend`, `frontend`, `keycloak`, `keycloak-db`, `db`, `redis`, `opensearch-node`, `opensearch-dashboards`, `pgadmin`, `pgsync`, `seaweedfs` master/volume) were `Up ... (healthy)`, `RestartCount: 0`. Port 443 was listening on the host (`ss -tlnp`, confirmed via `docker-proxy` processes bound to the `nginx` container's IP). A plain-HTTP request to port 443 correctly got nginx's own `400 The plain HTTP request was sent to HTTPS port` — proof nginx itself was alive and responsive.

The TLS request specifically was the only thing going silent:

```
$ curl -v --max-time 8 https://10.10.11.1:443/ -k
* TLSv1.3 (IN), TLS handshake, Certificate (11)
*  subject: C=ME; ST=State; L=City; O=NBCG; OU=IT; CN=10.10.12.1
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
> GET / HTTP/1.1
> Host: 10.10.11.1
* TLSv1.3 (OUT), TLS alert, decode error (562)
curl: (56) OpenSSL SSL_read: ... unexpected eof while reading, errno 0
```

TCP connects, TLS handshake completes, the request is sent — then nginx closes the connection with **zero HTTP bytes**. That's `curl`'s exact symptom description of "returning nothing."

## Root cause

**Hostname allowlist mismatch.** This host's real NIC address (`ens18`) is `10.10.11.1/8` (`ip addr`). But the entire stack was provisioned — as of the `2026-08-16` setup run (`infrastructure/log/2026-8.log`) — for `10.10.12.1` + `nbcg.me` only:

| File | Value found |
|---|---|
| `infrastructure/master.config.json:2` | `"available_hostnames":["10.10.12.1", "nbcg.me"]` |
| `.env` (generated) | `PUBLIC_HOSTNAME=10.10.12.1`, `ALLOWED_HOSTNAMES_SPACED=10.10.12.1 nbcg.me`, `CORS_ORIGIN=https://10.10.12.1,https://nbcg.me`, `KEYCLOAK_URL=https://10.10.12.1/auth`, `KEYCLOAK_ISSUERS=[...10.10.12.1..., ...nbcg.me...]` |
| `infrastructure/docker/nginx/nginx.conf:96` (generated) | `server_name 10.10.12.1 nbcg.me;` — the only names nginx will serve |
| TLS leaf cert (`docker/certs/nginx/server.*`) | `CN=10.10.12.1`, issued by the project's own internal CA |
| `infrastructure/docker/keycloak/nbcg-realm.json` | `redirectUris`/`webOrigins` pinned to `https://10.10.12.1/*`, `https://nbcg.me/*` |

`nginx.conf` carries a deliberate catch-all (`nginx.conf.template`, lines 82-88):

```nginx
# HTTPS: catch-all for any Host header that isn't in available_hostnames.
#
# Keycloak trusts X-Forwarded-Host to build its own URLs (dynamic hostname
# mode)... That is only safe if nothing but a genuinely configured hostname
# can ever reach it: without this block, a spoofed Host header would make
# Keycloak issue tokens/reset-password links for a domain the attacker chose.
server {
    listen 443 ssl default_server;
    server_name _;
    return 444;
}
```

`return 444` is nginx-speak for "close the connection, send nothing" — this is **an intentional anti-spoofing control**, not a bug in itself. It exists because Keycloak is configured with `KC_HOSTNAME_STRICT: false` + trusts `X-Forwarded-Host` (needed so login works from any of several configured hostnames) — the nginx allowlist is what makes trusting that header safe. The problem was purely that `10.10.11.1` — this host's actual address — was never in the allowlist, so it fell through to this block. The live nginx access log caught it happening in real time:

```
2026-08-26T15:57:53Z 10.10.11.1 ... "GET / HTTP/1.1" 444 0 ... "curl/8.14.1"   ← test request, dropped
2026-08-26T15:34:38Z 172.20.0.2 ... "GET / HTTP/1.1" 200 3057 ...              ← healthcheck (matches allowlist), served fine
```

## The documented fix mechanism (for the record / to cross-check against what you applied)

`infrastructure/README.md` documents `available_hostnames` as *the single place hostnames are configured*, and states every entry becomes "a fully working way to reach the app — login included, not just browsing." Adding an entry is supported, expected operation (not a hack):

1. Add `10.10.11.1` to `available_hostnames` in `infrastructure/master.config.json`.
2. `make step STEP=config ENV=prod` — merges it into the root `.env` (`ALLOWED_HOSTNAMES`, `CORS_ORIGIN`, `KEYCLOAK_ISSUERS` all regenerate to include it).
3. `certs` step reissues the nginx leaf certificate with the new SAN — the README notes this happens **automatically**: "Leaves are reissued automatically when `available_hostnames` or the subject changes" (the CA itself is untouched/reused).
4. Deploy the regenerated config. **README's explicit warning, worth double-checking against however you applied this**: *"`docker compose restart` does not re-read configuration... After changing anything in `.env` or a compose file, use `up -d --force-recreate <service>` (or the menu's 'Start (up)')."* — a plain `docker restart`/`compose restart` would leave the old allowlist active and silently look like nothing happened. If your fix used `make up` or the CLI's "Start (up)" menu option, this is a non-issue.
5. Keycloak's realm `redirectUris`/`webOrigins` regenerate from the same `available_hostnames` list, so login from `10.10.11.1` should work end-to-end, not just static asset loading.

Files this touches: `infrastructure/master.config.json`, generated `.env`, generated `infrastructure/docker/nginx/nginx.conf`, `infrastructure/docker/certs/nginx/server.*`, `infrastructure/docker/keycloak/nbcg-realm.json`.

## Suggested verification (whenever convenient — not urgent, since you've already checked it once)

- [ ] `curl -v https://10.10.11.1/` returns `200` with a real body (not `444`/empty)
- [ ] Full login through Keycloak works from `10.10.11.1` (no `invalid_redirect_uri`) — this exercises a different code path than static asset loading
- [ ] `10.10.12.1` and `nbcg.me` still work too, if they're still meant to (confirm both/all intended addresses are simultaneously valid — `available_hostnames` supports multiple)
- [ ] nginx access log shows `200`s (not `444`s) for real traffic on `10.10.11.1`
- [ ] `docker ps -a` still shows all containers healthy after the change

---

## Backend error: `KEYCLOAK_WORKER_CLIENT_SECRET is not set`

You asked me to look at this one specifically. Full root cause below.

### What's failing

Backend log, identical on every restart since first boot (2026-08-16) through tonight:

```
ERROR [UserSyncService] User directory sync failed: KEYCLOAK_WORKER_CLIENT_SECRET is not set —
the user directory cannot sync. It must match the nbcg-worker secret in the realm.
```

`UserSyncService` (`backend/src/modules/users/user-sync.service.ts:36-38`) is, by its own doc comment, **"the only code in the system permitted to write `user_profiles`. A user appears in that table because they exist in Keycloak *and* a sync ran — never as a side effect of request traffic."** Since the sync has failed on every single boot with no exception, this is not cosmetic log noise — the app's user directory (whatever picker/assignment UI reads `user_profiles`) has almost certainly been empty for all 10 days this has been in prod. I tried a read-only `SELECT count(*) FROM user_profiles` to confirm the row count directly; that specific action (`docker exec` into the db container) was blocked by this session's permission settings, so it's unconfirmed — worth running yourself — but the code comment alone makes "likely empty" a safe read.

### Why the secret is missing

Two independent gaps, both needed for this to work, neither exists:

1. **Nothing generates or supplies a value.** `infrastructure/master.config.json`'s `secrets_to_generate` (the list the CLI auto-generates and persists to `infrastructure/.secrets.prod.json`) has 8 entries — `POSTGRES_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, etc. — `KEYCLOAK_WORKER_CLIENT_SECRET` isn't one of them. Checked for version drift (the README's documented "template gained a setting, local config silently lacks it" failure mode) — ruled out: `master.config.template.json` has the exact same 8 entries. It was simply never added, template or instance.
2. **Even if generated, nothing would route it to the backend.** `env_routing.backend.vars` in the same file lists `KEYCLOAK_URL`, `KEYCLOAK_ISSUERS`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` — no `KEYCLOAK_WORKER_CLIENT_SECRET` entry, so it would never reach the container's environment even if it existed elsewhere.

On the Keycloak side, `infrastructure/docker/keycloak/nbcg-realm.conf.json:1033` defines the `nbcg-worker` client with:

```json
"clientAuthenticatorType": "client-secret",
"secret": "**********",
```

That's a literal ten-asterisk placeholder, not a `${VARIABLE}` substitution like every other secret in this file — never wired into the templating system. The generated `nbcg-realm.json` carries the identical literal value, meaning **the actual secret Keycloak holds for this client right now is almost certainly the literal string `**********`** — whatever got imported when the realm was first created on 2026-08-16.

This reads as a genuine incomplete rollout — the `UserSyncService` feature was built and wired to expect this secret, but the infra side of provisioning it was never finished. Not drift, not something introduced by tonight's changes.

### Blast radius

Checked what else depends on this client/secret before scoping a fix — only `KeycloakAdminService` (`backend/src/core/keycloak/keycloak-admin.service.ts:51`) reads `KEYCLOAK_WORKER_CLIENT_SECRET`, and `UserSyncService` is its only caller. The realm client's own description mentions "e.g. COBISS import worker" as an example use case, but grepping the COBISS import code (`backend/src/modules/import/cobiss/`) shows no reference to this client or to `KeycloakAdminService` — COBISS import is unaffected either way. This fix is scoped to exactly one feature: the user directory / people picker.

### Fix (two tracks)

**Track A — fix the running system (this is the actual fix; needed regardless of Track B):**
1. In Keycloak's admin console (or via the Admin REST API): **Clients → `nbcg-worker` → Credentials → regenerate secret.** Routine, targeted operation on the already-running realm — does **not** require a realm reimport/recreation (which would risk existing users/sessions). Note: Keycloak skips reimporting the realm on boot when it already exists (seen in tonight's startup logs: "realm import skipped, already exists") — so Track B's template fix alone would never reach the live client anyway; this manual step is required either way.
2. Set that same value as `KEYCLOAK_WORKER_CLIENT_SECRET` in the backend's environment (root `.env` for now, since `env_routing` isn't wired for it yet — see Track B).
3. Recreate the backend container so it picks up the new env var — same gotcha as the nginx fix: plain `docker compose restart`/`restart` won't re-read `.env`; needs `up -d --force-recreate backend`.
4. Verify: next boot's log has no `KEYCLOAK_WORKER_CLIENT_SECRET is not set` error, and `user_profiles` row count is > 0 after a sync runs.

**Track B — close the gap so it can't silently regress on a future rebuild (dev environment, or this one rebuilt from scratch):**
1. Add `KEYCLOAK_WORKER_CLIENT_SECRET` to `secrets_to_generate` in `master.config.template.json` (and the local `master.config.json`), so the CLI generates and persists a real random value the same way it does the other 8 secrets.
2. Add it to `env_routing.backend.vars` so it's actually routed into the backend's environment.
3. Replace the literal `"secret": "**********"` in `nbcg-realm.conf.json` with `"secret": "${KEYCLOAK_WORKER_CLIENT_SECRET}"` so the realm template substitutes the real value like the rest of the file does.
4. This only takes effect on environments provisioned fresh after the change (or a deliberate realm re-import) — it will not retroactively fix the currently-running realm, hence Track A is still required regardless.

Suggest Track A now — it's the actual fix and it's a small, well-scoped Keycloak console action plus one env var. Track B whenever there's room for non-urgent infra cleanup. Neither has been applied; both are write actions I'd need your go-ahead for once we're out of plan mode.

---

## Other secondary findings from this investigation (open — not scoped or prioritized yet)

These also surfaced incidentally while diagnosing the port-443 issue and haven't been actioned:

1. **Postgres credentials logged in plaintext**: the backend logs its full Postgres connection string, including password, to stdout on every boot/restart — a log-hygiene / secrets-exposure issue worth redacting.
2. **Possible direct internet exposure**: nginx access log shows what look like public IPs (`93.103.28.113`, `51.159.23.43`) hitting port 443 directly, and the host's `10.x` NIC carries an unusually broad `/8` netmask rather than a typical `/24`. Separately, `nbcg.me` resolves to Cloudflare edge IPs (`172.67.167.45`, `104.21.35.13`, and IPv6 `2606:4700:...`) — so the public hostname is proxied through Cloudflare, which does *not* explain those two IPs hitting the origin directly (they aren't Cloudflare's ranges). Worth a firewall/NAT review to confirm whether direct exposure is intentional.
3. **`infrastructure/.cli-state.json` bookkeeping looks stale**: it recorded `"docker": {"containarized": false}` and `"migrate": false` even though containers were demonstrably up and migrated at the time of the check — could cause the CLI to make wrong decisions on a future run.
4. **Orphaned `nbcg-tika:latest` image (1.51GB)**, left over from the "removed tika" commit — stale, harmless, reclaimable disk space (`df -h` showed 35G/60G available, so no urgency).

---

## Follow-up

Per your request: this session will hold here and wait for you to confirm whether the port-443 issue recurs or the fix holds. No further checks against the production host were run in this session after you said you were fixing it live, other than the read-only digging into the `KEYCLOAK_WORKER_CLIENT_SECRET` error you asked me to look at (config/code reads, plus one blocked `docker exec` attempt — no changes made).

Open items awaiting your call, nothing applied yet:
- Confirmation that `10.10.11.1` keeps working (and whether `10.10.12.1`/`nbcg.me` still need to keep working too).
- Go-ahead on the `nbcg-worker` Keycloak secret fix (Track A above) — a Keycloak admin-console credential rotation plus one env var, both outside what this session can do in plan mode.
- Whether/when to tackle Track B and the four other secondary findings.
