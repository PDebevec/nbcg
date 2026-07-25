# Backend: item_relations integrity on delete

## Status: TODO (integrity / robustness)

## Why we need it

`item_relations` has **no foreign keys** to `drafts`/`records`, so
**hard-deleting an item leaves dangling relation rows** pointing at an id that
no longer exists, and the denormalized child counts in parent `metadata` go
stale. The archive will create and break **many** parent/child links (multi-
parent, serial issues) and delete items, so the relation graph it depends on
must stay clean. This is a pre-existing gap the archive will exercise heavily.

## Current State

- `ItemRelation` (`schema.prisma`): composite PK `(parentId, childId)`,
  polymorphic (`parentType`/`childType`), **no FKs, no cascade**.
- Item deletes are hard (`deleteMany` in `items.service.ts`).
- `fn_update_children_counts` maintains counts when a **relation** row is
  inserted/deleted — but **not** when the underlying **item** is deleted out
  from under existing relations.

## Changes Needed

- On item delete, in the **same transaction**: delete every relation where the
  item is `parentId` or `childId`, then recompute affected parents' counts.
- Consider DB-level enforcement. A true FK to a polymorphic table isn't
  possible; use a trigger (delete relations + refresh counts on item delete) or
  application-level cleanup in the service.
- Cycles are **allowed by design** (multi-parent graph may contain cycles) — do
  **not** add a cycle guard; only fix dangling rows + stale counts.

## Tasks

- [ ] Delete related `item_relations` rows on item delete (both directions).
- [ ] Recompute child counts for affected parents after cleanup.
- [ ] Decide trigger vs. service-level; wrap in the delete transaction.
- [ ] Backfill: clean up any already-dangling rows once.

## Key Files

- `backend/src/modules/items/items.service.ts` (delete path)
- `backend/prisma/schema.prisma` / `backend/prisma/migrations/` (trigger)
