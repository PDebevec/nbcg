# NBCG Backend Reference

Complete reference for the NBCG backend system. Use this to understand the architecture, call APIs, query the database, and interact with OpenSearch.

---

## Architecture Overview

| Service        | Technology          | Host (dev)              | Purpose                          |
|----------------|---------------------|-------------------------|----------------------------------|
| API            | NestJS (REST)       | `localhost:3000`        | Main backend, prefix `/api`      |
| Database       | PostgreSQL 18.3     | `localhost:15432`       | Primary data store               |
| Search         | OpenSearch 3.5.0    | `localhost:9200`        | Full-text search                 |
| Data Sync      | PGSync              | (internal)              | Postgres -> OpenSearch real-time  |
| File Storage   | SeaweedFS           | `localhost:8888` (filer)| Distributed file storage         |
| Job Queue      | BullMQ + Redis      | `localhost:6379`        | Async import processing          |
| Auth           | Keycloak 26.5.4     | `localhost:8082`        | Authentication (realm: `nbcg`)   |
| Dashboards     | OpenSearch Dashboards| `localhost:5601`       | Search visualization             |
| DB Admin       | PgAdmin             | (configured in compose) | Database admin UI                |

---

## Database (PostgreSQL)

### Connection

```bash
psql postgres://nbcg:nbcg@localhost:15432/nbcg
```

### Tables

#### `drafts` / `records` (identical schema)
| Column             | Type               | Notes                        |
|--------------------|--------------------|------------------------------|
| `id`               | String (CUID)      | PK, or deterministic from cobissId |
| `visibilityStatus` | Enum               | PUBLIC, PRIVATE, HIDDEN      |
| `metadata`         | JSONB              | Flexible metadata object     |
| `createdAt`        | DateTime           | Auto-set                     |
| `updatedAt`        | DateTime           | Auto-updated                 |
| `createdByUserId`  | String             | Keycloak sub, or `system` for COBISS imports |
| `createdByName`    | String             | Display-name **snapshot** — see Attribution below |
| `updatedByUserId`  | String?            |                              |
| `updatedByName`    | String?            | Snapshot, same rule         |

#### `file_attachments`
| Column          | Type      | Notes                              |
|-----------------|-----------|------------------------------------|
| `id`            | String    | CUID PK                           |
| `draft_id`      | String?   | FK to drafts (cascade delete)      |
| `record_id`     | String?   | FK to records (cascade delete)     |
| `fileType`      | Enum      | IMAGE, PDF, UNKNOWN                |
| `role`          | Enum      | SOURCE (default), ARCHIVAL, WEB, THUMBNAIL — sent as `role` on upload |
| `originalFid`   | String    | SeaweedFS file ID                  |
| `filename`      | String    |                                    |
| `mimeType`      | String    |                                    |
| `sizeBytes`     | Int       |                                    |
| `extractedText` | String?   | Text supplied by the uploader (OCR runs client-side) |
| `textExtractionStatus` | Enum | NOT_EXTRACTED (default), EXTRACTED, GARBAGE, NO_TEXT |
| `createdAt`     | DateTime  |                                    |

There is no server-side text extraction any more (Apache Tika was removed); the
text arrives with the upload (`extractedTexts`) or later via `PUT /files/:id/text`.

#### `item_relations`
| Column      | Type     | Notes                           |
|-------------|----------|---------------------------------|
| `parentId`  | String   | Composite PK with childId       |
| `childId`   | String   | Composite PK with parentId      |
| `parentType`| Enum     | DRAFT or RECORD                  |
| `childType` | Enum     | DRAFT or RECORD                  |
| `createdAt` | DateTime |                                  |

#### `item_revisions`
One row per change to an item — diffs, not snapshots.

| Column      | Type         | Notes                                                        |
|-------------|--------------|--------------------------------------------------------------|
| `id`        | String       | CUID PK                                                       |
| `itemId`    | String       | **No FK.** Stable across DRAFT ↔ RECORD (`transition()` keeps the id) |
| `version`   | Int          | The item's version *after* the change                         |
| `action`    | Enum         | CREATE, UPDATE, PUBLISH, UNPUBLISH, VISIBILITY_CHANGE, FILE_ADDED, FILE_REMOVED, RELATION_ADDED, RELATION_REMOVED, DELETE |
| `changes`   | JSONB?       | `[{ path, before, after }]`; null for CREATE/DELETE            |
| `userId`    | String       | Keycloak sub, or `system` for COBISS imports                  |
| `userName`  | String       | Display-name **snapshot** — see Attribution below              |
| `createdAt` | DateTime     |                                                               |

There is deliberately **no foreign key** to drafts/records: a revision outlives
the item it describes, and an FK would either block a delete or cascade the
history away with it. Item writes append their revision inside the same
transaction; file and relation writes (which are not transactional here) log and
swallow a revision failure rather than fail the write.

Paths in `changes` are metadata paths (`title`, `authors[0].familyName`) plus a
few synthetic ones: `visibilityStatus`, `itemType`, `files[<fileId>]`,
`children[<itemId>]`.

**The timeline is read-only — there is no revert.** That is what keeps the
storage decision above viable: diffs are small because they are only ever read
forward. "Restore this revision" would need full metadata snapshots per
revision, or diffs guaranteed to be invertible, and either one multiplies the
size of this table. If revert is ever wanted, that storage decision has to be
reopened first — it is not a feature that can be layered on top of what is here.

#### `user_profiles`
Local shadow of the Keycloak realm's human users.

| Column        | Type       | Notes                                                     |
|---------------|------------|-----------------------------------------------------------|
| `userId`      | String     | PK — Keycloak sub                                          |
| `username`    | String     |                                                            |
| `firstName`   | String?    |                                                            |
| `lastName`    | String?    |                                                            |
| `email`       | String?    | Returned to every caller — the endpoint itself is staff-only |
| `displayName` | String     | Precomputed `formatDisplayName()` output                   |
| `scopes`      | String[]   | Effective `nbcg-api` roles, composites expanded            |
| `canPublish`  | Boolean    | `records:manage` AND `drafts:manage`, derived at write time |
| `enabled`     | Boolean    | Keycloak's own flag — suspended but still on staff          |
| `deletedAt`   | DateTime?  | Set when a *successful* sync no longer finds them           |
| `syncedAt`    | DateTime   |                                                            |

