# Plan: backend → Keycloak internal connectivity breaks when `available_hostnames[0]` is a bare IP

## Status

- **Not yet implemented — plan only, per your request.** Nothing in this document has been applied.
- Triggered by a live log line: `[UserSyncService] User directory sync failed: fetch failed`
  (2026-08-27 05:50:36). Root cause below is **confirmed**, not just suspected — the code that
  breaks already has a comment describing this exact failure mode (see "Root cause").
- Scope is larger than the log line suggests: the same broken path is also used by **JWT
  validation on every authenticated API request**, currently masked by an in-memory cache. See
  "Blast radius" — this is worth prioritizing above the user-sync fix.

## Context

Two things happened in sequence:

1. Earlier this session, `KEYCLOAK_WORKER_CLIENT_SECRET` was wired up end-to-end (generated,
   routed to the backend, reconciled into the live Keycloak client) to fix
   `UserSyncService`'s `KEYCLOAK_WORKER_CLIENT_SECRET is not set` error — see
   `todo/infrastructure-todo.md`. That fix worked: the secret is now present, and the code gets
   past that check.
2. Getting past that check exposed a **different, pre-existing** problem one step later: the
   actual network call to Keycloak now fails with `fetch failed`.

Separately, `infrastructure/master.config.json`'s `available_hostnames` was edited directly
(outside this session) from `["localhost","127.0.0.1","10.10.12.1","nbcg.me"]` to
`["10.10.12.1","nbcg.si"]` — dropping the loopback entries and renaming `nbcg.me` → `nbcg.si`,
and leaving the bare IP `10.10.12.1` in first position. That ordering is what triggers the bug
below (loopback entries in first position were already guarded against — see next section — a
bare non-loopback IP in first position was not).

## Root cause (confirmed)

`infrastructure/scripts/init-env.js`'s `deriveOrigins()` already documents the exact mechanism,
in its own comment (`init-env.js:143-148`):

> In prod the canonical hostname has to resolve to nginx from INSIDE the compose network: the
> backend fetches Keycloak's JWKS over the same public URL a browser uses, and reaches it
> through nginx's network alias. A loopback name can never do that... so the backend would fail
> to validate every token, with "fetch failed" as the only clue.

The mechanism: `docker-compose.prod.yml` gives the `nginx` service a network alias equal to
`PUBLIC_HOSTNAME` on the `backend` network (`docker-compose.prod.yml:33`, `:80-86`) — this is
*how* a backend-container HTTP client reaches Keycloak at all, since `keycloak` itself sits on
an isolated `auth` network the backend is deliberately not on (a security hardening from an
earlier round). `PUBLIC_HOSTNAME` is `available_hostnames[0]` (`canonicalHost`,
`init-env.js:141`), and it is also what `KEYCLOAK_URL` is built from
(`https://${canonicalHost}${KEYCLOAK_BASE_PATH}`, `init-env.js:168-171`).

**The existing guard only catches three loopback strings** (`init-env.js:149`:
`["localhost","127.0.0.1","::1"].includes(canonicalHost)`). It does not catch a bare IP literal
like `10.10.12.1`. But the same failure applies to *any* IP literal, not just loopback ones: no
HTTP client (including `undici`, used by both call sites below) ever performs a DNS/alias lookup
for a hostname that already parses as an IP address — it connects to that literal address
directly. So nginx's alias registration for `PUBLIC_HOSTNAME` is silently never consulted, and
the backend container ends up trying to reach `10.10.12.1` as a raw address from inside its own
Docker network — an unintended, fragile path (hairpin NAT back through the host, or a Host-header
mismatch if nginx's loaded config doesn't yet match), not the intended in-network route to nginx.
(Direct browser access to that same IP still works fine — that traffic comes from *outside* the
compose network and hits nginx's published port directly, no alias involved. It's specifically
container-internal traffic that breaks.)

Ruled out as a contributing cause: TLS trust of the self-signed internal CA. The backend
container already mounts it correctly (`NODE_EXTRA_CA_CERTS` at `docker-compose.prod.yml:121`).

## Blast radius — two call sites, not one

Both read `process.env.KEYCLOAK_URL` directly and fetch it from inside the backend container:

1. **`backend/src/core/keycloak/keycloak-admin.service.ts:48,164`** — `KeycloakAdminService`,
   used only by `UserSyncService`. This is the one currently throwing in the logs.
