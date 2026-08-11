# Backend: Change History + Usage Statistics

## Status: TODO

## Why we need it

Two gaps, both needed for the same admin dashboard:

1. **No change history.** When a record is wrong, nobody can tell what changed,
   when, or who did it. There is no way to show a timeline or to back out a bad
   edit.
2. **No usage data.** We cannot answer "which records do people actually look
   at", "how many downloads did this scan get", or "how many records did each
   cataloguer produce this month" — questions the library asks regularly.

## Current State

- `GET /api/items/stats` exists but is a bare snapshot: counts of records and
  drafts grouped by `visibilityStatus`, nothing more. No time dimension, no
  per-user breakdown, no usage.
- **No audit table.** `createdByUserId` / `updatedByUserId` hold only the *most
  recent* actor; the previous one is overwritten and lost.
- **No view or download counters anywhere.**
- Item reads go through `GET /api/search/:id`; file downloads through
  `GET /api/files/:fileId/download`. `ItemsController` has no `GET /:id`.

## ⚠️ `version` is not a change counter — do not build history on it

`Draft.version` / `Record.version` are **write counters**. The
`trg_item_relations_children_count` trigger bumps a parent's `version` via raw
SQL whenever a child is connected or disconnected — a change the parent's own
metadata never saw, and one that does not move `updatedAt` either. So:

- `version` increments do **not** correspond 1:1 to content changes;
- `updatedAt` is unreliable for parent items specifically;
- neither can be used to reconstruct what changed.

History has to be recorded explicitly at write time. This is already documented
under "What `version` means" in `BACKEND_REFERENCE.md`.

## Design

### Part 1 — Change history (diffs, not snapshots)

Store what changed rather than full copies. `metadata` blobs are large and
mostly static between edits; snapshotting every version would multiply storage
for little gain.

```prisma
enum ChangeAction {
  CREATE
  UPDATE
  PUBLISH            // draft -> record
  UNPUBLISH          // record -> draft
  VISIBILITY_CHANGE
  FILE_ADDED
  FILE_REMOVED
  RELATION_ADDED
  RELATION_REMOVED
  DELETE
}

model ItemRevision {
  id        String       @id @default(cuid())
  itemId    String       // stable across transition — see below
  version   Int          // item version *after* this change
  action    ChangeAction
  /// [FieldChange[]]  e.g. [{ "path": "authors[0].name", "before": "...", "after": "..." }]
  changes   Json?
  userId    String       // Keycloak sub
  createdAt DateTime     @default(now()) @db.Timestamptz(3)

  @@index([itemId, createdAt])
  @@index([userId, createdAt])
  @@map("item_revisions")
}
```

`transition()` preserves the id when moving a row between tables (`id: d.id` in
`items.service.ts`), so `itemId` alone tracks an item across its whole life —
draft edits and post-publication edits land on one continuous timeline. Don't
store `itemType`; it would go stale on publish.

**On diffing accuracy.** A deep-diff over nested metadata (authors, arrays of
objects) will occasionally mis-attribute a change — array reordering especially.
That is acceptable *here* and was not acceptable for `version`: a missed diff
makes the timeline cosmetically wrong, whereas a missed `version` bump silently
leaves mirrors stale. Different failure cost, different call. Still, don't
reorder-normalise arrays before diffing — a reorder is itself a real edit.

Writes happen inside the same transaction as the item write, so history can
never disagree with the item.

### Part 2 — Usage counters

**Counters must not live on `records` / `drafts`.** pgsync CDC watches those
tables; a `viewCount` column there would re-index the entire document —
`metadata` plus nested `file_attachments`, whose `extractedText` can be
megabytes — **on every single page view**. That is a self-inflicted load problem
on the hottest path in the system. Keep counters in their own table that pgsync
does not track.

Aggregate per day so rows stay bounded (one row per item/metric/day, not one per
hit):

```prisma
enum MetricKind {
  VIEW
  DOWNLOAD
}

model ItemMetricDaily {
  itemId String
  metric MetricKind
  day    DateTime @db.Date
  count  Int      @default(0)

  @@id([itemId, metric, day])
  @@index([day])
  @@index([itemId, metric])
  @@map("item_metrics_daily")
}
```

