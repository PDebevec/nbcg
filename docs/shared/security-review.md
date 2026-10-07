# Security review — findings 2026-10-03

## Status: FINDINGS — not yet triaged

A read-only review of the backend, frontend and deployment config. Everything
below was verified by reading the code; the two highest items were also
reproduced. Nothing has been fixed. This is **not** a plan — when an item is
picked up, move it to `docs/backend/plans/` or `docs/infrastructure/plans/` and
drop it from here.

Line numbers are from `main` @ `78937ef`.

---

## CRITICAL

### C1 — Stored HTML on the API origin steals the reader's access token

**Chain, all verified:**

1. `backend/src/modules/files/files.service.ts:102` stores
   `mimeType: file.mimetype` **verbatim** — the `Content-Type` header of the
   multipart part, which the uploader fully controls. `MIME_TO_FILE_TYPE`
   (`files.service.ts:15-19`) only maps three types to a `FileType` and falls
   back to `UNKNOWN`, but that affects the *display* type, not the stored string.
2. `backend/src/modules/files/files.controller.ts:142` serves that stored string
   as the response `Content-Type` with no allowlist, no sniffing and no CSP.
3. `files.controller.ts:132` — `const disposition = inline === '1' ? 'inline' :
   'attachment'` — inline rendering is a **caller-supplied query parameter**.
   The only gate is `assertCanViewFile`, which anonymous callers pass for a
   `PUBLIC` record.
4. nginx sets `X-Content-Type-Options: nosniff`
   (`infrastructure/docker/nginx/nginx.conf.template:106`), which stops
   *sniffing* but happily renders a response explicitly declared `text/html`.
   There is **no `Content-Security-Policy` anywhere in the repo** (grepped
   `infrastructure/`, `backend/src`, `frontend/src`).

**Why it escalates past "HTML on the API host":** the response document's path
is `/api/files/<id>/download`, and the auth cookie is scoped to exactly that
path — `frontend/src/services/keycloak.ts:46`:

```ts
document.cookie = `${TOKEN_COOKIE}=${keycloak.token}; Path=/api/files; SameSite=Lax${secure}`;
```

Per RFC 6265 that cookie matches the current document, so `document.cookie` on
the attacker's page returns the victim's live Keycloak **access token**. Its
`resource_access` claim carries the victim's `nbcg-api` roles, so replaying it
as `Authorization: Bearer …` against the whole API is a role replay — a
cataloguer becomes an admin. `SameSite=Lax` does not help: it governs whether
the cookie is *sent* on a cross-site request, not whether script on the page can
read it.

**Who can start it:** upload needs `drafts:manage` or `records:manage`. Per
[roles-and-permissions.md](roles-and-permissions.md), a **cataloguer** holds
`drafts:manage` but not `records:manage` — they can upload to any draft, cannot
publish, and can reach an admin by link. `frontend/src/components/FileViewer.vue:12`
happens to hide the "open in new tab" button for `fileType === 'UNKNOWN'`, but
the endpoint is a plain GET and the link works from a chat client.

**Fix shape:** never echo a client-declared type. Serve
`application/octet-stream` unless the stored type is in an allowlist, and force
`attachment` for anything outside it *even when `?inline=1`*. Then remove the
JS cookie writer and have the backend set it on the download response with
`HttpOnly` — a cookie written from JS can never carry that flag, which is what
closes the read primitive at the source.

---

## HIGH

### H1 — The database password is printed to stdout on every production boot

`backend/prisma.config.ts:6` is a bare `console.log(process.env["DATABASE_URL"])`.
`backend/package.json:14` — `"start:prod": "npx prisma migrate deploy && node dist/src/main.js"`
— and `backend/Dockerfile:56` runs exactly that as the container `CMD`, so
**every prod backend start writes the full Postgres DSN, password included, to
container stdout**, where the json-file driver captures it
(`docker-compose.yml:8-12`). The same happens for every `prisma` invocation from
the dev CLI and from `infrastructure/scripts/lib/db-utils.js:90`.

