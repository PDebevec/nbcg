# Backend: indexed timestamps carry no timezone, so clients read them as local time

## Status: DONE — implemented 2026-08-07

Reproduced exactly: REST `2026-08-07T15:22:40.559Z` vs indexed
`2026-08-07T15:22:40.559`.

**Decision: option 2 — `timestamptz`**, the root fix, rather than patching the
`_source` string on read. It also fixes anyone querying OpenSearch directly
(Dashboards), which a backend-side normalisation would not.

**What shipped:**

- `@db.Timestamptz(3)` on every timestamp column — `Draft`, `Record`,
  `FileAttachment`, `ItemRelation` (`backend/prisma/schema.prisma`).
- Migration `20260807160000_timestamps_with_timezone`, converting with
  `USING "createdAt" AT TIME ZONE 'UTC'`. Prisma had always written UTC into
  these naive columns, so the conversion reinterprets each value as the instant
  it already was — **lossless, no row shifts**.
- Full reindex (delete `records,drafts` → delete the pgsync Redis checkpoints →
  `--force-recreate pgsync`), so the corpus is not half-and-half. 14/14 docs
  re-synced.

No pgsync config change was needed: with a `timestamptz` column it emits the
offset on its own.

**Verified live**, both acceptance criteria:

```
REST  createdAt: '2026-08-07T15:47:27.504Z'
INDEX createdAt: '2026-08-07T15:47:27.504+00:00'
Date.parse → 1786117647504 === 1786117647504   PASS: identical instant
```

Pre-existing documents were confirmed converted in place (e.g.
`2026-05-07T16:36:16.252+00:00`). Covered in `backend/test/api-test-suite.sh`
§ Indexed Timestamp Format, which asserts the indexed value carries an offset
*and* parses to the same instant as the REST value.

**Still worth doing on the frontend:** the report's closing note stands —
anything rendering "added on …" / "updated …" from a search hit was previously
off by the UTC offset. Those values are correct now without a frontend change,
but any client-side code that *compensated* by appending `Z` itself would now
double-correct and should be checked.

## Original report — TODO, P2 (wrong values in every client that parses them)

Found during `nbcg-dc` Epic 10 / API round-trip verification, 2026-08-07.
**Measured live** against the dev backend + OpenSearch.

## What happens today

The same field is serialised two different ways depending on which endpoint you
ask, and only one of them is unambiguous:

| Source | `createdAt` |
| --- | --- |
| `POST /api/items` (and every REST response) | `"2026-08-07T14:11:00.682Z"` |
| `GET /api/search/:id` → `hit.source.createdAt` | `"2026-08-07T14:11:00.682"` |

The indexed copy has **no `Z` and no offset**. Same instant, same item, one
character apart — and that character changes the meaning.

## Why it is a bug, not a cosmetic difference

Per ECMAScript, a date-time string **without** an offset is interpreted as **local
time** (only date-*only* forms default to UTC). So in JavaScript:

```js
Date.parse("2026-08-07T14:11:00.682Z")  // → the real instant
Date.parse("2026-08-07T14:11:00.682")   // → 14:11 LOCAL — 2h earlier in CEST
```

Every JS/TS client that parses `hit.source.createdAt` or `updatedAt` therefore
gets a value skewed by the machine's UTC offset — **two hours** for Montenegro in
summer, and a *different* skew for a client in another zone or another season. The
values are silently wrong rather than obviously broken, which is the worst
failure mode for a timestamp: "sorted by newest" still looks plausible, and
"changed in the last hour" quietly includes or excludes the wrong rows.

It is also inconsistent *within one response*: an item fetched from the REST API
and the same item fetched from search cannot be compared without knowing which
path produced each string.

## Where it comes from

Prisma maps `DateTime` to Postgres `timestamp(3)` — **`timestamp without time
zone`** — and stores UTC in it (`backend/prisma/schema.prisma:58-59, 73-74`). The
REST path serialises through JS `Date`, which appends `Z`. The CDC path
(`infrastructure/docker/pgsync/schema.json`, `"createdAt": { "type": "date" }`)
copies the column's raw text into `_source`, where the offset never existed.

OpenSearch itself is fine — its `date` type parses an offset-less ISO string as
UTC, so range queries and sorts inside the index are correct. The damage is
confined to the **`_source` string handed to clients**, which is exactly what
clients use.

## Fix options, cheapest first

1. **Mark it UTC in the index.** Have pgsync emit an offset (or append `Z`) for
   the timestamp columns, so `_source` matches the REST representation. Smallest
   change, no migration, fixes every client at once.
2. **Use `timestamptz`.** Change the columns to `timestamp with time zone` so the
   offset is carried end-to-end. Correct at the root, but needs a migration and a
   reindex, and touches every model with timestamps.
3. **Document it and make clients compensate.** Cheapest for the backend, worst
   overall: every current and future consumer has to remember to append `Z`, and
   the ones that forget are silently wrong. Not recommended.

## Impact on `nbcg-dc` today

**None yet, by luck.** `services/sync` / `domain/sync` compare only timestamps the
archive generated itself (`lastSyncedAt`, `syncedAt`); nothing parses
`source.createdAt` / `source.updatedAt`. It is recorded as a trap in
`nbcg-dc/docs/PROJECT-KNOWLEDGE.md` §4 so the next person to reach for those
fields does not walk into it. The website frontend should be checked — anything
rendering "added on …" or "updated …" from a search hit is currently off by the
UTC offset.

## Acceptance

- `hit.source.createdAt` / `updatedAt` are unambiguous — identical in meaning and
  ideally in format to the REST representation.
- `Date.parse()` on an indexed timestamp yields the same instant as `Date.parse()`
  on the REST timestamp for the same item.
- Existing documents are reindexed (or the change is applied in a way that fixes
  them), so the corpus is not half-and-half.
