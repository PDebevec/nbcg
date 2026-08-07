# Backend: indexed timestamps carry no timezone, so clients read them as local time

## Status: TODO — P2 (wrong values in every client that parses them)

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