One line to delete. (`development.md` mentions this trap only in the context of
`migrate reset`.)

### H2 — OpenSearch Dashboards runs unauthenticated in production

`infrastructure/docker/docker-compose.yml:208` sets
`DISABLE_SECURITY_DASHBOARDS_PLUGIN: true` in the **base** compose. The prod
overlay (`docker-compose.prod.yml:291-317`) sets `OPENSEARCH_USERNAME` and
`OPENSEARCH_PASSWORD` but never clears it — and compose *merges* `environment`
maps, so the base value wins:

```
$ docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml config
  opensearch-dashboards:
    environment:
      DISABLE_SECURITY_DASHBOARDS_PLUGIN: "true"
      OPENSEARCH_PASSWORD: ""          # the credential prod configures, inert
```

The credentials the prod overlay goes to the trouble of generating are
therefore decorative. The only remaining control is nginx `auth_basic` over a
single shared htpasswd (`nginx.conf.template:184-189`). Anyone holding that one
password gets an **unauthenticated** Dashboards, including **Dev Tools →
arbitrary queries against `records`/`drafts`** — which bypasses
`ResourceAccessService` entirely and returns every hidden item and every
attribution name. That is a larger read surface than the application itself
grants.

Note the same compose-merge trap applies to the prod pgsync block, which
explicitly blanks `ELASTICSEARCH_URL` for exactly this reason — so the pattern
is already known in this repo, just not applied here.

### H3 — the deploy procedure could not detect its own staleness (FIXED 2026-10-03)

Found while auditing `infrastructure/`. `.cli-state.json` stored a bare boolean
per step (`state.js` `isStepDone(name)`), with no environment dimension and
nothing tying a record to the code, template or config that produced it. The
documented deploy procedure — `git pull` → `make cli` → *Run all remaining
steps* — therefore reported success and changed nothing after any change to a
compose template, a renderer or `master.config.json`. Fixed: state is now
per-environment and fingerprinted. See
[infrastructure-cli.md](../infrastructure/infrastructure-cli.md#what-done-means-fingerprints).
The `DISABLE_SECURITY_DASHBOARDS_PLUGIN` leak above is a separate, unfixed
issue.

### H4 — `make check` failed on a healthy machine, blocking the Setup menu (FIXED 2026-10-03)

`requirements.js` checks every published port before setup. In dev it checked
`BACKEND_PORT` (3000) — but **docker never publishes 3000 in dev**, the backend
runs as a pm2 host process. The check recognised all 14 ports held by this
project's containers as "in use by this project" and then failed on the one port
held by this project's own host process, because `ownPorts` came only from
`getPublishedPorts()`.

Effect: on any dev machine with the backend running, `make check ENV=dev` failed
and `make cli` → Start Setup could not be entered — which is the documented
deploy procedure. Fixed with `dev_unpublished_ports` in `master.config.json`
(mirroring the existing `prod_published_ports`), filtered in
`requirementsFor('dev')`. Prod was never affected: it only checks 80/443.

Two things found alongside it, both fixed:

- The unmet-prerequisites failure threw a bare `Error`, so `runAction` printed a
  raw stack trace over the top of the already-clear per-failure output. It now
  throws `UsageError`, which the menu and dispatcher already print as a bare
  message. (The menu was never crashing — it pauses and redraws correctly.)
- `configMatchesTemplate()` compared `JSON.stringify()` output, which is
  key-order sensitive, and its comment claimed an order difference "only ever
  means the file was edited by hand". That is false: `mergeTemplateDefaults()`
  *appends* a newly added setting while the template lists it in place, so
  adding any new key to the template produced a false "differs from template" —
  the sort of thing that tempts someone to reset a configured
  `master.config.json` and lose their hostnames over a cosmetic artefact. Now
  compared canonically with sorted keys.

---

## MEDIUM

### M1 — `relations/connect` and `relations/disconnect` authorise the parent, never the children

`relations.controller.ts:19` checks only `dto.parentId`;
`relations.controller.ts:28` likewise. `childIds` — arbitrary caller-chosen ids
from `modify-relations.dto.ts:7-10` — goes straight into
`item_relations` writes (`relations.service.ts:75-83`, `:103-108`) without ever
touching `ResourceAccessService`. Compare `POST /items`, which *does* check every
id (`items.controller.ts:54` → `assertCanManageParents`).

Two consequences: a caller with `drafts:manage` can attach or detach a
`records` id under a draft they manage (integrity), and `relations.service.ts:85`
calls `assertStoredValid(childIds, tx)`, whose 400 body names the missing fields
and violated constraints of an item the caller may not see — a metadata oracle.
Not exploitable with today's personas (every `drafts:manage` holder also has
`records:view:hidden`); live the moment either scope is granted alone.

