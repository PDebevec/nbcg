# Backend: Optimistic concurrency on item update

## Status: TODO (recommended, not blocking)

## Why we need it

The archive and the website both `PATCH` the **same** items via the same
endpoint. Today updates are **last-write-wins with no detection**: if two people
edit the same field, the later save silently overwrites the earlier one. (The
shallow-merge of metadata protects *different* fields, but not the *same*
field.) Optimistic locking makes a conflict **explicit** so the client can
re-fetch and retry instead of losing data — the standard, tested fix for
multi-client editing.

## Current State

- `PATCH /api/items/:id` shallow-merges `metadata`
  (`data.metadata = { ...existing, ...incoming }` in `items.service.ts`).
- **No `version`/`rowVersion` column, no `If-Match`/ETag** anywhere.
- Caveat: the child-count trigger `fn_update_children_counts` mutates parent
  `metadata` **without bumping `updatedAt`**, so `updatedAt` alone is an
  imperfect version signal.

## Changes Needed

- Add an integer `version` to `drafts` and `records` (migration), bumped on
  every update.
- Accept an expected version on `PATCH` (an `If-Match` header or a body field);
  return **`409 Conflict`** on mismatch.
- Make the count trigger also bump `version`/`updatedAt`, **or** explicitly
  exclude count-only changes from the concurrency check.
- Surface `version` in reads (the direct read + the OpenSearch `_source`).

## Tasks

- [ ] Migration: add `version Int @default(0)` to `drafts` + `records`.
- [ ] Bump `version` in the update path; enforce expected-version → 409.
- [ ] Reconcile the child-count trigger with the version/`updatedAt` signal.
- [ ] Index `version` in `infrastructure/docker/pgsync/schema.json`.
- [ ] Archive: send the version it read; on 409, re-fetch and prompt the user.

## Key Files

- `backend/prisma/schema.prisma` (+ new migration)
- `backend/src/modules/items/items.service.ts` (update path)
- `backend/src/modules/items/dto/` (UpdateItemDto / header handling)
- `backend/prisma/migrations/` (child-count trigger migration)
- `infrastructure/docker/pgsync/schema.json`