2. **`backend/src/core/auth/keycloak.strategy.ts:63`** — `KeycloakJwtStrategy`'s `jwksUri`
   (`jwks-rsa`'s `passportJwtSecret`), used on **every authenticated API request** to fetch
   Keycloak's signing keys. This is the exact scenario the `init-env.js:144` comment was written
   to prevent.

Why login likely still works *right now*: `jwks-rsa` is configured with `cache: true`, so a
successful fetch is cached in memory per key id (default cache lifetime ~10 hours, not
indefinite). If that cache was populated before `available_hostnames` was changed to its current
value, requests are currently being served from cache — not proof the path works, just that
nothing has forced a fresh fetch yet. **A backend restart, or the cache entry simply expiring,
would trigger a fresh fetch on the same broken path and fail closed — meaning API auth for every
user could stop working with no further config change required.** This is more urgent than the
user-sync gap it was found alongside.

## Fix

### Track A — operational, do now (you)

Put a real, resolvable hostname first in `available_hostnames` (`nbcg.si` is already present,
just not first):

```json
"available_hostnames": ["nbcg.si", "10.10.12.1"]
```

Then, since this changes `KEYCLOAK_URL`/`CORS_ORIGIN`/`KEYCLOAK_ISSUERS`/nginx's `server_name`/the
TLS cert's SAN (same regeneration chain as the earlier hostname-allowlist incident in
`todo/infrastructure-todo.md`):

1. `make step STEP=config ENV=prod` — regenerates the root `.env` from the new hostname order.
2. `make step STEP=certs ENV=prod` — reissues the nginx leaf cert (README: "Leaves are reissued
   automatically when `available_hostnames` or the subject changes").
3. `make step STEP=fbEnd ENV=prod` — routes the updated values into `backend/.env`.
4. **Rebuild the frontend image** — `VITE_KEYCLOAK_URL` is baked in at build time, not read at
   runtime (`make step STEP=appImages ENV=prod` or Docker Menu → Build).
5. `make up ENV=prod -- --force-recreate nginx backend frontend` (or the CLI's "Start (up)") —
   a plain restart does not re-read `.env`.
6. Verify: the backend log's `UserSyncService` error is gone on the next scheduled sync, and a
   fresh login (or restarting `backend` once, to force a real JWKS re-fetch instead of relying on
   cache) still succeeds.

`10.10.12.1` can stay in the list afterward for direct browser access — it just can't be first.

### Track B — setup-process fix, so this can't happen silently again

Extend the *existing* guard in `deriveOrigins()` (`init-env.js:149`) — which already blocks
loopback names for exactly this reason — to also reject any IP-literal `canonicalHost`, using
Node's built-in `net.isIP()` (no new dependency):

```js
import net from "node:net"
// ...
if (env === "prod" && (["localhost", "127.0.0.1", "::1"].includes(canonicalHost) || net.isIP(canonicalHost)))
  throw new Error(
    `available_hostnames starts with "${canonicalHost}", which cannot work in prod.\n` +
    `The backend reaches Keycloak internally (JWT validation, user directory sync) through an ` +
    `nginx network alias keyed on this hostname — loopback names and bare IP addresses never go ` +
    `through that resolution, so the backend cannot reach it that way, and both would fail with ` +
    `"fetch failed" as the only clue.\n` +
    `Put a real hostname first in master.config.json (a /etc/hosts entry, or a DNS record, is ` +
    `enough for testing) — an IP address can still be listed afterward for direct browser access.`
  )
```

This makes the `config`/`env` step (prod) fail loudly and immediately with a clear explanation,
instead of silently producing a deployment that only fails later, deep in an unrelated feature's
error log. Matches the severity already chosen for the loopback case (hard error, not a warning)
— this closes a gap in that same guard rather than introducing a new policy.

## Verification (once implemented)

1. `node --check init-env.js`.
2. Unit-style sanity check: call `deriveOrigins()` (or run `make step STEP=config ENV=prod` in a
   scratch config) with `available_hostnames: ["10.10.12.1", "nbcg.si"]` and confirm it now
   throws with the new message; confirm `["nbcg.si", "10.10.12.1"]` still succeeds.
3. After Track A is applied live: confirm both call sites work end-to-end — trigger a user-sync
   run (backend log clean) and force a fresh JWKS fetch (restart `backend`, then log in) rather
   than trusting the cache.
4. Re-run `node scripts/run.js config diff` to confirm `master.config.json` still matches the
   template shape (Track A only changes values, not keys, so this should be unaffected).

## Open items

- Confirm with a live login test (ideally by restarting `backend` once, deliberately, at a
  low-traffic time) whether JWT validation is *currently* still working from cache or already
  silently degraded — this determines how urgent Track A is versus how much runway there is.
- Track B is a one-guard, few-line change with no behavioral effect on a correctly-configured
  deployment (real hostname already first) — low risk, worth doing whenever Track A lands.