**Written only by the sync job.** See [User Directory](#user-directory). Rows are
never hard-deleted, so a departed user still resolves to a name. `isActive` is
derived (`enabled && deletedAt == null`) rather than stored.

#### `tasks` / `task_history`
**Staff workflow, not metadata.** A task is a conversation between two people
that happens to name an item; nothing here would be exported with the collection.
Both live in `public` anyway — see
`docs/backend/history/task-delegation-plan.md` for why a separate Postgres schema was
considered and deferred.

The pair is the same shape as `drafts`/`records` + `item_revisions`: **current
state in one table, an append-only record of how it got there in another.**

`tasks` — the live handoff:

| Column             | Type      | Notes                                                       |
|--------------------|-----------|-------------------------------------------------------------|
| `id`               | String    | CUID PK                                                      |
| `itemId`           | String    | **No FK** — polymorphic across drafts/records, like `item_relations`. Stable across DRAFT ↔ RECORD |
| `kind`             | Enum      | The current **stage**: GENERAL, FIX_METADATA, REVIEW_PUBLISH. Moves on complete / return |
| `title`            | String    |                                                              |
| `description`      | String?   |                                                              |
| `status`           | Enum      | OPEN, COMPLETED, CANCELLED (v2 — `IN_PROGRESS`/`RETURNED` were removed 2026-09-25) |
| `assignedToUserId` | String    | Keycloak sub. **No FK** — see below                          |
| `createdByUserId`  | String    | Keycloak sub                                                 |
| `dueAt`            | DateTime? |                                                              |
| `completedAt`      | DateTime? | Set on COMPLETED (by complete or by the publish observer). Not set on CANCELLED |
| `handoffs`         | JSONB     | The handoff stack `[{ userId, kind \| null }]`, bottom = requester, top = current holder. See [Tasks](#tasks-delegation) |
| `lastHandoff`      | Enum (`TaskAction`) | How the task reached its holder: CREATED, ADVANCED, RETURNED, ASSIGNED. Drives `?returned=true` |

**At most one `OPEN` task per item** — the partial unique index
`tasks_one_open_per_item` on `("itemId") WHERE status = 'OPEN'`, declared in
`schema.prisma` with Prisma's `partialIndexes` preview feature. Finished and
cancelled tasks are unlimited. (Because the index is partial, the generated
client's `findUnique({ where: { itemId } })` is wrong here — use `findFirst`
with `status: 'OPEN'`.)

`task_history` — what transpired:

| Column     | Type       | Notes                                                     |
|------------|------------|-----------------------------------------------------------|
| `id`       | String     | CUID PK                                                    |
| `taskId`   | String     | **No FK** — see the delete rule below                      |
| `itemId`   | String     | Denormalised, so a row outlives both the task and the item |
| `action`   | Enum       | CREATED, ADVANCED, RETURNED, ASSIGNED, COMPLETED, CANCELLED, COMMENTED, UPDATED, CLOSED_ON_PUBLISH — plus legacy STATUS_CHANGED (v1 rows only, no longer written) |
| `note`     | String?    | What a human reads: the return reason, the comment body    |
| `changes`  | JSONB?     | `[{ path, before, after }]`, same shape as `item_revisions` |
| `userId`   | String     | Keycloak sub of whoever did it                             |
| `userName` | String     | Display-name **snapshot** — see below                      |

**One user action writes exactly one history row**, labelled with the action
route that produced it. A return moves stage and assignee together, so it is a
single `RETURNED` row carrying both in `changes` — not a `RETURNED` plus an
`ASSIGNED` a moment later, which would record two events that never separately
happened. There is no `system` actor: `CLOSED_ON_PUBLISH` names the real
publisher. The log is never rewritten: v1 rows keep their `STATUS_CHANGED`
action and their `IN_PROGRESS`/`RETURNED` values inside `changes`.

**A comment is not its own kind of object.** It is one of the things that can
happen to a task, so it is a `COMMENTED` row in the same log, and the detail read
interleaves comments and events chronologically.

##### Names: snapshot on the log, live on the task

| | Names come from | Because |
|---|---|---|
| `tasks` | the directory, resolved live | a live work item must show who someone **is now**; a renamed assignee showing their old name on an open task is a bug |
| `task_history` | the `userName` column | history is historical — "Ana Novak returned this" must keep saying that after Ana is renamed or leaves |

The governing rule, as elsewhere: **snapshot for a specific row, directory for a
group of rows.** Asserted in §18 by renaming a user and reading both back.

##### Deleting an item deletes its tasks but NOT its history

This asymmetry is the reason the log is a separate table:

| Table | On item delete | Why |
|---|---|---|
| `tasks` | **deleted** | a task pointing at a deleted item is unactionable noise in someone's inbox forever |
| `task_history` | **kept** | it is the audit record; destroying it is the failure mode the table exists to prevent |

Hence no FK on `task_history.taskId` — one would either block the delete or
cascade the audit away with it — and hence the denormalised `itemId`, so
`GET /api/tasks/item/:itemId/history` still answers "what happened around this
record" once both the task and the item are gone. Same call, same reasoning, as
`item_revisions`.

**No FK on `assignedToUserId`.** `user_profiles` is written by a daily sync, so a
user who exists in Keycloak but has not been synced would have their assignment
rejected by the *database* rather than by a 400 — and since directory rows are
never hard-deleted, that is a failure nobody would ever have seen. Same reasoning
as `Draft.createdByUserId`.

**Deliberately no stored `itemType`.** It would go stale on the very transition
the task exists to request, so it is resolved at read time.

Neither table is pgsync-tracked, for the same reason `item_revisions` is not: CDC
re-indexes the whole document on any tracked change, so one log row would
re-index the item it names — metadata and nested `extractedText` included. §18 of
the test suite asserts this.

#### `item_metrics_daily` / `file_metrics_daily`
Usage counters, one row per subject/metric/day.

| Column   | Type | Notes                                        |
|----------|------|----------------------------------------------|
| `itemId` / `fileId` | String | Part of the composite PK          |
| `metric` | Enum | VIEW, DOWNLOAD                                |
| `day`    | Date | UTC day the hit landed in                     |
| `count`  | Int  | Bumped by an upsert, never read-modify-write  |

**These tables must stay out of `infrastructure/docker/pgsync/schema.json`.**
pgsync CDC re-indexes an entire document (metadata plus nested `extractedText`,
which can be megabytes) whenever a watched row changes — a view counter on
`records`/`drafts` would trigger that on every page view, on the hottest path in
the system. That is the whole reason these live in their own tables.

Recording rules: hits are buffered in memory and flushed on a timer
(`METRICS_FLUSH_INTERVAL_MS`, default 2000), so a counter problem can never turn
a page view into a 500. Anonymous hits count. Bot user-agents are dropped. No IP
or visitor identity is stored anywhere. `?inline=1` file reads are previews, not
downloads, and are not counted. A search-results appearance is not a view — only
`GET /api/search/:id` counts, or a 20-hit results page would mean 20 counter
writes per query.

Retention: revisions and counters are kept **forever**; there is no rollup or
pruning job. A row only exists for an item/metric/day that was actually hit, so
growth is bound by traffic rather than by catalogue size × days. Worth
revisiting only if `item_metrics_daily` actually gets large.

### Useful Queries

```sql
-- Count items
SELECT 'drafts' as tbl, count(*) FROM drafts UNION ALL SELECT 'records', count(*) FROM records;

-- List recent drafts
SELECT id, metadata->>'title' as title, "visibilityStatus", "createdAt" FROM drafts ORDER BY "createdAt" DESC LIMIT 10;

-- List recent records
SELECT id, metadata->>'title' as title, "visibilityStatus", "createdAt" FROM records ORDER BY "createdAt" DESC LIMIT 10;

-- Find item by title (either table)
SELECT 'draft' as type, id, metadata->>'title' as title FROM drafts WHERE metadata->>'title' ILIKE '%search_term%'
UNION ALL
SELECT 'record', id, metadata->>'title' FROM records WHERE metadata->>'title' ILIKE '%search_term%';

-- List parent-child relations
SELECT ir."parentId", ir."childId", ir."parentType", ir."childType",
  COALESCE(d.metadata->>'title', r.metadata->>'title') as parent_title
FROM item_relations ir
LEFT JOIN drafts d ON ir."parentId" = d.id
LEFT JOIN records r ON ir."parentId" = r.id
LIMIT 20;

-- File attachments for an item
SELECT fa.id, fa.filename, fa."fileType", fa."mimeType", fa."sizeBytes"
FROM file_attachments fa
WHERE fa.draft_id = '<item_id>' OR fa.record_id = '<item_id>';

-- Items with COBISS IDs
SELECT id, metadata->>'cobissId' as cobiss_id, metadata->>'title' as title FROM records WHERE metadata->>'cobissId' IS NOT NULL LIMIT 10;
```

---

## OpenSearch

### Direct Access

```bash
# Cluster health
curl http://localhost:9200/_cluster/health?pretty

# List indices
curl http://localhost:9200/_cat/indices?v

# Index mapping
curl http://localhost:9200/records/_mapping?pretty
curl http://localhost:9200/drafts/_mapping?pretty

# Count documents
curl http://localhost:9200/records/_count?pretty
curl http://localhost:9200/drafts/_count?pretty
```

### Index Structure

Both `records` and `drafts` indices mirror the database tables via PGSync:
- Root fields: `id`, `visibilityStatus`, `metadata` (object), `createdAt`, `updatedAt`, `createdByUserId`, `createdByName`, `updatedByUserId`, `updatedByName`
  - the two `…ByName` fields are mapped `keyword`, not `text`: sorting and terms aggregations on the creator name are the whole reason they are indexed. Full-text search over creator names is not a requirement — the picker resolves a name to a UUID and filters on `createdByUserId`. They are **stripped** for principals below the attribution bar (see [Attribution](#attribution)).
- Nested `file_attachments[]`: `id`, `fileType`, `role`, `filename`, `mimeType`, `sizeBytes`, `textExtractionStatus`, `extractedText`, `createdAt`
- `parent_relations[]` (object, not nested): `parentId`, `parentType`
- `metadata` is mapped dynamically (strings → `text` + `.keyword`), with one
  declared exception: `metadata.issue.date` is `keyword`, so a partial date
  (`1905`, `1905-03`) never depends on which document happened to be indexed
  first (dynamic date detection would make the field `date` or `text`
  depending on that). ISO strings sort correctly as keywords, and a prefix
  query `1905-03` finds every issue of that month.
- **Accent-insensitive text** (since 2026-09-25, schema v2 B12): both indices
  set a custom `default` analyzer — `standard` tokenizer, `lowercase`,
  `asciifolding` with `preserve_original` — in the `setting` block of
  `infrastructure/docker/pgsync/schema.json`. Every `text` field is indexed
  and searched as both `nikšić` and `niksic`, so `Niksic` finds `Nikšić` in
  search and suggest with no query change; an exact accented match still
  scores higher. `.keyword` sub-fields are untouched (aggregations show the
  stored spelling). Settings only apply to a new index — see the reindex
  procedure in [opensearch-reindex.md](../infrastructure/opensearch-reindex.md).

### Search Queries

```bash
# Search all documents
curl -s 'http://localhost:9200/records/_search?pretty' -H 'Content-Type: application/json' -d '{
  "query": { "match_all": {} },
  "size": 5
}'

# Full-text search by title
curl -s 'http://localhost:9200/records/_search?pretty' -H 'Content-Type: application/json' -d '{
  "query": {
    "match": {
      "metadata.title": "search term"
    }
  }
}'

# Search by author
curl -s 'http://localhost:9200/records/_search?pretty' -H 'Content-Type: application/json' -d '{
  "query": {
    "multi_match": {
      "query": "author name",
      "fields": ["metadata.authors.familyName", "metadata.authors.firstName"]
    }
  }
}'

# Search across both indices
curl -s 'http://localhost:9200/records,drafts/_search?pretty' -H 'Content-Type: application/json' -d '{
  "query": {
    "match": { "metadata.title": "keyword" }
  },
  "size": 10
}'

# Filter by visibility
curl -s 'http://localhost:9200/records/_search?pretty' -H 'Content-Type: application/json' -d '{
  "query": {
    "term": { "visibilityStatus": "PUBLIC" }
  }
}'

# Find children of a parent
curl -s 'http://localhost:9200/records,drafts/_search?pretty' -H 'Content-Type: application/json' -d '{
  "query": {
    "term": { "parent_relations.parentId": "<parent_id>" }
  }
}'

# Get specific document
curl -s 'http://localhost:9200/records/_doc/<id>?pretty'
```

---

## REST API Endpoints

Base URL: `http://localhost:3000/api`

### Health

```bash
# Health check
curl http://localhost:3000/api/health
```

---

### Search

```bash
# Full-text search (all items)
curl 'http://localhost:3000/api/search?q=keyword&page=1&limit=20'

# Search only records
curl 'http://localhost:3000/api/search?q=keyword&type=records'

# Search only drafts
curl 'http://localhost:3000/api/search?q=keyword&type=drafts'

# Advanced search with filters
curl 'http://localhost:3000/api/search?title=Montenegro&author=Scherb&year=1850-1860&language=ger&materialType=am'

# Filter by publisher
curl 'http://localhost:3000/api/search?publisher=Suppan'

# Filter by ISBN/ISSN/COBISS ID
curl 'http://localhost:3000/api/search?cobissId=922222'
curl 'http://localhost:3000/api/search?isbn=978-3-16-148410-0'

# Get item by ID
curl http://localhost:3000/api/search/<item_id>

# Get children of a parent item (paginated)
curl 'http://localhost:3000/api/search/<parent_id>/children?page=1&limit=20'
```

**Search query params:**
| Param          | Type   | Description                                |
|----------------|--------|--------------------------------------------|
| `q`            | string | Full-text search (title, subtitle, authors, series, notes, filenames) |
| `type`         | string | `all` (default), `records`, `drafts`       |
| `page`         | number | Page number, 1-indexed (default: 1)        |
| `limit`        | number | Results per page, 1-100 (default: 20)      |
| `title`        | string | Filter by title (phrase prefix)            |
| `author`       | string | Filter by author name                      |
| `publisher`    | string | Filter by publisher                        |
| `series`       | string | Filter by series title                     |
| `year`         | string | Publication year or range: `1990` or `1990-2000` |
| `language`     | string | Language code (e.g. `ger`, `cnr`)          |
| `materialType` | string | Material type code (e.g. `am`)             |
| `isbn`         | string | ISBN (exact match, hyphens stripped)        |
| `issn`         | string | ISSN (exact match, hyphens stripped)        |
| `cobissId`     | string | COBISS ID (exact match)                    |
| `fullText`     | string | Search extracted PDF text; hits include `matchedFiles` with highlight snippets |
| `fields`       | string | Comma-separated `_source` projection. **Allowlisted** — see below |
| `sort`         | string | `relevance` (default) or `newest`          |

`year` must be `YYYY` or `YYYY-YYYY` (range start must not exceed end) — anything else returns 400.

`fields` is checked against an allowlist and unknown names are dropped silently.
`id` is always included, and the `_source` excludes are applied on top of the
projection — so naming a parent object cannot pull an excluded child back out
(`?fields=file_attachments` still withholds `extractedText`, and a principal
below the attribution bar cannot re-request `createdByName`).

**Response format:**
```json
{
  "total": 150,
  "page": 1,
  "limit": 20,
  "pages": 8,
  "hits": [
    {
      "id": "cuid_here",
      "index": "records",
      "score": 5.234,
      "source": {
        "id": "cuid_here",
        "visibilityStatus": "PUBLIC",
        "metadata": { "title": "...", "authors": [...], ... },
        "file_attachments": [...],
        "parent_relations": [...]
      }
    }
  ]
}
```

### Suggest (typeahead)

```bash
# Top values of one field, optionally narrowed by a typed prefix
curl 'http://localhost:3000/api/search/suggest?field=publisher&q=Obod&limit=5'
# -> { "field": "publisher", "suggestions": [ { "value": "Obod", "count": 12 }, ... ] }

# ResolvedCode fields return the whole code object as the value
curl 'http://localhost:3000/api/search/suggest?field=language&limit=50'
# -> { "field": "language", "suggestions": [ { "value": { "code": "cnr", "en": "...", "cnr": "..." }, "count": 40 } ] }

# author returns { familyName, firstName, ... } objects
curl 'http://localhost:3000/api/search/suggest?field=author&q=Njego&limit=5'
```

| Param   | Notes |
|---------|-------|
| `field` | Allowlisted in `src/modules/search/suggest-fields.ts`: `title`, `subtitle`, `seriesTitle`, `publisher`, `place`, `placeOfManufacture`, `manufacturerName`, `firstResponsibility`, `edition`, `notes`, `keywords`, `corporateBody` (`corporateBodies[].name`), `dimensions`, `physicalDescription`, `language`, `originalLanguage`, `materialType`, `country`, `recordType`, `bibliographicLevel`, `author`. Anything else is a 400 listing the supported names. Every `suggest` in [schema v2](#schema-v2) must name one of these — checked at boot. |
| `q`     | Optional. `match_phrase_prefix` on the text field; omitted = top values overall. |
| `limit` | 1–50, default **5** (was 10 before schema v2; every web call passes its own). |
| `type`  | `all` (default), `records`, `drafts` — then intersected with what the caller may see. |

How it works: a `size: 0` query filtered by the caller's visibility, plus a
`terms` aggregation on the `.keyword` sub-field ordered by document count. So
the answer is "values **already used in the data**, most common first":

- A value nobody has used yet can never be suggested. That is right for free
  text (publisher spellings) and wrong for controlled vocabularies — those have
  their own endpoint, [`/search/vocabularies/:name`](#vocabulary-search), which
  searches the code list itself.
- **Post-filter** (since schema v2): with `q`, OpenSearch is asked for
  `limit × 5` buckets and only the ones that really match `q` are kept — exact
  match first, then prefix, then substring, most used first within each. Before
  this, array fields (`notes`, `keywords`, `authors`, `language`, …) returned
  every value of every matching document, so `q=Fo` on notes `["Foo", "Bar"]`
  also suggested `Bar`. Code: `rankByQuery` in `src/shared/util/text-match.ts`.
- The post-filter compares accent-, case- and punctuation-insensitively
  (`Nikšić` = `niksic`, `đ` = `d`, `Beograd : Prosveta` = `beograd prosveta`).
  Since 2026-09-25 OpenSearch itself matches accent-insensitively too (the
  folding analyzer, [Index Structure](#index-structure)), so `q=Niksic` finds
  documents holding `Nikšić` and the post-filter keeps the bucket.

### Vocabulary search

```bash
# Search a controlled vocabulary (the code list, not the data). Public.
curl 'http://localhost:3000/api/search/vocabularies/language?q=crn&limit=5'
# -> { "field": "language",
#      "suggestions": [ { "value": { "code": "cnr", "en": "Montenegrin", "cnr": "Crnogorski" } } ] }
```

- `:name` is any vocabulary in the [schema v2](#schema-v2) registry:
  `materialType`, `recordType`, `bibliographicLevel`, `language`, `country`,
  `illustration`, `contentType`, `literaryForm`, `biography`, `relator`,
  `extentUnit`, `responsibility`, `collectionType`. Unknown → `404`.
- Matches `code`, `en` and `cnr` with the same normalisation and ranking as the
  suggest post-filter (exact → prefix → substring, registry order within each).
  Relator codes are COMARC's numeric ones (`070` = author).
- `limit` 1–50, default 5; no `q` → the first `limit` values.
- Same response shape as suggest minus `count`, so a client needs one parser.
  `collectionType` codes stay numbers.
- In-memory: `src/modules/schema/v2/vocabulary-search.ts`, index built on first
  use per vocabulary. Route declared above `:id/children` in `SearchController`.

### Schema (v2)

```bash
# One schema for every material type and level — the conditions are inside. Public.
curl -i 'http://localhost:3000/api/schema/v2/record'
# -> ETag: "…", Cache-Control: no-cache
# -> { schemaVersion: 2, languages: ["en","cnr"], inlineVocabularyMax: 50,
#      context: [...], vocabularies: {...}, groups: [...], fields: [...] }
curl -i -H 'If-None-Match: "<etag>"' 'http://localhost:3000/api/schema/v2/record'   # -> 304
```

The full contract (every property, the rule language, editor rules) is in
[shared/plans/metadata-schema-v2.md](../shared/plans/metadata-schema-v2.md).
How the backend builds and guards it:

| Piece | File (`src/modules/schema/`) |
|---|---|
| Field list: keys, types, groups, `suggest`, rules — hand-written data only | `v2/record-fields.ts` |
| Captions `{ en, cnr }` for fields, groups and rule overrides | `v2/labels.ts` |
| Vocabulary registry (from `cobiss-code-map.ts` + `collectionType`, `responsibility`, `extentUnit`); `INLINE_VOCABULARY_MAX = 50` decides `values` vs `search` | `v2/vocabularies.ts` |
| Builder: computes `input` and `order`, attaches labels, assembles the body | `v2/build-schema.ts` |
| Self-check, run in jest **and** in `SchemaService.onModuleInit` — a bad schema cannot boot | `v2/self-check.ts` |
| Rule evaluator + save check, **portable** (no imports; copied verbatim to the web frontend and the archive app) | `rules/evaluate.ts` |
| Conformance cases every copy must pass (web, archive app) | `rules/conformance.json` |
| Validation on save (every write) | `metadata-validator.service.ts` |

- ~41 KB (v1: ~98 KB): `language` (449), `relator` (116) and `contentType`
  (69) are not inlined but point at [vocabulary search](#vocabulary-search);
  one `language` vocabulary serves all three language fields.
- `Cache-Control: no-cache` + MD5 `ETag`: clients revalidate on every load and
  get a 304, so a deploy never leaves anyone on a stale schema.
- The **self-check** refuses a schema that: advertises a key the API does not
  accept (the old `summaryNote` bug) or a shape its validator rejects or
  changes (probed with a sample value per field); omits a key the API accepts;
  uses an undeclared context key in a rule or sets anything but
  `visible/required/readOnly/unit/label/help/constraints`; names an unknown
  vocabulary, a suggest field outside `SUGGEST_FIELDS`, or a unit outside
  `extentUnit`; lacks a caption in either language; has a `default` that is not
  a value of its field (a code, for an enum).
- v1's `levels: ['main']` became a rule: those 10 fields (`collectionType`,
  `isbn`, `ismn`, `textualMaterialCodes`, `titleByAnotherAuthor`, `authors`,
  `corporateBodies`, `edition`, `cartographicMathematicalData`,
  `musicEditionStatement`) are hidden **only for an issue of a serial**
  (`parentCollectionType ∋ 4`). Children of other collections keep them.
- **Draft and record rules** (since 2026-09-25, B8): the context key
  `targetState` (`DRAFT` | `RECORD`) is the state a save goes to. A draft
  needs `title`, `materialType`, `collectionType`, `corporateBodies[].name`,
  `electronicLocation[].url`; a record also `extent`, map scale
  (`cartographicMathematicalData`), `issue.number` and `issue.date` — each
  through a rule `when: { ref: targetState, eq: RECORD }` (`FOR_RECORD`).
- `default` on a field (since 2026-09-25): the value a new item starts with;
  only `collectionType` has one (`0`). The self-check refuses a default that is
  not a value of its field.
- `numberingAndDates` (207) is no longer `issueIdentifying` — it is the
  serial's own statement; an issue uses `issue`.
- Rules follow the contract's initial rule table (still to be confirmed by the
  library). Changing a rule = edit `record-fields.ts` + the matching cases in
  `conformance.json`; `evaluate.spec.ts` runs them.

**Captions that need a Montenegrin check** (marked `NEW` in `v2/labels.ts`;
everything else was copied from the web frontend's i18n): groups *Osnovno*,
*Podaci o broju*, *Izdanje i posebni podaci*, *Kodirani datumi*, *Predmet*;
fields *Podaci o broju* / *Godište* / *Broj* / *Datum izlaska* (issue),
*Obim* (extent), *Podatak o obimu* (215/a, renamed because `extent` took
"Obim"), *Ključne riječi*; rule captions *Broj strana*, *Trajanje*, *Broj
listova*, *Razmjera* (map scale); help *Slobodne ključne riječi (610)*,
*GGGG, GGGG-MM ili GGGG-MM-DD*; unit abbreviations in `extentUnit` (*str.*,
*list.*, *sv.*, *kom.*, *min*).

### Schema (v1)

**Frozen** until the archive app has moved to v2, then deleted (backend plan
B7). The v2 fields (`summaryNote`, `keywords`, `extent`, `issue`) are
deliberately not in it.

```bash
# Field descriptors for building a metadata editor. Public, no auth needed.
curl 'http://localhost:3000/api/schema/record'
curl 'http://localhost:3000/api/schema/record?level=main'    # or child
# -> { "fields": [ { key, type, required, itemType?, allowedValues?, objectShape?,
#                    group, order, parentInheritable, issueIdentifying, levels } ] }
```

- Built once at module load in `src/modules/schema/schema.service.ts` from a
  hand-written list next to the COBISS code maps; cached per `level` with an
  MD5 `ETag` (`If-None-Match` → 304).
- `Cache-Control: public, max-age=86400` — a client may use a stale schema for
  up to a day after a deploy without revalidating.
- `required` is **advisory**: the only field the API enforces is `title`.
- Every coded field ships its full `allowedValues` inline (449 languages ×3
  language fields), ~98 KB in total.
- No labels: every client carries its own field names/translations.
- **The desktop archive app builds its whole editor from this response**, so
  the shape is a public contract — see `docs/shared/archive-app.md` before
  changing it.

---

### Items

```bash
# Create item
curl -X POST http://localhost:3000/api/items \
  -H 'Content-Type: application/json' \
  -d '{
    "targetState": "DRAFT",
    "visibilityStatus": "PRIVATE",
    "metadata": {
      "title": "Book Title",
      "subtitle": "Optional subtitle",
      "authors": [
        {
          "familyName": "Doe",
          "firstName": "John",
          "responsibility": "primary",
          "role": { "en": "Author", "cnr": "Autor", "code": "070" }
        }
      ],
      "language": [{ "en": "German", "cnr": "Nemacki", "code": "ger" }],
      "country": [{ "en": "Montenegro", "cnr": "Crna Gora", "code": "cnr" }],
      "materialType": { "en": "Book", "cnr": "Knjiga", "code": "am" },
      "recordType": { "en": "Textual material, printed", "cnr": "Tekstualna gradja, stampana", "code": "a" },
      "bibliographicLevel": { "en": "Monograph", "cnr": "Monografska publikacija", "code": "m" },
      "publication": {
        "year": "1851",
        "place": "Agram",
        "publisher": "Franz Suppan"
      },
      "cobissId": "922222",
      "edition": "2. Aufl.",
      "dimensions": "18 cm",
      "physicalDescription": "253 str."
    },
    "parentIds": ["collection-id"]
  }'
# -> 201 { …the item…, "parents": [ { "parentId": "collection-id", "version": 5,
#                                    "childrenInDrafts": 3, "childrenInRecords": 0 } ] }

# Update item
curl -X PATCH http://localhost:3000/api/items/<item_id> \
  -H 'Content-Type: application/json' \
  -d '{
    "expectedVersion": 3,
    "visibilityStatus": "PUBLIC",
    "metadata": {
      "title": "Updated Title"
    }
  }'
# -> 200 { "version": 4 }

# Delete items
curl -X DELETE http://localhost:3000/api/items \
  -H 'Content-Type: application/json' \
  -d '{
    "ids": ["id-1", "id-2"]
  }'

# Transition items between DRAFT <-> RECORD
curl -X POST http://localhost:3000/api/items/transition \
  -H 'Content-Type: application/json' \
  -d '{
    "targetState": "RECORD",
    "ids": ["id-1", "id-2"]
  }'
# -> 201 [ { "id": "id-1", "version": 4 }, { "id": "id-2", "version": 2 } ]

# Dry run of the save check for one item: RECORD (default — can it be
# published?) or DRAFT. Gated like reading the item (404, not 403, when the
# caller cannot see it); anonymous works on a public record.
curl 'http://localhost:3000/api/items/<id>/validation?target=RECORD'
# -> 200 { "ok": false,
#          "missing":    [ { "path": "extent", "label": { "en": "Number of pages", "cnr": "Broj strana" } } ],
#          "violations": [] }
```

**`parentIds` on create** (since 2026-09-25, schema v2 B10): optional array of
item ids. The item is checked with those parents (an issue of a serial needs
its issue data as a RECORD), then the item, one relation per parent, the
item's `CREATE` revision and each parent's `RELATION_ADDED` revision are
written in one transaction. Duplicates are linked once. The response adds
`parents` — one entry per parent, the same shape `relations/connect` returns —
always present (`[]` without `parentIds`). Linking changes the parent, so the
caller needs manage rights on each parent's collection (403 otherwise, e.g. a
cataloguer under a RECORD parent). A parent that does not exist:

```json
{ "statusCode": 400, "code": "PARENT_NOT_FOUND",
  "message": "Parent not found: clx…", "parentIds": [ "clx…" ] }
```

`parentIds` lists only the missing ids; nothing is created.

**Validation on save** (metadata schema v2; publish-only since 2026-09-24,
every write since 2026-09-25): each write is checked against the rules of the
state the item ends up in (`targetState`):

| Write | Rules of | Parents |
|---|---|---|
| `POST /items` | the requested `targetState` | `parentIds` |
| `PATCH /items/:id` with non-empty `metadata` (the stored metadata with the patch applied) | the item's current state — a RECORD stays complete | `item_relations` |
| `POST /items/transition` (single, bulk, or through a REVIEW_PUBLISH task) | the new state, both directions | `item_relations` |
| `POST /relations/connect` / `disconnect` | each child, in its current state | after the change |

Each field is evaluated with the item's context (material type,
collectionType, parents' collectionType, `targetState`); **missing** = visible
+ required + empty (`null`, blank string, `[]`, `{}`), **violations** = a
value that breaks its `constraints`, or a `quantity` whose stored unit is not
the evaluated one (`extent` in pages on a video). An empty field is never
format-checked, so one path is either missing or a violation. Hidden fields are
never checked. Repeatable objects are checked per element
(`corporateBodies[1].name`). Failure is all-or-nothing, inside the write's
transaction, before anything is written:

```json
{ "statusCode": 400, "code": "METADATA_VALIDATION_FAILED",
  "message": "1 of 2 items are not ready to publish",
  "items": [ { "id": "clx…", "state": "RECORD",
               "missing": [ { "path": "extent", "label": { "en": "Number of pages", "cnr": "Broj strana" } } ],
               "violations": [ { "path": "publication.year", "label": { … }, "constraint": "pattern", "hint": { … } } ] } ] }
```

`items` lists only the failing items; `id` is `null` for a `POST /items` that
created nothing; `state` is whose rules the item failed. `message` says "not
ready to publish" when every failing item is a RECORD, "cannot be saved"
otherwise (`1 of 1 item cannot be saved`). A violation carries `constraint` (a
`constraints` key or `unit`), plus `limit` (the broken bound / expected unit)
or `hint` (a `patternHint`) when there is one. Until 2026-09-25 the code was
`PUBLISH_VALIDATION_FAILED`, without `state`.

Not checked: a `PATCH` that only changes `visibilityStatus`; children when
their parent's metadata changes or the parent is deleted (each child is checked
on its own next save); the COBISS import worker (it reports would-fail items as
[warnings](#import-cobiss) instead). What is required: for a **draft**
`title`, `materialType`, `collectionType` (`POST /items` fills in `0`), a
`name` in each `corporateBodies` entry, a `url` in each `electronicLocation`
entry; for a **record** also `extent` (books, video, sound — not on a
collection), map scale (`cartographicMathematicalData`, maps), `issue.number`
+ `issue.date` (an issue of a serial). The rule table lives in
`src/modules/schema/v2/record-fields.ts`.

**What `version` means:**

`version` is a **write counter, not a change counter** — it counts accepted
writes against the item, not the number of times its content actually changed.
Specifically:

- A `PATCH` that sets a field to the value it already holds still bumps
  `version` (and `updatedAt`). The no-op check tests whether the *payload* is
  empty, never whether the values differ from what is stored.
- Relation writes bump the parent's `version` **without** the parent being
  touched by any client: every edge row fires `trg_item_relations_children_count`,
  which rewrites the parent's children counts and increments its `version`.
  Connecting N children advances the parent by N.
- That trigger uses raw SQL, so the parent's **`updatedAt` does not move** even
  though its `version` and `metadata` did. `updatedAt` is not a reliable change
  signal for parents.

So `version` is correct for optimistic concurrency (its actual purpose) but must
**not** be used to detect whether content changed — e.g. to skip re-indexing or
to decide whether a mirror is stale.

Because relation writes and transitions move the version out from under a
client, every endpoint that bumps a version reports the resulting value:

| Endpoint | Returns |
|---|---|
| `POST /api/items` | the item, plus `parents: { parentId, version, childrenInDrafts, childrenInRecords }[]` for `parentIds` |
| `PATCH /api/items/:id` | `{ version }` — the new version, or the unchanged one when the payload had nothing to write |
| `POST /api/relations/connect` | `{ parentId, version, childrenInDrafts, childrenInRecords }` |
| `POST /api/relations/disconnect` | same as `connect` |
| `POST /api/items/transition` | `{ id, version }[]` |

This lets a client that connects children `PATCH` that parent immediately,
instead of recovering the version through the CDC-lagged search index.

**Do not build change history on `version`.** For "what changed, when, by whom",
read `item_revisions` via `GET /api/items/:id/history` — that is recorded
explicitly at write time and does correspond to real changes.

An empty `PATCH` (no `visibilityStatus`, no non-empty `metadata`) is validated
exactly as strictly as a real one: it still returns `404` for a missing id and
`409` for a stale `expectedVersion`.

**Clearing a field, and fields that cannot change** (since `cd8e5bd`):

- `PATCH` merges `metadata` over the stored blob **one top-level key at a time**:
  a nested object such as `publication` is replaced whole, and a key left out
  stays as it is. A top-level key sent as **`null` is removed**, which is how a
  client clears a field. On create, `null` is the same as leaving the key out.
- `cobissId` is fixed at creation, because it is baked into the item id. A
  `PATCH` that sends any other value, including `null` or a first value for an
  item created without one, gets `400 cobissId cannot be changed after
  creation`. Sending the stored value again is fine.
- `title` is required by the schema in both states, so a create without one,
  or a `PATCH` sending `title: null` / `""`, gets `400
  METADATA_VALIDATION_FAILED` naming `title` (was `400 title must not be empty`
  until 2026-09-25).

**Metadata fields:**
| Field                   | Type             | Notes                              |
|-------------------------|------------------|------------------------------------|
| `title`                 | string           | Required (draft and record)        |
| `subtitle`              | string           |                                    |
| `authors`               | Author[]         | `{familyName, firstName, responsibility, role}` |
| `cobissId`              | string           | If set, generates deterministic ID; cannot change after creation |
| `language`              | CodedValue[]     | `{en, cnr, code}`                  |
| `country`               | CodedValue[]     | `{en, cnr, code}`                  |
| `materialType`          | CodedValue       | `{en, cnr, code}` — required (draft and record) |
| `recordType`            | CodedValue       | `{en, cnr, code}`                  |
| `bibliographicLevel`    | CodedValue       | `{en, cnr, code}`                  |
| `publication`           | object           | `{year, place, publisher, manufacturerName, placeOfManufacture}` |
| `edition`               | string           |                                    |
| `dimensions`            | string           |                                    |
| `physicalDescription`   | string           | 215/a free text, e.g. `"253 str."` |
| `extent`                | object           | `{value, unit}` — integer ≥ 0 + an `extentUnit` code (`pages`, `sheets`, `volumes`, `items`, `minutes`); schema v2; COBISS import fills it from 215/a when the unit fits the type |
| `issue`                 | object           | `{volume, number, date}` — `date` is `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (a real calendar date); one issue of a serial; schema v2 |
| `keywords`              | string[]         | 610/a free keywords; parsed from COBISS; schema v2 |
| `summaryNote`           | string           | 330/a summary; parsed from COBISS; schema v2 (was dropped silently before) |
| `notes`                 | string[]         |                                    |
| `isbn`                  | string[]         |                                    |
| `issn`                  | string[]         |                                    |
| `seriesTitle` …         | string           | `seriesTitle`, `seriesSubtitle`, `seriesResponsibility`, `seriesIssn`, `seriesVolume` |
| `collectionType`        | number           | Required; set to 0 when not sent (schema `default: 0`) |
| `jeGlavnoGradivo`       | boolean          | Auto-set to true                   |
| `childrenInDrafts`      | number           | Auto-managed via DB triggers       |
| `childrenInRecords`     | number           | Auto-managed via DB triggers       |
| `_source`               | string           | Auto-set: `cobiss` or `nbcg`       |
| `publicationDate1`      | string           |                                    |
| `firstResponsibility`   | string           |                                    |
| `textualMaterialCodes`  | object           | `{literaryForm, illustrationCodes}` |

---

### History & Statistics

All four are behind `records:view:hidden` + `drafts:view:hidden` — the same
guard as `/api/items/stats`. They name who edited what and count items an
anonymous visitor cannot see, so they are admin-only regardless of the
visibility of the items involved.

```bash
# Revision timeline for one item, newest first (limit ≤ 200)
curl "http://localhost:3000/api/items/<id>/history?limit=50&offset=0" -H "Authorization: Bearer $TOKEN"
# -> { itemId, total, limit, offset, revisions: [ { id, itemId, version, action, changes, userId, userName, createdAt } ] }
# An unknown id returns 200 with total 0 — a deleted item keeps its history.

# Totals + created/published/updated and views/downloads over time
curl "http://localhost:3000/api/stats/overview?from=2026-07-01&to=2026-07-31" -H "Authorization: Bearer $TOKEN"
# -> { range, totals, activity: { totals, created[], published[], updated[], deleted[] },
#      usage: { totals, views[], downloads[] } }

# Per-cataloguer productivity
curl "http://localhost:3000/api/stats/users?from=2026-07-01&to=2026-07-31&limit=50" -H "Authorization: Bearer $TOKEN"
# -> { range, limit, users: [ { userId, displayName, created, published, edited, deleted, total } ] }

# Most viewed / most downloaded, plus the individual files behind the downloads
curl "http://localhost:3000/api/stats/items/top?metric=DOWNLOAD&limit=10" -H "Authorization: Bearer $TOKEN"
# -> { range, limit, mostViewed[], mostDownloaded[], topFiles[] }
```

`from`/`to` are inclusive UTC days (`YYYY-MM-DD`) — the resolution the metrics
table stores. They default to the last 30 days and a range wider than 366 days
is a 400, so a dashboard refresh can never table-scan the metrics table.

`userId` is the raw Keycloak sub, resolved to a display name through the
`user_profiles` directory via `UsersService.resolveNames()`. Names come from that
table rather than from the `userName` snapshots on the rows being grouped,
because grouping by a snapshot would split a renamed person into several rows.

---

### Users (directory)

```bash
# The staff list. Requires drafts:manage OR records:manage; a reader gets 403
# and anonymous gets 401.
curl "$API/users" -H "Authorization: Bearer $TOKEN"
# -> { total, users: [ { userId, username, displayName, canPublish, isActive, enabled, deletedAt, email } ] }

# Who can publish — records:manage AND drafts:manage. Includes editor, EXCLUDES
# cataloguer. This is what an assignee picker for a REVIEW_PUBLISH task reads.
curl "$API/users?capability=publish" -H "Authorization: Bearer $TOKEN"

# Everyone who writes — drafts:manage OR records:manage. Includes cataloguer,
# excludes reader. The picker for GENERAL tasks.
curl "$API/users?capability=staff" -H "Authorization: Bearer $TOKEN"

# A single scope: drafts:manage / records:manage. The picker for FIX_METADATA —
# `drafts` when the item is a draft, `records` when it is a published record
# (a cataloguer cannot edit a published record).
curl "$API/users?capability=drafts" -H "Authorization: Bearer $TOKEN"
curl "$API/users?capability=records" -H "Authorization: Bearer $TOKEN"

# Include suspended and departed users (default is active only)
curl "$API/users?active=false" -H "Authorization: Bearer $TOKEN"

# Substring over displayName, username and email
curl "$API/users?q=jern" -H "Authorization: Bearer $TOKEN"

# One profile
curl "$API/users/$SUB" -H "Authorization: Bearer $TOKEN"

# Trigger a reconcile now (users:manage — admins only). Returns immediately;
# the work runs on the queue.
curl -X POST "$API/users/sync" -H "Authorization: Bearer $ADMIN_TOKEN"
# -> 201 { "jobId": "12" }

# Last run, last error, current row count (users:manage)
curl "$API/users/sync/status" -H "Authorization: Bearer $ADMIN_TOKEN"
# -> { lastRun: { startedAt, finishedAt, durationMs, seen, upserted, markedDeleted, restored },
#      lastError: { at, message } | null, running, profileCount }
```

**Reads require a write capability, not merely authentication.** The directory
exists to serve the task-delegation assignee picker, so the bar is `assertIsStaff`
— `drafts:manage` OR `records:manage`. `@RequireScopes` is AND-only and cannot
express that disjunction, which is why this is a service call rather than a
decorator.

`email` is returned unconditionally as a result. It used to be withheld below the
staff bar; once nobody below that bar can reach the endpoint at all, the check was
dead code that every call site still had to reason about. Everyone who can call
this is internal staff who can see each other in Keycloak anyway.

`?limit` defaults to 100 and caps at 500. Combining `capability` and `q` filters
to the capability and then searches within it — both conditions apply.

---

### Tasks (delegation)

Task workflow v2 (shipped 2026-09-25; contract:
`docs/shared/plans/task-workflow-v2.md`). A task is `OPEN` until it ends; its
`kind` is the **stage** it is in. State moves only through one route per action;
`PATCH` edits details. At most one open task per item.

Every route requires `drafts:manage` OR `records:manage` (`assertIsStaff`) — a
reader gets 403, anonymous gets 401. Who may do *which* action is then decided
per task:

| Action | Assignee | Creator | `records:manage` (escape hatch) |
|---|---|---|---|
| complete, return | ✔ | — | ✔ |
| reassign, cancel, PATCH details | ✔ | ✔ | ✔ |
| comment | any staff | | |

```bash
# File a task. Also requires being able to VIEW the item: an item the caller
# cannot see returns 404, not 403, so this cannot probe for hidden records.
curl -X POST "$API/tasks" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "itemId": "...", "kind": "REVIEW_PUBLISH",
        "title": "Ready for review", "assignedToUserId": "<sub>" }'
# -> 201 { id, itemId, itemType, kind, title, description, status,
#          assignedToUserId, assignedToName, createdByUserId, createdByName,
#          dueAt, createdAt, updatedAt, completedAt, lastHandoff }
# -> 409 { statusCode: 409, code: "ITEM_HAS_OPEN_TASK", message, taskId }
#        when the item already has an open task

# Finish the current stage (see "Complete — by stage")
curl -X POST "$API/tasks/$ID/complete" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "note": "Fixed.", "next": { "kind": "REVIEW_PUBLISH", "assignedToUserId": "<sub>" } }'

# Back one step — note REQUIRED; assignedToUserId overrides the person, not the stage
curl -X POST "$API/tasks/$ID/return" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "note": "The author field is wrong." }'

# Same stage, different person (never yourself, never the current holder)
curl -X POST "$API/tasks/$ID/reassign" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "assignedToUserId": "<sub>", "note": "On leave." }'

# Terminal
curl -X POST "$API/tasks/$ID/cancel" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "note": "Filed by mistake." }'
# All four -> 200 with the task view (no history), or 400 if the task is
# COMPLETED/CANCELLED already.

# Details only. status / kind / assignedToUserId -> 400 "use the action
# endpoints"; note -> 400 "use /comments".
curl -X PATCH "$API/tasks/$ID" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "title": "…", "dueAt": "2026-10-01" }'

# My inbox. All staff see all tasks — assignedTo is a filter, not a wall.
curl "$API/tasks?assignedTo=me&status=OPEN" -H "Authorization: Bearer $TOKEN"

# "Returned to you"
curl "$API/tasks?assignedTo=me&status=OPEN&returned=true" -H "Authorization: Bearer $TOKEN"

# The "has an open task" badge: one call per page of items (one status now)
curl "$API/tasks?itemIds=a,b,c&status=OPEN" -H "Authorization: Bearer $TOKEN"

# Detail: the task, its whole log, and where Return would send it
curl "$API/tasks/$ID" -H "Authorization: Bearer $TOKEN"
# -> { ...,
#      history: [ { id, action, note, changes, userId, userName, createdAt } ],
#      returnTarget: { userId, displayName, kind } | null }

# A comment is a COMMENTED row in the same log
curl -X POST "$API/tasks/$ID/comments" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "body": "Looking at it now." }'

# What happened around an item, ACROSS TASKS THAT NO LONGER EXIST.
# Gated like /items/:id/history: cataloguer yes, reader no.
curl "$API/tasks/item/$ITEM_ID/history" -H "Authorization: Bearer $TOKEN"
# -> { total, history: [ { ..., taskId } ] }
```

Filters: `assignedTo` · `createdBy` (both accept `me`) · `itemId` · `itemIds`
(comma-separated, max 200) · `status` (`OPEN` | `COMPLETED` | `CANCELLED`) ·
`kind` · `returned` (`true` = `lastHandoff` is `RETURNED`, `false` = anything
else) · `limit` (default 50, max 200) · `offset`.

There is **no `expectedVersion`**: two people editing one task's title is not a
real collision. The action routes lock the task row (`SELECT … FOR UPDATE`) so
two simultaneous returns cannot both pop the stack. A `PATCH` that moves nothing
writes no history row.

#### Complete — by stage

| Stage | Body | Result | History row |
|---|---|---|---|
| `GENERAL` | `{ note? }` | COMPLETED | `COMPLETED` |
| `GENERAL` | `{ note?, next: { kind: FIX_METADATA \| REVIEW_PUBLISH, assignedToUserId } }` | stays OPEN in `next.kind`; assignee **may be yourself** | `ADVANCED` |
| `FIX_METADATA` | `{ note?, next: { kind: REVIEW_PUBLISH, assignedToUserId } }` — `next` required | stays OPEN in REVIEW_PUBLISH | `ADVANCED` |
| `REVIEW_PUBLISH`, item is a DRAFT | `{ note? }` — `next` → 400 | **publishes the item**, task COMPLETED | `CLOSED_ON_PUBLISH` (with the note) |
| `REVIEW_PUBLISH`, item is a RECORD | `{ note? }` | COMPLETED as "reviewed" | `COMPLETED`, `changes` includes `{ path: "outcome", after: "ALREADY_PUBLISHED" }` |

Completing a review of a draft calls `ItemsService.transition([itemId], RECORD,
actor, { note })` — the same code path and checks as any publish. The caller's
**own token** must allow publishing (`assertCanTransition`, 403 otherwise — the
directory is not asked). The save check runs inside the transition; its
`400 METADATA_VALIDATION_FAILED` comes back unchanged and the task stays OPEN
(the whole transaction rolls back). The transition's observer closes the task,
so there is exactly one closing path whether the publish came from the task or
not.

#### The handoff stack — what Return does

`tasks.handoffs` records who held the task in which stage:

| Action | Stack |
|---|---|
| create (A for B, stage K) | `[{A, null}, {B, K}]`, or `[{B, K}]` when A = B |
| complete with `next` / reassign | push `{new holder, stage}` |
| return | pop; the task goes to the new top — **person and stage** |
| return with `assignedToUserId` | pop, then replace the top's person (stage stays) |

The requester's bottom entry has no stage. A return to it resolves one —
`REVIEW_PUBLISH` becomes `FIX_METADATA` (the requester fixes what the reviewer
found), anything else stays — and **writes it into that entry**, so a later
return to the requester lands in the stage they actually held. A stack of one
entry cannot be returned (400: cancel or complete instead). `returnTarget` on
the detail read is exactly that computation, or `null`.

The pure part (stack, stages, capability rule) is
`backend/src/modules/tasks/task-workflow.ts`, unit-tested without a database in
`task-workflow.spec.ts`.

#### The assignee guard is keyed on `(kind, itemType)`

| Stage | Item | Assignee must hold |
|---|---|---|
| `GENERAL` | any | `canWrite` (`drafts:manage` or `records:manage`) |
| `FIX_METADATA` | DRAFT | `canEditDrafts` (`drafts:manage`) |
| `FIX_METADATA` | RECORD | `canEditRecords` (`records:manage`) — a cataloguer cannot edit a published record |
| `REVIEW_PUBLISH` | any | `canPublish` |
| *(all)* | | plus: in the directory and active |

Run on create, complete-with-next (for the next stage), return (for the stage it
lands in) and reassign. v1 keyed it on `(kind, status)` because a RETURNED
review task sat with a cataloguer; in v2 a returned review becomes
`FIX_METADATA`, so the item type is what matters.

**This guard is advisory.** It reads `user_profiles` via
`UsersService.assignability()`, up to one sync interval (24h) stale, so it can
reject an assignment the assignee's own token would in fact permit; the error
says to run `POST /api/users/sync`. It must never gate a real permission — the
authoritative check at publish time is `assertCanTransition()`, reading the JWT.

#### Status rules

- `COMPLETED` and `CANCELLED` are both terminal — there is no reopen. If a
  publish went out wrong: unpublish if needed and file a new `FIX_METADATA`
  task; the old one stays in the item's task history.
- One task follows the item through the stages instead of a new task per step,
  so the comment thread stays in one place.

#### Publishing closes review tasks automatically

`transition()` to `RECORD` closes the `OPEN` `REVIEW_PUBLISH` task on each item,
inside the same transaction, and appends a `CLOSED_ON_PUBLISH` history row
attributed to the real publisher — so a task never appears to close by itself.
It is also how completing a review task closes it (see above), with the note
from `complete` on that row.

This is an **observer**: `POST /api/items/transition` cannot be removed — bulk
publish, imports and admin action all use it — so the task list cannot rely on
anyone going through the task itself. (GitHub composes the same two: the merge
button *and* auto-close when commits reach the base branch by any route.)

Not symmetric: `RECORD → DRAFT` does **not** reopen completed tasks.
`FIX_METADATA` and `GENERAL` are untouched — publishing is not evidence a
metadata fix was made.

Deleting an item hard-deletes its live tasks — but **not** their history. See the
delete rule under `tasks` / `task_history` above; it is the surprising part, and
it is the point of the split.

---

### Relations

```bash
# Connect parent to children
curl -X POST http://localhost:3000/api/relations/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "parentId": "parent-item-id",
    "childIds": ["child-1", "child-2"]
  }'

# Disconnect children from parent
curl -X POST http://localhost:3000/api/relations/disconnect \
  -H 'Content-Type: application/json' \
  -d '{
    "parentId": "parent-item-id",
    "childIds": ["child-1", "child-2"]
  }'
