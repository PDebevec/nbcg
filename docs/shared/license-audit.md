# License Audit — NBCG Digital Library

Audited 2026-09-04; **re-verified 2026-10-03** against every installed `LICENSE`
file, a fresh sweep of all 1,468 resolved packages, and each project's actual
upstream `LICENSE` on its repo — not guessed from memory.

Re-verification changed three conclusions and added one. The corrections are
called out inline below. It also surfaced a whole category the first pass did
not look at: **content and third-party services**, now in
[content-rights.md](content-rights.md) — a copyright over-claim on the public
Terms of Use, unrecorded COBISS/IZUM metadata terms, and live placeholder images.
**Read that file too; it is the more urgent of the two.**

## Bottom line

**No package licence blocks production use.** One item needs a conscious
decision, one needs a written election:

1. **PM2 is AGPL-3.0** (`frontend/package.json`, `infrastructure/package.json`). It is never imported in the frontend's code and is not present in the frontend's or backend's production Docker images — the frontend ships only its static `dist/spa` build via nginx (`frontend/Dockerfile`), and the backend has no PM2 dependency at all. In `infrastructure/`, PM2 only runs developer-tooling scripts (`infrastructure/scripts/lib/app-utils.js`) to manage local dev servers on a developer's machine — that tooling is never deployed to the library. So AGPL obligations (which trigger on distributing/network-serving a *modified* PM2) aren't in play today. Recommended: drop the unused `pm2` entry from `frontend/package.json` (dead weight, zero-cost removal) and, if you want zero ambiguity going forward, swap the infra dev-tooling to a non-AGPL process manager.
2. **Redis is triple-licensed (RSALv2 / SSPLv1 / AGPLv3)**, not a plain permissive license, as of Redis 7.4+ (`redis:8.6.1` in `docker-compose.yml`). All three options restrict *offering Redis's functionality as a competing hosted service* or *distributing a modified Redis*; none restrict using stock Redis internally as a cache/queue backend the way this project does (via `ioredis`, MIT). That's the standard reading every company using Redis 8 internally relies on. If you'd rather not carry that ambiguity for a government-adjacent product at all, the drop-in fix is switching the image to **Valkey** (Linux Foundation fork, BSD-3-Clause, wire-compatible with `ioredis`).

**Elected on 2026-10-12: switched to `valkey/valkey:9.2`** (BSD-3-Clause, wire-compatible). Verified: container starts, `redis-cli ping` → PONG, and the full Redis protocol (SET/GET/INFO) responds correctly through the `valkey-cli`/`redis-cli` compatibility layer. `ioredis` in the backend talks to it unchanged. This removes the license ambiguity with a one-line change in `docker-compose.yml`.

Everything else resolves to standard permissive OSI licenses (MIT, Apache-2.0, BSD-2/3-Clause, ISC, PostgreSQL License) that allow free production/commercial use, with attribution being the only ever obligation (and only for a couple of bundled icon sets, see below).

---

## Docker / infrastructure images

