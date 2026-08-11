# Frontend: Change History + Statistics GUI

## Status: TODO — backend done, GUI design open

## Summary

The backend now records **who changed what and when** on every item, and counts
**views and downloads**. Four endpoints expose it. None of it is reachable from
the UI yet — the data is being collected right now and nobody can see it.

This task is the GUI. **The layout, charts and screen structure are deliberately
not specified here** — that is the implementing developer's call. What is
specified is what the data means, what the endpoints return, and which
behaviours the UI has to handle correctly regardless of how it looks.

## What the backend already does

### Change history

Every write to an item appends a row to `item_revisions` — a **diff, not a
snapshot**. `itemId` is stable across a DRAFT ↔ RECORD transition and survives
deletion of the item, so one timeline covers an item's whole life: draft edits,
publication, and post-publication edits.

| Action | Written when | `changes` holds |
|---|---|---|
| `CREATE` | item created, COBISS import, or the historical backfill | `null` |
| `UPDATE` | `PATCH` touching metadata; also a file replace | per-field metadata diff |
| `VISIBILITY_CHANGE` | `PATCH` touching **only** visibility | `visibilityStatus` |
| `PUBLISH` / `UNPUBLISH` | draft → record / record → draft | `itemType` |
| `FILE_ADDED` / `FILE_REMOVED` | file upload / delete | `files[<fileId>]` |
| `RELATION_ADDED` / `RELATION_REMOVED` | connect / disconnect, on the **parent** | `children[<childId>]` |
| `DELETE` | item deleted | `null` |

`changes` is `{ path, before, after }[]`. `path` is a metadata path
(`title`, `authors[0].familyName`, `publication`) or one of the synthetic paths
above. `before`/`after` can be any JSON value — string, number, `null`, or a
whole nested object when a subtree changed at once.

### Usage counters

- `GET /api/search/:id` → +1 **VIEW** on the item. Only counted after the item
  resolved and passed the visibility check.
- `GET /api/files/:id/download` → +1 **DOWNLOAD** on the file **and** on its
  parent item.
- `?inline=1` → **not counted.** That is the viewer rendering a scan in-page.
- A search-results appearance is **not** a view.

Anonymous traffic is counted. Bot user-agents are dropped. Counting is per
item/file per UTC day and nothing finer — **no IPs, no session or visitor
identity, no referrer, no search-term logging**. Hits are buffered ~2s before
being written, so a counter can lag a page view by a couple of seconds.

Retention: everything is kept forever. There is no rollup or pruning job.

## The API

All four are behind `records:view:hidden` + `drafts:view:hidden` — the same
guard as the existing `/api/items/stats`. That is exactly what
`useAuthz().canAccessAdmin` already computes, so **no new authz plumbing is
needed**; these screens live behind the existing `/admin` route guard.
Anonymous → 401, reader → 403.

Suggested home: extend `src/api/admin.ts`, which already mirrors backend types
this way.

```ts
// ---------------------------------------------------------------------------
// History + statistics — mirrors backend items.controller.ts / stats.controller.ts
// ---------------------------------------------------------------------------

export type ChangeAction =
  | 'CREATE' | 'UPDATE' | 'PUBLISH' | 'UNPUBLISH' | 'VISIBILITY_CHANGE'
  | 'FILE_ADDED' | 'FILE_REMOVED' | 'RELATION_ADDED' | 'RELATION_REMOVED' | 'DELETE';

export type MetricKind = 'VIEW' | 'DOWNLOAD';

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface ItemRevision {
  id: string;
  itemId: string;
  /** Item version AFTER the change. Not a change counter — see BACKEND_REFERENCE.md. */
  version: number;
  action: ChangeAction;
  /** null for CREATE and DELETE. */
  changes: FieldChange[] | null;
  /** Raw Keycloak sub, or the literal "system" for COBISS imports. */
  userId: string;
  createdAt: string;
}

export interface DayCount { day: string; count: number }
export interface StatsRange { from: string; to: string }
```

### `GET /api/items/:id/history`

`?limit=` (1–200, default 50) `&offset=`. Newest first.

```ts
export interface ItemHistory {
  itemId: string;
  total: number;
  limit: number;
  offset: number;
  revisions: ItemRevision[];
}
```

Real response (item created, edited, made public, published, file attached):

```json
{
  "itemId": "cmsouydv6002voqta74sh6wbm",
  "total": 5, "limit": 50, "offset": 0,
  "revisions": [
    { "version": 3, "action": "FILE_ADDED",
      "changes": [{ "path": "files[cmsouydz10030oqta58idk2pl]", "before": null, "after": "scan-01.pdf" }],
      "userId": "12359ac2-...", "createdAt": "2026-08-11T16:11:36.643Z" },

    { "version": 3, "action": "PUBLISH",
      "changes": [{ "path": "itemType", "before": "DRAFT", "after": "RECORD" }], ... },

    { "version": 2, "action": "VISIBILITY_CHANGE",
      "changes": [{ "path": "visibilityStatus", "before": "PRIVATE", "after": "PUBLIC" }], ... },

    { "version": 1, "action": "UPDATE",
      "changes": [
        { "path": "title",                 "before": "Njegoš",   "after": "Gorski vijenac" },
        { "path": "authors[0].familyName", "before": "Petrović", "after": "Petrović Njegoš" },
        { "path": "publication",           "before": null,       "after": { "year": "1847", "place": "Beč" } }
      ], ... },

    { "version": 0, "action": "CREATE", "changes": null, ... }
  ]
}
```

