# Search filters

## Status: backend DONE 2026-09-29 (dev, not deployed) · web TODO · archive app TODO

Per side: [web plan](../../frontend/plans/search-filters.md) · archive app →
[open work](../archive-app.md#open-work-for-the-app) · every param and its
format: [backend/reference.md → Search](../../backend/reference.md#search).

## What it is

`GET /api/search` and `GET /api/search/:id/children` take exact filters next to
the scored text search (`q`, `title`, `author`, `fullText`). Since 2026-09-29
the filters are one allowlist on the backend (`FILTER_FIELDS` in
`backend/src/modules/search/filter-fields.ts`). A new filter is a new param:
additive, no client breaks.

## What changed for clients (2026-09-29)

| | Before | Now |
|---|---|---|
| `collectionType` | did not exist; the param was dropped silently, so every item came back | `collectionType=>0` = every collection, including types added later; `0` = not a collection; a list (`1,3,4`) or a comparison (`>=`, `<`, `<=`) for anything else |
| `isbn`, `issn` | matched nothing (ISBNs are stored with dashes, the filter removed them) | any spelling: dashes, spaces, `x`/`X` |
| `yearFrom` / `yearTo` | compared words as text: `yearFrom` alone also matched `s. a.` and `[ca. 1850?]` | only 4-digit years count; `1884-1885` counts as both years |
| A value that does not parse | 400 for years only (class-validator, `message` an array); other filters sent it to the index | 400 for every filter, `message` a string: `Invalid collectionType "x": expected a whole number` |

Needs a reindex on each environment (new `.normalized` and `.years`
sub-fields): done on dev, **production at deploy** —
[procedure](../../infrastructure/opensearch-reindex.md#filter-sub-fields-isbnissn-and-years-2026-09-29).

## Rules for every client

1. **Send only params the backend knows.** An unknown or misspelled one is
   dropped without an error, and the search returns unfiltered hits.
2. **"Any collection" is `collectionType=>0`** — no client needs to know the
   codes, so a new collection type works without a release. For labels (a
   dropdown of types) use the schema: `GET /api/schema/v2/record` →
   `vocabularies.collectionType.values`.
3. **`language` and `materialType` take the English label** (`en`), not the
   code — what `/search/suggest?field=…` returns as `value.en`. Switching to
   codes is decision D1 in the web plan.
4. **Years are 4 digits** (`0850`, not `850`).
5. **Lists and pickers use `fields=`** — the whole `metadata` is about 7× the
   size of `metadata.title,metadata.collectionType`.
6. Filters narrow what the caller may see; they never widen it.

## Impact on each side

| Part | Change | Status |
|---|---|---|
| backend | filter registry, `collectionType`, ISBN/ISSN and year fixes, pgsync mapping, unit tests, API suite §5b | DONE 2026-09-29 (dev) |
| infrastructure | reindex production with the new `schema.json` | TODO at deploy |
| web | [plan](../../frontend/plans/search-filters.md): `collectionType` in the catalog/admin, home-page tiles that match nothing, 400 handling | TODO |
| archive app | parent picker: collections only, name + type only ([call](../archive-app.md#what-it-uses-from-the-api)) | TODO |