| Component | Image | License | Notes |
|---|---|---|---|
| PostgreSQL | `postgres:18.3` | PostgreSQL License | MIT/BSD-style, OSI-approved, no copyleft |
| pgAdmin4 | `dpage/pgadmin4:9.12.0` | PostgreSQL License | same family, permissive |
| **Redis** | `redis:8.6.1` | **RSALv2 / SSPLv1 / AGPLv3 — you must elect one** | Not plain-permissive since Redis 7.4. See note above — fine for internal use, but elect **AGPLv3 in writing** (it is the one option that is OSI-approved and it lets you elect *out* of both source-available terms), or switch to Valkey (BSD-3-Clause) |
| Keycloak | `quay.io/keycloak/keycloak:26.5.4` | Apache-2.0 | |
| pgsync | `toluaina1/pgsync` | MIT | upstream repo is `github.com/toluaina/pgsync` — `toluaina1` is only the Docker Hub handle, which makes provenance checks 404 |
| OpenSearch | `opensearchproject/opensearch:3.5.0` | Apache-2.0 | **confirmed vanilla**: the upstream `LICENSE.txt` (note the filename) is byte-for-byte the Apache 2.0 text with no added clause, and `NOTICE.txt` is pure attribution. The SSPL scare belongs to *Elasticsearch* 7.11+; OpenSearch forked from 7.10.2, which was still Apache-2.0. Still Apache-2.0 at 3.8 |
| OpenSearch Dashboards | `opensearchproject/opensearch-dashboards:3.5.0` | Apache-2.0 | see [security-review.md](security-review.md) H2 — a *security* misconfiguration, not a licensing one |
| SeaweedFS | `chrislusf/seaweedfs:4.23` | Apache-2.0 | |
| nginx | `nginx:1.29.5-perl` (what prod uses — **not** `-alpine`) | BSD-2-Clause | genuinely 2-clause: nginx's licence deliberately omits the BSD-3 "no endorsement" condition. The perl variant is Debian-based and pulls in **Perl (`Artistic-1.0-Perl OR GPL-1.0-or-later`)** — dual-licensed, permissive-equivalent, but record it |
| Node.js runtime | `node:22-alpine` | MIT (Node.js itself) | Base OS (Alpine) packages are MIT/BSD/Apache; BusyBox utilities are GPL-2.0 but run as unmodified OS binaries, not linked into your code — standard practice, not a distribution concern for your product |

## Frontend — direct dependencies (`frontend/package.json`)

| Package | License |
|---|---|
| @quasar/extras | MIT |
| axios | MIT |
| keycloak-js | Apache-2.0 |
| pinia | MIT |
| **pm2** | **AGPL-3.0 — unused in code, remove it** |
| quasar | MIT |
| vue | MIT |
| vue-i18n | MIT |
| vue-router | MIT |

Dev-only tooling (eslint, prettier, typescript, vite-plugin-checker, vue-tsc, etc.) is all MIT/Apache-2.0 and never ships — the frontend Docker image contains only the compiled static bundle.

## Backend — direct dependencies (`backend/package.json`)

