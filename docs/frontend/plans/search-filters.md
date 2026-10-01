# Frontend: search filters

## Status: W1 and W4 BUILT 2026-09-30 with the admin redesign · W2, W3 and W8 BUILT 2026-10-01 with the [public redesign](public-redesign.md) (W3 as any / collections only / single items only; W8 as an empty state, no message) · W5–W7 TODO · backend DONE 2026-09-29 (dev)

**Admin list (2026-09-30):** the records / drafts list filters by material type, collection type,
"created by me" and year of publication, all kept in the URL. The design's "Visibility" and "Has
an open task" filters and a sort on "Updated" are left out: `/api/search` has no `visibilityStatus`
filter (the field is indexed — one `FILTER_FIELDS` line), tasks are not in the index, and `sort`
knows only `relevance` / `newest`.

Contract: [shared/plans/search-filters.md](../../shared/plans/search-filters.md) ·
every param: [backend/reference.md → Search](../../backend/reference.md#search).

Nothing the web sends today breaks. Two things already got better without a web
change: the "after 2000" era chip (`yearFrom=2001` alone) no longer lists items
whose year is `s. a.` or `[ca. 1850?]`, and a span like `1884-1885` matches
either year.

## Where the web searches today

| Page | Filters it sends | Notes |
|---|---|---|
| `CatalogPage.vue` | `q`/`title`, `materialType`, `language`, `publisher`, `yearFrom`, `yearTo` — all from the route query | `fetchItems` has no `catch` |
| `AdvancedSearchPage.vue` | builds the same query and pushes `/catalog` | pads years to 4 digits |
| `AdminItemsPage.vue` | `q`, `createdBy` | |
| `IndexPage.vue` | category tiles link to `/catalog?materialType=<label>`; "newest" list | tiles are broken — W2 |
| `api/search.ts` | `SearchParams` — the hand-written mirror of `SearchQueryDto` | no `collectionType` |

## Tasks

### W1 — `SearchParams` (XS)

`frontend/src/api/search.ts`: add `collectionType?: string` (comma-separated
codes, or one comparison — `>0` is every collection); fix the comments on `isbn`/`issn` (any spelling) and `yearFrom`/`yearTo`
(4 digits, inclusive). This type is the only place the web learns about a new
filter — there is no generated client, and a param the backend does not know
is dropped silently.

### W2 — home-page category tiles match nothing (S) — bug, verified 2026-09-29

`IndexPage.vue` links its tiles with labels that are not material types:
`Monograph`, `Serial publication`, `Manuscript`, `Map`, `Sound recording`. The
filter matches `metadata.materialType.en` exactly, so every tile opens an empty
catalog (dev: `Monograph` 0 hits, `Book` 5, `Journal / Serial` 3). Use real
labels, several per tile where needed (the param is a list):

| Tile | `materialType` |
|---|---|
| books | `Book` |
| newspapers, magazines | `Journal / Serial` (the types do not tell the two apart) |
| manuscripts | `Music manuscript,Manuscript map` — or drop the tile: there is no "text manuscript" type |
| maps | `Printed map,Manuscript map,Map serial` |
| audiovisual | `Musical sound recording,Non-musical sound recording,Video / Film` |
| posters, photographs | none today, so they open the whole catalog — `Graphic` is the closest type |

Wait for D1 first: with codes it becomes `am`, `as`, … and survives a relabel.

### W3 — collection filter in the catalog and advanced search (S)

**Built 2026-10-01** in a simpler form than below: a "Collection" group in the catalogue's Refine column and a
select on the advanced search page with three choices — any, only collections (`collectionType=>0`), only single
items (`collectionType=0`). Per-type choices (1, 3, 4) wait for [collection views](collection-views.md).

Original proposal: a "Collections" multi-select in `CatalogPage.vue` (and the same field on
`AdvancedSearchPage.vue`, pushed to `/catalog`), kept in the route query like
the others: `collectionType=1,3` for chosen types, `collectionType=>0` for all.
- Options from the schema, not hard-coded: `vocabularies.collectionType.values`
  from `GET /api/schema/v2/record` (codes with `en`/`cnr` labels, already loaded
  by the metadata editor). "Any collection" is `collectionType=>0` — axios
  encodes the `>`; a hand-built URL needs `%3E0`.
- Read the codes back with `queryList('collectionType')`; they are numbers in
  the vocabulary and strings in the URL.

### W4 — admin items list (S)

`AdminItemsPage.vue`: a collection-type filter next to the creator filter, and a
column for it (add `metadata.collectionType` to `fields`, label from the same
vocabulary).

### W5 — primary collections on the home page (M, with collection views)

`collectionType=1&type=records` with a small `fields` list gives the
"prominent placement" of type 1 in [collection views](collection-views.md).
Waits for that plan's open questions.

### W6 — parent picker, when the web gets "create as child of…" (S, later)

There is no such flow today ([metadata schema v2 F5](metadata-schema-v2.md#f5--parent-context-s)).
When it comes, use the archive app's call —
`collectionType=>0&fields=metadata.title,metadata.collectionType`
([archive app](../../shared/archive-app.md#what-it-uses-from-the-api)) — and send
the choice as `parentIds` on `POST /api/items`. The backend does not require a
parent to be a collection; the filter is the picker's job.

### W7 — identifier search (XS, optional)

ISBN / ISSN / COBISS ID inputs on `AdvancedSearchPage.vue`, sent as typed: the
backend ignores dashes, spaces and case.

### W8 — a rejected filter (XS)

**Built 2026-10-01, half of it:** `fetchItems` now catches and clears the list, so a bad link shows the empty state
("Nothing matches these filters") instead of stale results; the backend's `message` is still not shown.

A value that does not parse is a 400 with a string `message`
(`Invalid yearFrom "85": expected a 4-digit year (YYYY)`). `CatalogPage.vue`
takes every filter from the URL and `fetchItems` has `try/finally` without a
`catch`, so a hand-edited or old link leaves the previous results on screen
with no message. Add a `catch` that clears the list and shows "this filter is
not valid", and pad or drop a bad year before sending (as the advanced page
does).

## Decisions

- **D1 — filter `language` and `materialType` by code instead of English
  label?** Recommended. Labels live in `cobiss-code-map.ts` and can be renamed
  (W2 is what a rename leaves behind), and the web shows `cnr` labels while
  filtering by `en`. Backend: two `FILTER_FIELDS` lines
  (`metadata.materialType.code.keyword`, `metadata.language.code.keyword`) and
  the reference table; web: send `value.code` from `/search/suggest` and use
  codes in W2. All data is test data, so no transition period is needed.

## Impact on the other side

| Frontend change | Backend needs | Backend status |
|---|---|---|
| W1, W3, W4, W6 | `collectionType` filter | done 2026-09-29 (dev) |
| W7 | ISBN/ISSN on `.normalized` | done 2026-09-29 (dev) |
| W8 | filter values validated, string `message` | done 2026-09-29 (dev) |
| W2 | nothing — or D1 | D1 not started, waits for the decision |
| W5 | nothing beyond `collectionType` | done — waits on collection views, not the backend |
| Any new filter | one `FILTER_FIELDS` entry + its `SearchQueryDto` param + an API-suite case | per request |
| Nothing | the archive app — independent client of the same contract | — |

Sizes: W1 XS · W2 S · W3 S · W4 S · W5 M · W6 S · W7 XS · W8 XS.
