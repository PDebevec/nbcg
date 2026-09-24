# Backend: usage metrics outlive their items

## Status: TODO — needs a decision

`item_metrics_daily` / `file_metrics_daily` rows are never deleted when an item
is, so `GET /api/stats/items/top` returns deleted items with `title: null,
itemType: null`. Verified live: 5 of 5 `mostViewed` entries were deleted test
items. User-visible on any "most viewed" dashboard, and it makes the §14
top-items test flaky as ghosts accumulate.

## Options

| Option | Pro | Con |
|---|---|---|
| Delete metrics with the item (in `ItemsService.delete()`'s transaction) | tables stay clean; top lists correct | loses the historical totals in `/stats/overview` for deleted items |
| Keep the rows, filter unresolved items out of the top-N read | history kept | the top-N query must over-fetch and filter; totals still count deleted items |

Recommendation: **filter in the read** — it matches how `item_revisions` and
`task_history` deliberately outlive items, and keeps the overview totals honest
about traffic that really happened. Over-fetch `limit × 2`, drop ids that
resolve to neither table, trim.

## Tests

§14: create an item, record a view, delete it; `stats/items/top` must not
return it.