```

Both return the parent's state *after* the trigger has run, so the caller does
not have to re-read a version it just invalidated:

```jsonc
// connect -> 201, disconnect -> 200
{ "parentId": "…", "version": 7, "childrenInDrafts": 3, "childrenInRecords": 0 }
```

Since 2026-09-25 (schema v2 B9/B10):

- The relation change, the re-check of **every child** in its current state
  with its parents after the change, and the parent's `RELATION_ADDED` /
  `RELATION_REMOVED` revision are one transaction. A child the change makes
  invalid is `400 METADATA_VALIDATION_FAILED` and nothing is linked or
  unlinked — e.g. a complete book RECORD connected under a serial collection
  without `issue` data, or a disconnect that leaves an issue without the
  `collectionType` its serial parent was hiding.
- `connect` with a parent that does not exist is `400 PARENT_NOT_FOUND`
  (`{ code, message, parentIds }`, same as `parentIds` on `POST /items`); it
  was a plain `404 Item not found`. Anonymous still gets `401` first.
- New items can be linked at creation instead: `parentIds` on
  [`POST /items`](#items).

---

### Files

```bash
# Upload files to an item (multipart form)
curl -X POST http://localhost:3000/api/files/upload/<item_id> \
  -F 'files=@/path/to/file.pdf'