Increment with a single upsert — no read-modify-write, no row lock held across a
request:

```sql
INSERT INTO item_metrics_daily ("itemId", metric, day, count)
VALUES ($1, $2, CURRENT_DATE, 1)
ON CONFLICT ("itemId", metric, day) DO UPDATE SET count = item_metrics_daily.count + 1;
```

Recording rules:
- **Never block or fail the read.** Fire-and-forget; a counter error must not
  turn a successful page view into a 500. Batch in memory and flush on an
  interval if write volume warrants it.
- **Anonymous counts too** — most public traffic has no principal, so this
  cannot depend on `principal.sub`.
- **Filter bots**, or the numbers are worthless. User-agent deny-list at minimum.
- **Store no raw IPs.** This is a public library site; if de-duplication needs a
  visitor key, use a salted daily hash, not the address itself.

### Part 3 — Aggregate statistics

Productivity numbers come from `item_revisions` (`CREATE` and `PUBLISH` rows per
`userId` per period) — which is why history has to land first. Resolve `userId`
to a display name through the `user_profiles` cache from
[Task Delegation](backend-task-delegation.md); without it every chart legend is
a column of UUIDs.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/items/:id/history` | revision timeline for one item |
| `GET` | `/api/stats/overview` | totals + created/published time series |
| `GET` | `/api/stats/users` | per-user created / published / edited counts |
| `GET` | `/api/stats/items/top` | most viewed / most downloaded, by period |

All of it behind `records:view:hidden` + `drafts:view:hidden`, matching the
existing `/api/items/stats` guard. Every endpoint takes `from` / `to`; cap the
range and the row count so a wide query can't table-scan the metrics table.

## Open questions

- **Retention** — keep revisions forever, or roll up beyond N months? Metadata
  diffs are small, but `item_metrics_daily` grows with catalogue × days.
- **Revert** — is "restore this revision" in scope, or is the timeline
  read-only for v1? Revert needs full snapshots or reverse-application of
  diffs, which changes the storage decision above.
- **Are file downloads per-file or per-item?** A record with 30 scans:
  30 downloads, or 1? Affects whether `itemId` alone is the right key.
- **Does a search-results appearance count as a view**, or only an item detail open?

## Changes Needed

### Backend

- [ ] Add `ChangeAction`, `ItemRevision`, `MetricKind`, `ItemMetricDaily` to
      `schema.prisma` + migration (`@db.Timestamptz(3)` on timestamps).
- [ ] Deep-diff helper for `metadata` producing `{ path, before, after }[]`.
- [ ] Write `ItemRevision` rows in the same transaction as create / update /
      transition / delete, and on file + relation writes.
- [ ] Backfill a synthetic `CREATE` revision for existing items so the timeline
      isn't empty for everything catalogued so far.
- [ ] Metric recording on `GET /api/search/:id` and
      `GET /api/files/:fileId/download` — non-blocking, bot-filtered.
- [ ] `StatsModule` with the four endpoints above; extend the existing
      `/api/items/stats` rather than duplicating it.
- [ ] Confirm the new tables are **excluded** from
      `infrastructure/docker/pgsync/schema.json`.
- [ ] Add all new endpoints to `backend/test/api-test-suite.sh`, including a
      case asserting a view does **not** bump the item's `version` or
      `updatedAt`.

### Frontend

- [ ] Item history timeline — who/when/what changed, per field.
- [ ] Admin statistics dashboard: totals, created/published over time, per-user
      breakdown, top viewed/downloaded.

## Key Files

- `backend/src/modules/items/items.service.ts:43` — existing `stats()` to extend
- `backend/src/modules/items/items.service.ts` — `update()`, `transition()`: where revisions get written
- `backend/src/modules/search/search.controller.ts:32` — `GET /:id`, the view-count hook
- `backend/src/modules/files/files.controller.ts` — download endpoint, the download-count hook
- `backend/prisma/migrations/20260330183516_item_relations_children_count_trigger/migration.sql` — the trigger that makes `version` a write counter
- `backend/BACKEND_REFERENCE.md` — "What `version` means"
- `infrastructure/docker/pgsync/schema.json` — keep metrics tables out of CDC
- `backend/test/api-test-suite.sh` — API tests
