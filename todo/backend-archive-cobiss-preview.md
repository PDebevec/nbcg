# Backend: Synchronous COBISS preview (fetch without persist)

## Status: DONE (backend) / TODO (frontend wire-up)

## Why we need it

The archive's fast path is: **type a COBISS id → "Get data" → prefill the form
→ edit → then create/upload.** Today the only COBISS path (`POST /import/cobiss`)
is **async and immediately creates** the item, so there is no way to preview and
edit before anything is persisted — and if the user abandons, an orphan draft is
left behind. A synchronous preview returns the normalized metadata for the form
**without writing anything**.

## Current State

- `POST /api/import/cobiss` (`cobiss-import.controller.ts`) enqueues a BullMQ
  import job; the worker fetches via `fetchCobissRecord`, builds
  `CobissMetadata`, and **creates** a `Draft`/`Record` with a deterministic id.
- Fetch/parse logic already exists and is reusable:
  `backend/src/modules/import/cobiss/cobiss-util/cobiss-fetch.ts` and
  `cobiss-parser.ts`.
- `backend/scripts/fetch-cobiss.ts` is a CLI that already dumps a fetched record
  as JSON — proof the fetch+parse can run standalone.
- **No synchronous, non-persisting preview endpoint exists.**

## Changes Needed

- Add `GET /api/cobiss/:id/preview` (or `POST /api/import/cobiss/preview`) that
  runs fetch + parse and returns `CobissMetadata` **without persisting**.
- Reuse `cobiss-fetch.ts` + `cobiss-parser.ts`.
- Handle not-found, upstream/COBISS errors, and multiple matches cleanly.
- Note: item ids are `generateDeterministicId(cobissId)`, so the archive can
  anticipate the resulting id and detect "already imported" before creating.

## Tasks

- [x] Add the preview route (controller) reusing the existing fetch/parse utils.
- [x] Return normalized `CobissMetadata`; define error responses.
- [x] Require an appropriate scope (`import:execute`) — decided during impl.
- [ ] Archive: wire "Get data" to call preview and prefill the form.

## Key Files

- `backend/src/modules/import/cobiss/cobiss-import.controller.ts`
- `backend/src/modules/import/cobiss/cobiss-util/cobiss-fetch.ts`
- `backend/src/modules/import/cobiss/cobiss-util/cobiss-parser.ts`
- `backend/scripts/fetch-cobiss.ts` (reference)