# Upload multiple files
curl -X POST http://localhost:3000/api/files/upload/<item_id> \
  -F 'files=@/path/to/file1.pdf' \
  -F 'files=@/path/to/file2.jpg'

# Upload PDF with its extracted text (OCR happens in the client)
curl -X POST http://localhost:3000/api/files/upload/<item_id> \
  -F 'files=@/path/to/scan.pdf' \
  -F 'extractedTexts={"scan.pdf":"OCR text from PaddleOCR..."}'

# Non-ASCII filenames are supported as-is — send them UTF-8 encoded and the
# exact name comes back. The extractedTexts key must match byte-for-byte.
curl -X POST http://localhost:3000/api/files/upload/<item_id> \
  -F 'files=@/path/to/ОКТОИХ петогласник 2.pdf' \
  -F 'extractedTexts={"ОКТОИХ петогласник 2.pdf":"Црногорски текст"}'

# Set/replace extracted text on an existing file
curl -X PUT http://localhost:3000/api/files/<file_attachment_id>/text \
  -H 'Content-Type: application/json' \
  -d '{"text":"Updated OCR text..."}'

# List files for an item
curl http://localhost:3000/api/files/<item_id>

# Download a file
curl -O http://localhost:3000/api/files/<file_attachment_id>/download

# Delete a file
curl -X DELETE http://localhost:3000/api/files/<file_attachment_id>
```

**`extractedTexts` keys must match an uploaded part.** Every key is checked
against the filenames in the same request *before* anything is stored; a key
matching no part returns `400` and nothing is written. This is deliberate — the
map is keyed by filename, so a mismatched key would otherwise mean the file
lands with `textExtractionStatus: NOT_EXTRACTED` and the text silently
discarded on an HTTP `201`.

Downloads send the name in both `filename=` (ASCII fallback) and RFC 6266
`filename*=UTF-8''…`, so non-ASCII names survive the round trip.

**Upload response:**
```json
[
  {
    "id": "file-attachment-cuid",
    "draft_id": "draft-id-or-null",
    "record_id": "record-id-or-null",
    "fileType": "PDF",
    "originalFid": "seaweedfs-fid",
    "filename": "document.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 102400,
    "role": "SOURCE",
    "textExtractionStatus": "NOT_EXTRACTED",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
]
```

Max 10 files per upload, 2GB per file.

---

### Import (COBISS)

```bash
# Preview a COBISS record (fetch + parse, no persist)
curl http://localhost:3000/api/import/cobiss/preview/<cobissId>
# Returns: { cobissId, itemId, alreadyExists, existsAs, metadata }

# Import records from COBISS
curl -X POST http://localhost:3000/api/import/cobiss \
  -H 'Content-Type: application/json' \
  -d '{
    "ids": ["2898183", "9847056", "13357072"],
    "target": "RECORD",
    "visibilityStatus": "PRIVATE"
  }'
