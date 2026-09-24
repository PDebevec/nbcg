# License Audit — NBCG Digital Library

Audited 2026-09-04. Covers every Docker image, every npm package (all 1,273 resolved packages across `frontend/`, `backend/`, `infrastructure/`, direct + transitive), and bundled fonts/icons. Licenses were read from each package's actual installed `LICENSE` file / package metadata and cross-checked against each project's official licensing page — not guessed from memory.

## Bottom line

**No license blocks production use.** Two items need a conscious decision, not an emergency fix:

1. **PM2 is AGPL-3.0** (`frontend/package.json`, `infrastructure/package.json`). It is never imported in the frontend's code and is not present in the frontend's or backend's production Docker images — the frontend ships only its static `dist/spa` build via nginx (`frontend/Dockerfile`), and the backend has no PM2 dependency at all. In `infrastructure/`, PM2 only runs developer-tooling scripts (`infrastructure/scripts/lib/app-utils.js`) to manage local dev servers on a developer's machine — that tooling is never deployed to the library. So AGPL obligations (which trigger on distributing/network-serving a *modified* PM2) aren't in play today. Recommended: drop the unused `pm2` entry from `frontend/package.json` (dead weight, zero-cost removal) and, if you want zero ambiguity going forward, swap the infra dev-tooling to a non-AGPL process manager.
2. **Redis is triple-licensed (RSALv2 / SSPLv1 / AGPLv3)**, not a plain permissive license, as of Redis 7.4+ (`redis:8.6.1` in `docker-compose.yml`). All three options restrict *offering Redis's functionality as a competing hosted service* or *distributing a modified Redis*; none restrict using stock Redis internally as a cache/queue backend the way this project does (via `ioredis`, MIT). That's the standard reading every company using Redis 8 internally relies on. If you'd rather not carry that ambiguity for a government-adjacent product at all, the drop-in fix is switching the image to **Valkey** (Linux Foundation fork, BSD-3-Clause, wire-compatible with `ioredis`).

Everything else resolves to standard permissive OSI licenses (MIT, Apache-2.0, BSD-2/3-Clause, ISC, PostgreSQL License) that allow free production/commercial use, with attribution being the only ever obligation (and only for a couple of bundled icon sets, see below).

---

## Docker / infrastructure images

| Component | Image | License | Notes |
|---|---|---|---|
| PostgreSQL | `postgres:18.3` | PostgreSQL License | MIT/BSD-style, OSI-approved, no copyleft |
| pgAdmin4 | `dpage/pgadmin4:9.12.0` | PostgreSQL License | same family, permissive |
| **Redis** | `redis:8.6.1` | **RSALv2 / SSPLv1 / AGPLv3 (your choice)** | Not plain-permissive since Redis 7.4. See note above — fine for internal use, consider Valkey for a clean permissive story |
| Keycloak | `quay.io/keycloak/keycloak:26.5.4` | Apache-2.0 | |
| pgsync | `toluaina1/pgsync` | MIT | |
| OpenSearch | `opensearchproject/opensearch:3.5.0` | Apache-2.0 | Fully open-source AWS fork of Elasticsearch, no dual-licensing |
| OpenSearch Dashboards | `opensearchproject/opensearch-dashboards:3.5.0` | Apache-2.0 | |
| SeaweedFS | `chrislusf/seaweedfs:4.23` | Apache-2.0 | |
| nginx | `nginx:1.29.5-alpine` / `nginx:1.29.5-perl` | BSD-2-Clause (nginx license) | |
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

## Full transitive dependency sweep

Scanned all 1,273 uniquely-resolved packages across the three `node_modules` trees. License distribution:

| License | Count |
|---|---|
| MIT (incl. MIT/X11, MIT OR CC0-1.0) | ~1,049 |
| Apache-2.0 (incl. non-standard "Apache-2"/"Apache" spellings, verified against actual LICENSE files) | 73 |
| ISC | 67 |
| BSD-3-Clause | 33 |
| BSD-2-Clause | 23 |
| BlueOak-1.0.0 | 9 (permissive) |
| Unlicense / 0BSD / Public Domain | ~6 (public-domain-equivalent) |
| MPL-2.0 | 3 — `lightningcss` (frontend build tool only, devDependency, never shipped) |
| CC-BY-4.0 | 2 — `caniuse-lite` (build-time browser-compat data, not shipped code) |
| Python-2.0 | 1 — `argparse` npm port (permissive) |
| **AGPL-3.0** | 3 — all are `pm2` and its own sub-dependencies (`@pm2/agent`) |

Three packages (`pause`, `seq-queue`, `cli-tableau`) had no `license` field in `package.json`; each was individually opened and its actual `LICENSE`/`Readme` confirmed **MIT**.

## Recommendations

1. Remove the unused `pm2` dependency from `frontend/package.json`.
2. Decide on Redis: keep it (internal-use interpretation is standard and safe) or swap to Valkey for a fully permissive, ambiguity-free story — worth a 10-minute conversation given the "national library, zero conflicts" bar.
3. If you publish an "open source licenses used" page (the "display what we're using" fallback), include Font Awesome (CC BY 4.0 + SIL OFL) and Material Icons (Apache-2.0) attributions — everything else is attribution-optional.