### M2 — `GET /import/jobs/:jobId` is an IDOR over sequential ids

`import.controller.ts:9-13` applies `@RequireScopes('import:execute')` and
nothing else; `import-queue.service.ts:37-52` calls `queue.getJob(jobId)` with
no ownership check. BullMQ job ids are auto-increment integers, so `/jobs/1`,
`/jobs/2`, … enumerates the whole import history, and `progress.errors[].reason`
is a raw exception message (`import-queue.processor.ts:53`). Every cataloguer,
editor and admin holds `import:execute`.

### M3 — Task routes never check the visibility of `task.itemId`

`GET /tasks` (`tasks.controller.ts:54` → `tasks.service.ts:212-250`) is
deliberately "all staff see all tasks"; `GET /tasks/:id`, `/comments` and the
four action routes check staff/assignee, never item visibility. The codebase
already disagrees with itself here — `POST /tasks` *does* call
`assertCanView(principal, dto.itemId)` (`tasks.controller.ts:49`). As shipped no
staff persona can be blocked (all hold `*:view:hidden` transitively), so this is
latent rather than active.

### M4 — The `nbcg_at` cookie can never be `HttpOnly`

`keycloak.ts:43-50` writes it from JS. Everything else about it is correct —
host-only, `Path=/api/files` so it reaches exactly one endpoint, `SameSite=Lax`,
`Secure` only under HTTPS. `HttpOnly` is structurally impossible from JS, which
is fine until C1 gives attacker script on the origin. Fixing C1 properly means
setting the cookie on the download response server-side.

### M5 — No rate limiting anywhere in the backend

`@nestjs/throttler` is not installed. The expensive unauthenticated surface is
`GET /search` (`search.controller.ts:18-21`) — every word of `q` becomes a
`multi_match` with `fuzziness: 'AUTO'`, and `core/opensearch/opensearch.service.ts:9-11`
sets no `requestTimeout`, so a slow query holds a connection. Then
`POST /files/upload/:itemId` at **10 × 2 GB = 20 GB into `os.tmpdir()` per
request** (`files.controller.ts:57-59`) with `proxy_request_buffering off`; prod
is capped per-request at `client_max_body_size 2g` but has no concurrency limit,
and dev has no cap at all. Then `GET /import/cobiss/preview/:cobissId`, a
synchronous outbound fetch with a 30 s timeout on a caller-supplied id.

### M6 — Prisma query logging is unconditional, including in production

`backend/src/core/prisma/prisma.service.ts:15` — `log: ['query', 'info',
'warn', 'error']` on every environment. Full SQL text goes to the Nest logger on
every request, against a 3 × 10 MB json-file cap. Production wants
`['warn', 'error']`, or a `NODE_ENV` gate.

### M7 — Unbounded id arrays on five write endpoints

