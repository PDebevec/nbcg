# Backend: Direct (Postgres) read-by-id for read-after-write

## Status: TODO

## Why we need it

The archive frequently reads an item **immediately after** creating or updating
it — to confirm the write, refresh the local `metadata.json`, or show the saved
state. Today the only read-by-id (`GET /api/search/:id`) is served from
**OpenSearch**, which is fed asynchronously by the **pgsync CDC daemon** and is
therefore **eventually consistent** (replication lag). A read right after a
write can miss the item or return stale data. A direct Postgres read gives the
archive **strong read-after-write** for its own changes.

## Current State

- `GET /api/search/:id` (`search.controller.ts` → `search.service.ts`) reads
  from OpenSearch (CDC-lagged).
- `POST /api/items` and `PATCH /api/items/:id` return the row straight from
  Postgres (trustworthy), but any subsequent `GET /search/:id` may lag behind.
- There is **no Postgres-direct single-item read endpoint**.

## Changes Needed

- Add `GET /api/items/:id` served **directly from Postgres via Prisma**,
  applying the same visibility/auth rules as the rest of the item routes
  (`ResourceAccessService`).
- Clients use this for consistency-sensitive reads; keep `GET /search/...` for
  discovery/search.
- Include `version`/`updatedAt` in the response (see the concurrency task).

## Tasks

- [ ] Add `GET /api/items/:id` in `items.controller.ts`.
- [ ] Implement direct Prisma fetch (draft + record) in `items.service.ts`.
- [ ] Enforce view scoping (return 404 on no-view, matching existing behavior).
- [ ] Archive: use this endpoint for read-after-write and metadata refresh.

## Key Files

- `backend/src/modules/items/items.controller.ts`
- `backend/src/modules/items/items.service.ts`
- `backend/src/core/auth/resource-access.service.ts` (reference)