| Package | License |
|---|---|
| @nestjs/* (bullmq, common, core, jwt, passport, platform-express) | MIT |
| @opensearch-project/opensearch | Apache-2.0 |
| @prisma/adapter-pg, @prisma/client | Apache-2.0 |
| @xmldom/xmldom | MIT |
| bullmq | MIT |
| class-transformer, class-validator | MIT |
| ioredis | MIT |
| jwks-rsa | MIT |
| keycloak-connect | Apache-2.0 |
| passport, passport-jwt | MIT |
| pg | MIT |
| reflect-metadata | Apache-2.0 |
| rxjs | Apache-2.0 |
| undici | MIT |

No AGPL/GPL/MPL anywhere in the backend's dependency tree — clean, even though the backend's Docker image copies its full `node_modules` (incl. devDependencies) into the runtime container.

## Infrastructure tooling (`infrastructure/package.json`)

Developer/ops CLI only — not part of the deployed product.

| Package | License |
|---|---|
| inquirer | MIT |
| pm2 | AGPL-3.0 (dev-only process manager for local frontend/backend processes, never shipped) |

## Bundled fonts/icons actually enabled (`frontend/quasar.config.ts`)

Of the many icon sets bundled in `@quasar/extras`, only two are turned on and shipped:

| Set | License | Obligation |
|---|---|---|
| Font Awesome 6 (Free) | Icons: CC BY 4.0 · Fonts: SIL OFL 1.1 · Code: MIT | Attribution required — matches "display what we're using" |
| Material Icons | Apache-2.0 | Attribution appreciated, not required |

All other icon sets in the package (MDI, Ionicons, Bootstrap Icons, Eva Icons, etc.) are present in `node_modules` but disabled and not included in the production build.

**The Font Awesome attribution obligation is currently unmet** — there is no
credits page, no route and no footer link anywhere. See
[content-rights.md](content-rights.md). Also note the *web fonts* the public
site uses (Source Sans 3, Source Serif 4) are hotlinked from
`fonts.googleapis.com`: SIL OFL 1.1, so the licence is fine, but it leaks every
visitor's IP to Google — see the same file.

## Full transitive dependency sweep

Scanned all **1,468** uniquely-resolved packages across the three
`node_modules` trees (2026-10-03; 1,273 in September). License distribution:

| License | Count |
|---|---|
| MIT (incl. MIT/X11, MIT OR CC0-1.0) | ~1,205 |
| Apache-2.0 (incl. non-standard "Apache-2"/"Apache" spellings, verified against actual LICENSE files) | ~80 |
| ISC | 82 |
| BSD-3-Clause | 34 |
| BSD-2-Clause | 31 |
| BlueOak-1.0.0 | 8 (permissive) |
| Unlicense / 0BSD / Public Domain | ~8 (public-domain-equivalent) |
| MPL-2.0 | 3 — `lightningcss` (frontend build tool only, devDependency, never shipped) |
| CC-BY-4.0 | 2 — `caniuse-lite` (build-time browser-compat data, not shipped code) |
| Python-2.0 | 3 (permissive) |
| **AGPL-3.0** | 3 — all `pm2` and its own sub-dependency `@pm2/agent` |

Four packages have no `license` field: `pause`, `seq-queue`, `cli-tableau` (×2) —
all four are **pm2 sub-dependencies** and disappear with pm2. Each was opened
individually: `seq-queue` and `cli-tableau` ship an MIT `LICENSE` file;
`pause@0.0.1` ships **no `LICENSE` file at all** and its Readme asserts MIT
(TJ Holowaychuk). Technically unverifiable, hence the recommendation to remove
pm2 rather than rely on it.

## LGPL inside two container images

Invisible from the Docker Hub licence label, so a per-image check will not
surface it — the Python transitive dependencies are where the weak copyleft is:

| Image | Package | Licence |
|---|---|---|
| `toluaina1/pgsync` | `psycopg2-binary` | LGPL-3.0-or-later |
| `dpage/pgadmin4` | `psycopg[c]`, `ldap3` | LGPL-3.0-or-later |
| `dpage/pgadmin4` | `paramiko` | LGPL-2.1 |

All are ordinary dynamically-linked Python imports — the standard,
LGPL-§4(d)-compliant configuration — so there is no source-disclosure
obligation on the Library's own code. Record them; do not worry about them.

## PGSync Pro — latent, keep out of the MIT lineage

The pgsync author sells **PGSync Pro**, a proprietary extension whose EULA
states it is "a proprietary extension to the open-source PGSync project". The
published MIT Docker image contains **only** the MIT package — no Pro code.
Nothing to do today; if anyone ever buys Pro (semantic/hybrid search, hosted
embeddings, MCP server), a governed commercial component lands inside this
container and must go through legal review.

## Recommendations

1. **Elect AGPLv3 for Redis in writing**, and record the election, so an auditor
   can see RSALv2 was not silently accepted — or swap `redis:8.6.1` → `valkey`
   (BSD-3-Clause) and drop the question. Given the "national library, zero
   conflicts" bar, the Valkey swap is the cheaper answer.
2. **Remove the unused `pm2` dependency from `frontend/package.json`.** Zero
   risk, and it takes `pause`'s unverifiable licence with it.
3. **Add a `/credits` page** carrying the Font Awesome (CC BY 4.0 + SIL OFL) and
   Material Icons (Apache-2.0) attributions. Nothing else in the stack needs
   attribution, so this is a single small page. Tracked in
   [content-rights.md](content-rights.md).
4. Drop the orphaned Quasar starter files (`quasar-logo-vertical.svg` is a
   trademark), and note the dead deps flagged in
   [dev-environment.md](dev-environment.md) — `pm2`, `keycloak-connect`, the
   `test:e2e` script, the empty `CobissImportService`.
5. **Not a licence item but the highest-risk thing in this file's orbit:** see
   [security-review.md](security-review.md) — a stored-HTML file download
   currently hands a reader's access token to an uploader.