# Returns: { "jobId": "123" }

# Check import job status
curl http://localhost:3000/api/import/jobs/<jobId>
```

**Job status response:**
```json
{
  "jobId": "123",
  "source": "cobiss",
  "state": "completed",
  "requestedAt": "2024-01-15T10:30:00.000Z",
  "progress": {
    "total": 10,
    "processed": 10,
    "succeeded": 9,
    "failed": 1,
    "errors": [
      { "id": "123456", "reason": "No data returned from COBISS for id..." }
    ],
    "warnings": [
      { "id": "36797700", "reason": "Imported as a record, but would not pass validation: missing extent" }
    ]
  },
  "failedReason": null,
  "finishedAt": "2024-01-15T10:35:00.000Z"
}
```

`warnings` (schema v2): an import is **never** blocked by the save check —
COBISS is the catalogue of record — but each imported item that a hand-made
item in the same state would have been refused for is listed here, so it can
be fixed later (since 2026-09-25 for `target: DRAFT` too, against the draft
rules). Counted in `succeeded`, not `failed`. Absent on jobs queued before
schema v2.

`extent` from 215/a (since 2026-09-25, B11; `parseExtent` in
`cobiss-parser.ts`, so the preview and "Get data" get it too): best effort,
only in the unit the material type's rule uses — pages for `a b c d` (the
largest arabic number; bracketed unnumbered pages only when there is nothing
else; a leading volume count like `2 sv.` gives nothing), minutes for `g i j`
(`95 min`, `1 h 35 min`, `2 sata`), sheets for `e f k` (`1 zemljovid`, `1
geogr. karta`, `24 lista`). Anything else leaves `extent` empty; 215/a itself
is always kept in `physicalDescription`.

---

## SeaweedFS (File Storage)

```bash
# Check master status
curl http://localhost:9333/cluster/status