`tasks-query.dto.ts:32-34` caps `itemIds` at 200 with an explicit rationale; the
pattern is not applied to `delete-items.dto.ts:3-7`, `transition-items.dto.ts:4-7`,
`create-item.dto.ts:19-23`, `modify-relations.dto.ts:7-10` and
`cobiss-import.dto.ts:5-8`. Each flows into `where: { id: { in: … } }` and, for
delete/transition, into one transaction. `resource-access.service.ts:131` and
`items.service.ts:299` also join the whole list into the `NotFoundException`
message, so it is reflected back. All five need an elevated scope.

### M8 — The dev stack is published on `0.0.0.0`

`infrastructure/docker/docker-compose.dev.yml` binds no `host_ip`, so postgres,
redis, Keycloak, OpenSearch, Dashboards, pgAdmin and SeaweedFS are all reachable
from the LAN — compounded by `DISABLE_SECURITY_PLUGIN=true`,
`PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED=False`, `KC_LOG_LEVEL: debug`,
`KEYCLOAK_SSL_REQUIRED=none` and every dev password being the literal `nbcg`
(`env/.env.dev`). Each relaxation is individually commented and understood; the
gap is that they are never combined with a loopback bind.

---

## LOW

| | Where | Note |
|---|---|---|
| `cobissId` is interpolated into the SRU URL unencoded | `cobiss-util/cobiss-fetch.ts:35-42` | caller can append/override SRU params. Host is fixed, so the token cannot be redirected. `encodeURIComponent` both values |
| `assertCanManage` resolves the id before the anonymous check | `core/auth/resource-access.service.ts:95-98` | 404 for a missing id, 401 for a real one — an existence oracle that contradicts the project's own "404 not 403" rule |
| `exec-utils.js` echoes the full argv into error messages | `infrastructure/scripts/lib/exec-utils.js:60` | hazard only: current call sites correctly pass secrets via `env`, never argv |
| `nbcg-worker` client secret carries `drafts:manage` + `records:manage` | `docker/keycloak/nbcg-realm.conf.json` | held correctly (0600, gitignored) but it is a full-write credential and is `nbcg` in dev |
| `pgadmin-servers.json` with `"Password": "postgres"` is committed | `backend/pgadmin-servers.json` | dead dev default, but a committed credential is a committed credential |

---

## Verified clean

Worth recording so they are not re-audited:

- **SQL injection** — every raw statement is a Prisma tagged template
  (`relations.service.ts:240`, `tasks.service.ts:496`,
  `stats.service.ts:78,88,150,208,222`). The two `$executeRawUnsafe` calls in
  `core/metrics/metrics.service.ts:118-145` interpolate only `$n` placeholders;
  values are bound.
- **OpenSearch query injection** — structured JSON DSL only; no
  `query_string`/`wildcard`/`regexp` anywhere. `filter-fields.ts` compiles from
  a closed allowlist with per-value parsers, and field *names* never come from
  input. No regex is built from user input, so no ReDoS.
- **XXE** — `@xmldom/xmldom@0.8.12` registers no-op handlers for
  `externalEntityDecl`/`resolveEntity`/`getExternalSubset` and imports no `fs`
  or `http`. The XML comes from a fixed host.
- **Path traversal on upload** — multer `diskStorage` with no `filename`
  callback, so `crypto.randomBytes(16).toString('hex')` is used;
  `originalname` never reaches the filesystem path.
- **Header injection via filename** — the `contentDisposition` helper
  (`files.controller.ts:37-46`) strips CR/LF and non-ASCII from the fallback and
  escapes RFC 5987 correctly.
- **SSRF** — every outbound base URL comes from env with a fixed default; the
  only user-supplied path segment is a SeaweedFS `fid` that originates from
  SeaweedFS's own `/dir/assign` response. The Keycloak admin client holds a
  bearer token but builds every URL from config.
- **CORS** — explicit origin array, no `*`, no reflection
  (`backend/src/main.ts:13-22`).
- **No stack traces in responses** — no global exception filter is registered, so
  Nest's base filter returns a bare 500.
- **Container hardening** — `USER node` on the API, no `privileged`, no host
  networking, no `cap_add` in any compose file.