### `GET /api/stats/overview`

`?from=&to=` — inclusive UTC days, `YYYY-MM-DD`.

```ts
export interface StatsOverview {
  range: StatsRange;
  /** Current snapshot — ignores the date range. Same shape as getItemStats(). */
  totals: ItemStats;
  activity: {
    totals: { created: number; published: number; updated: number; deleted: number };
    created: DayCount[]; published: DayCount[]; updated: DayCount[]; deleted: DayCount[];
  };
  usage: {
    totals: { views: number; downloads: number };
    views: DayCount[]; downloads: DayCount[];
  };
}
```

### `GET /api/stats/users`

`?from=&to=&limit=` (1–200, default 50). Sorted by `total` descending.

```ts
export interface UserTotals {
  userId: string;
  created: number;
  published: number;
  /** Everything else — metadata edits, visibility flips, file and relation writes. */
  edited: number;
  deleted: number;
  total: number;
}

export interface UserStats { range: StatsRange; limit: number; users: UserTotals[] }
```

### `GET /api/stats/items/top`

`?from=&to=&metric=VIEW|DOWNLOAD&limit=` (1–100, default 10). Omit `metric` to
get all three lists in one call.

```ts
export interface TopItem {
  itemId: string;
  /** null when the item has since been deleted. */
  title: string | null;
  itemType: ItemType | null;
  count: number;
}

export interface TopFile {
  fileId: string;
  itemId: string;
  /** null when the attachment has since been deleted. */
  filename: string | null;
  count: number;
}

export interface TopItems {
  range: StatsRange;
  limit: number;
  mostViewed: TopItem[];
  mostDownloaded: TopItem[];
  /** Only populated for DOWNLOAD (or when `metric` is omitted). */
  topFiles: TopFile[];
}
```

## Behaviours the UI must get right

These are not style choices — getting any of them wrong produces a screen that
lies about the data.

- **`title` and `filename` can be `null`.** That is a deleted item or attachment
  whose counts are still real. Render something ("deleted item", the id) —
  do **not** filter the row out, or the list stops adding up to the totals.
- **Time series are sparse.** Days with no activity are absent, not zero. A
  chart must fill the gaps itself or it will draw a misleading line.
- **`userId` is a raw Keycloak UUID.** There is no display name yet — the
  `user_profiles` cache from [Task Delegation](backend-task-delegation.md) is
  what will provide it. Until then, either show the id or resolve it
  client-side. Note the literal `"system"` for COBISS imports.
- **`totals` in the overview ignores the range**; everything under `activity`
  and `usage` respects it. Don't present them as one consistent period.
- **An out-of-range request is a 400**, not an empty result: `from` after `to`,
  a range wider than 366 days, or a non-`YYYY-MM-DD` value. A date picker that
  can express those needs to handle the error.
- **Two revisions can share a `version`.** File and relation writes do not bump
  the item's version. Don't key a list on version or use it to order.
- **`version` is not a change counter** — see "What `version` means" in
  `backend/BACKEND_REFERENCE.md`. Don't derive "number of edits" from it.
- **Counters lag ~2s** behind the action that caused them, so a dashboard opened
  immediately after a download may not show it yet.

## Scope

Surfaces that need to exist. **How they look, and how many screens they are, is
the developer's decision.**

- [ ] **Item history** — the timeline for one item, reachable from that item.
      Must convey who, when, what action, and which fields changed with their
      before/after values. Needs to render a `before`/`after` that is an object
      or `null`, not just a string.
- [ ] **Statistics** — the aggregate view for admins, covering: current totals,
      created/published/updated over time, per-user productivity, and most
      viewed / most downloaded items plus top files. A date-range control drives
      all of it.
- [ ] Route(s) under `/admin`, behind the existing guard.
- [ ] `src/api/admin.ts` client functions + types (above).
- [ ] i18n keys in `src/i18n/en-US` **and** `src/i18n/me` — including a label
      per `ChangeAction`, and human-readable field labels for `changes[].path`
      (a cataloguer should not be reading `authors[0].familyName`).

## Open questions for the developer

- [ ] One statistics page or several? The four data sets don't have to share a screen.
- [ ] Charting: any library, or hand-rolled? There is no charting dependency in
      `package.json` today — adding one is a decision worth making deliberately.
- [ ] Should the item history live on `AdminItemEditPage`, on
      `RecordDetailPage`, or its own route?
- [ ] Resolve `userId` → name client-side via Keycloak now, or wait for
      `user_profiles`?

## Related

- [Task Delegation](backend-task-delegation.md) — provides `user_profiles`, needed for display names
- `backend/BACKEND_REFERENCE.md` → "History & Statistics", the `item_revisions` /
  `item_metrics_daily` table notes, and "What `version` means". This is the
  reference for the backend side; the task that built it has been retired.
- `frontend/src/composables/useAuthz.ts` → `canAccessAdmin` is already the right guard
- `frontend/src/pages/admin/AdminDashboardPage.vue`, `components/admin/StatsCard.vue` — existing snapshot totals to build alongside
