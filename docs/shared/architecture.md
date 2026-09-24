# Architecture

NBCG is the digital library of the National Library of Montenegro "Đurđe
Crnojević". Staff catalogue items (books, serials, maps, music, …) with
COMARC/B-based metadata, attach scans, and publish them to a public catalogue.

## The pieces

```text
                 ┌──────────────── nginx (prod: TLS, one hostname) ────────────────┐
 browser ──────► │  /            → frontend (Vue 3 + Quasar SPA, static)           │
                 │  /api/        → backend (NestJS)                                │
                 │  /auth/       → Keycloak                                        │
                 │  /dashboards/ → OpenSearch Dashboards,  /pgadmin/ → pgAdmin     │
                 └──────────────────────────────────────────────────────────────────┘
 archive app ───► /api/ (desktop app at the client, own release cycle)

 backend ──► PostgreSQL ── pgsync (CDC) ──► OpenSearch  (records, drafts indices)
    │  └──► SeaweedFS (file blobs)
    │  └──► Redis ◄── BullMQ workers (COBISS import, user-directory sync)
    └──► Keycloak (JWT validation; admin API for the user directory)
```

| Component | Tech | Role |
|---|---|---|
| Frontend | Vue 3, Quasar 2, Pinia, vue-i18n (`en-US`, `me`), keycloak-js | public catalogue + `/admin` staff UI — see [frontend overview](../frontend/overview.md) |
| Backend | NestJS, Prisma 7 (Postgres), `@opensearch-project/opensearch`, BullMQ | REST API under `/api` — see [backend reference](../backend/reference.md) |
| Archive app | desktop GUI (Windows, at the client) | bulk cataloguing + upload for archive staff — see [archive-app.md](archive-app.md) |
| PostgreSQL 18 | | source of truth |
| pgsync | | streams `drafts`/`records` (+ files, relations) into OpenSearch |
| OpenSearch 3.5 | | search, suggest; never written by the backend directly |
| SeaweedFS | | file blobs; Postgres keeps the metadata row |
| Redis 8 | | BullMQ queues (`import-queue`, user sync) |
| Keycloak 26 | realm `nbcg` | login, roles → scopes — see [roles-and-permissions.md](roles-and-permissions.md) |
| Infrastructure CLI | Node (`infrastructure/cli.js`, `make …`) | setup, config, certificates, docker — see [infrastructure-cli.md](../infrastructure/infrastructure-cli.md) |

## Core concepts

- **Item** = one catalogued unit. It lives in exactly one of two tables:
  **`drafts`** (work in progress) or **`records`** (published). The id is stable
  when it moves (`POST /api/items/transition`), so links, history, tasks and
  metrics follow it. See the [glossary](domain-glossary.md).
- **Metadata** is one JSONB column shaped after COMARC/B (`DomainRecord` in
  `backend/src/modules/import/cobiss/cobiss-util/cobiss.types.ts`); unknown keys
  are dropped on write. Field list: [metadata-fields.md](metadata-fields.md).
  The editor contract is `GET /api/schema/record` (→ [schema v2 plan](plans/metadata-schema-v2.md)).
- **Visibility** `PUBLIC` / `PRIVATE` / `HIDDEN` × table decides who can see an
  item (scopes `records:view:public` … `drafts:view:hidden`).
- **Relations** (`item_relations`) make parent/child trees: collections and their
  members, serials and their issues. DB triggers keep `childrenInDrafts` /
  `childrenInRecords` counts in the parent's metadata. Cycles are rejected.
- **`collectionType`** in metadata: `0` not a collection, `1` primary collection,
  `3` collection, `4` serial collection.
- **COBISS import**: an item can be pulled from COBISS (the national union
  catalogue) by id — async batch import (queue) or a synchronous preview. Items
  from COBISS get a deterministic id derived from the COBISS id.
- **Files** belong to an item; blobs in SeaweedFS; OCR text is supplied by the
  uploader and indexed for full-text search.
- **Revisions** (`item_revisions`): append-only diffs per write — "who changed
  what". **Metrics**: daily view/download counters in their own tables.
- **Users directory** (`user_profiles`): a daily shadow of the Keycloak realm for
  pickers and names — never an authorization source.
- **Tasks**: staff handoffs about one item (review & publish, fix metadata,
  general) with an append-only log — being redesigned:
  [task workflow v2](plans/task-workflow-v2.md).

## Data flow of a typical edit

1. Browser (JWT from Keycloak) → `PATCH /api/items/:id` with `expectedVersion`.
2. Backend checks scopes, sanitises metadata, writes the row + an
   `item_revisions` diff in one transaction (409 on a stale version).
3. pgsync sees the change and re-indexes the **whole** document (metadata +
   nested file text) in OpenSearch — hence counters, logs and task tables are
   deliberately **not** pgsync-tracked.
4. Lists and search read OpenSearch, so they lag the write by a moment; the
   frontend waits a beat before refreshing.

## Where to look next

| Question | Doc |
|---|---|
| Endpoint X, table Y, business rule Z | [backend/reference.md](../backend/reference.md) |
| Running things locally, tests, gotchas | [backend/development.md](../backend/development.md) |
| Who can do what | [roles-and-permissions.md](roles-and-permissions.md) |
| Deploying, hostnames, certificates | [infrastructure/infrastructure-cli.md](../infrastructure/infrastructure-cli.md) |
| What is planned | [docs/README.md](../README.md) |