# List files via filer
curl http://localhost:8888/?pretty=y

# Get file by FID
curl http://localhost:8083/<fid>
```

---

## Redis (Job Queue)

```bash
# Connect
redis-cli -p 6379

# Check queues
redis-cli -p 6379 KEYS "bull:*"

# Check pending jobs
redis-cli -p 6379 LLEN "bull:import-queue:wait"

# The directory sync is a repeatable job with a fixed id, so it fires once
# across the deployment rather than once per replica
redis-cli -p 6379 KEYS "bull:user-sync:*"
```

---

## Key Business Rules

1. **Item uniqueness**: An item lives in exactly one table (`drafts` OR `records`, never both)
2. **COBISS deterministic IDs**: Same cobissId always produces the same item ID
3. **Parent-child counts**: `childrenInDrafts` and `childrenInRecords` in metadata are managed by DB triggers on the `item_relations` table
4. **File cascades**: Deleting an item cascades to delete all file_attachments from DB, then async-deletes blobs from SeaweedFS
5. **Transition**: Moving DRAFT->RECORD (or reverse) copies data to the target table, re-links relations and files, then deletes from the source table
6. **PGSync**: Changes to Postgres are automatically synced to OpenSearch indices in real-time
7. **Search limit**: OpenSearch hard limit of `from + size < 10000`
8. **Metadata validation**: Unknown metadata fields are silently dropped; known fields validated against type validators (`METADATA_VALIDATORS` in `src/core/types/metadata.types.ts`). Schema v2's self-check guarantees the schema never advertises a field this drops
9. **Write responses**: `POST /items` returns `201` with the created item (including its `id`); file upload returns `201` with the created attachments; `relations/connect` and `transition` return `201` with the resulting version(s), `relations/disconnect` returns `200` with the parent's state; `PATCH` returns `200 { version }`; `DELETE` returns `200` with empty body
10. **Relations**: self-references and circular relations (direct or transitive) are rejected with `400`
11. **Timestamps**: all timestamp columns are `timestamptz`, so REST (`…Z`) and the indexed `_source` copy (`…+00:00`) denote the same instant and parse identically
12. **`version` is a write counter, not a change counter** — see [Versioning](#items) above before using it as a change signal
13. **Every write is validated** (since 2026-09-25): create, metadata `PATCH`, transition (both directions) and relation changes run the schema v2 check for the state the item ends up in — draft rules or record rules; only visibility-only `PATCH` and the COBISS import are exempt — see [Validation on save](#items)
14. **Parents on create**: `POST /items` takes `parentIds`; an unknown parent there or on `relations/connect` is `400 PARENT_NOT_FOUND`

---

## User Directory

`user_profiles` is a local shadow of the Keycloak realm, refreshed on a schedule.
It answers "who exists, and what may they do?" — the assignee picker, the creator
filter, and resolving a `userId` to a *current* name in aggregates.

Keep it distinct from [Attribution](#attribution) below. They are separate
mechanisms with different data, different freshness needs and different failure
modes:

| | Attribution | Directory |
|---|---|---|
| Question | "Who made this row?" | "Who exists, and what may they do?" |
| Stored as | Snapshot columns on the row | `user_profiles` table |
| Written by | The request handler, from the JWT | The sync job, only |
| Freshness | Frozen at write time, on purpose | Up to one sync interval stale |
| Scales with | Number of items | Number of staff |

### One write path

**The sync job is the only thing that writes `user_profiles`.** Scheduled daily
plus once on startup (the same BullMQ job, deduplicated through Redis by a fixed
`jobId`, so two replicas do not both sync), or on demand via
`POST /api/users/sync`. There is deliberately no opportunistic population from
the JWT of whoever happens to make a request, so "why is this person in the
table?" has exactly one answer.

### Not an authorization source

Every permission decision reads `principal.scopes`, populated exclusively from
the JWT. Nothing in the auth path touches this table.

> **`canPublish` must never gate an actual permission.** It is a UI hint and an
> advisory validation. The real check is `assertCanTransition(principal)`, which
> reads the token. Hold that line and a stale directory is cosmetic.

The two symptoms of a stale table are both self-healing: a newly promoted user is
missing from the publish picker until the next sync (the manual trigger fixes it
instantly), and a demoted user still shows `canPublish: true` but gets a correct
403 from the token at transition time. Departures need no special handling —
Keycloak stops issuing tokens immediately, and existing ones expire inside the
5-minute TTL.

### A failed sync is not a departure

`deletedAt` is only ever set by a run that **completed** and returned a
**non-empty** roster. If enumeration 403s or dies halfway, the users we did not
see are not gone — marking them absent would empty the assignee picker every time
Keycloak restarts. Rows are never hard-deleted, which is what lets an old item
still resolve a departed user's name.

### Keycloak access

`KeycloakAdminService` (`src/core/keycloak/`) uses raw `undici` and a
client-credentials token for `nbcg-worker`, minted against the **`nbcg` realm,
not `master`** — `realm-management` roles are per-realm. The token is cached and
re-minted at 80% of its life, with one forced re-mint on a 401 to cover a
Keycloak restart.

The service account holds `view-users` and `view-clients`, not `realm-admin`.
Both are needed and neither is optional:

- `view-users` (composites `query-users` + `query-groups`) — enumeration and
  per-user role mappings.
- `view-clients` — resolving `nbcg-api`'s **internal UUID**, which is not
  `KEYCLOAK_CLIENT_ID` and is required by every role-mapping call. `view-users`
  alone gets a 403 on `GET /clients`, and the weaker `query-clients` is worse
  than useless here: it returns `200` with an empty list, which reads as "the
  client does not exist".

Roles are read from `/users/{id}/role-mappings/clients/{uuid}/composite`. The
composite variant is what makes storing group membership unnecessary — it
resolves group-derived roles *and* expands `records:manage` into its
`records:view:*` composites. A non-composite call would miss both.

Config: `KEYCLOAK_WORKER_CLIENT_ID` / `KEYCLOAK_WORKER_CLIENT_SECRET`. The secret
must match the realm's `nbcg-worker` client. Keycloak masks secrets on export, so
`nbcg-realm.conf.json` pins an explicit literal rather than the `**********` a
partial export produces — otherwise a realm re-import yields a client the backend
cannot authenticate as.

*Scaling note:* role resolution is one request per user. At 5-50 users that is a
handful of calls a day. Past roughly 200 users, resolve roles once per group
(`/groups/{id}/role-mappings/clients/{uuid}/composite` + `/groups/{id}/members`)
and union per user — the only reason to reintroduce the group walk.

## Attribution

Every item row and every revision stores both the writer's Keycloak `sub` and
their display name. The name is a **snapshot**: taken from the JWT's
`given_name` / `family_name` / `preferred_username` at write time and never
updated afterwards.

- **Why a snapshot.** A column that tracked the current Keycloak name would make
  a single rename re-index every document that person ever touched — PGSync CDC
  rebuilds the whole document, metadata plus nested `extractedText`, on any
  column change to `drafts`/`records`. Written once, that cost is never paid.
  It also means attribution needs no join, no cache and no per-row lookup, and
  works for a user the directory sync has never seen.
- **The cost.** A genuine correction — a typo fixed in Keycloak — does not
  propagate to existing rows. That needs an admin backfill keyed on `userId`.
- **Aggregates must not use it.** `GROUP BY userId, userName` splits a renamed
  person into several rows. Group by `userId` and resolve the current name from
  the directory — which is what `/api/stats/users` does (see
  [History & Statistics](#history--statistics)).
- **One formatting rule**, `formatDisplayName()` in
  `src/shared/util/display-name.ts`: `"First Last"`, falling back to the
  username, falling back to `'Unknown user'`. `'system'` renders as
  `'System (import)'`.
- **Staff-only.** Attribution names are stripped for any principal holding
  neither `drafts:manage` nor `records:manage` — that admits cataloguer, editor
  and admin, and excludes `reader` and anonymous. Enforced twice on the search
  path: as OpenSearch `_source` excludes, and again in the process before the
  hit leaves `SearchService`. The `?fields=` allowlist exists so the projection
  cannot be used to re-request a stripped field.
- Writes carry an `Actor` (`{ userId, userName }`) rather than a bare user id —
  `actorOf(principal)` at the controller, `SYSTEM_ACTOR` on the import queue.
