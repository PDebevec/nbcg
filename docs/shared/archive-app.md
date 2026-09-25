# The desktop archive app

A separate desktop application (TypeScript/Vue) used by archive staff at the
client (on the `nbcg-dc` machine, Windows). Its source is **not in this
repository** and it is released on its own schedule.

## What it does

Archive staff catalogue and upload in bulk: type a COBISS id → get the data →
check/edit the metadata in a generated form → create the item → upload scans
(with OCR text produced on the client) → link children to parents.

## What it uses from the API

| Endpoint | For | Contract notes |
|---|---|---|
| `GET /api/schema/record` (v1) | **builds its whole metadata editor from this JSON**, per hand-set level `main`/`child` | frozen until the app is on v2 — see below |
| `GET /api/import/cobiss/preview/:cobissId` | "Get data" without creating anything | wired (`useMetadataForm.ts`) |
| `POST /api/items`, `PATCH /api/items/:id` | create / edit; `targetState` DRAFT or RECORD, chosen per batch (default Draft) and changeable per item | `expectedVersion` on PATCH (409 on conflict). **Schema v2 B8–B10 (dev since 2026-09-25):** every create and edit is checked against the Draft or Record rules → `400 METADATA_VALIDATION_FAILED` (was `PUBLISH_VALIDATION_FAILED`, Record only); a Draft needs a title and a material type. Create takes `parentIds` and returns each parent's new `version`; an unknown parent → `400 PARENT_NOT_FOUND`. The Draft/Record choice is locked once the item exists (edits are checked against its backend state) |
| `POST /api/files/upload/:itemId` | scans + `extractedTexts` (filename → OCR text) + `role` | keys of `extractedTexts` must match an uploaded filename or the whole request is a 400 |
| `POST /api/relations/connect` | links every item of a batch to the batch's parents, after the upload | returns the parent's new `version`. Once the app is on v2: only for re-uploads and taken-over records (new items use `parentIds` on create). Since 2026-09-25 (dev) it re-checks each child, and an unknown parent → `400 PARENT_NOT_FOUND` (was 404) |
| `GET /api/search…` | lookups (parents, …) | |

Not used: `/api/tasks` and `POST /api/items/transition` (`transitionItems`
exists in the app's `items.ts` but nothing calls it). Confirmed 2026-09-25.

## Rules for backend changes

**While all data is test data (decided 2026-09-25)** a backend change may
break the app for a while: wipe, move processed batches back to "scanned",
upload again once the app catches up. Still:

1. Keep `GET /api/schema/record` (v1) until the app has moved to v2 — the app
   cannot build its form without it.
2. Call out every change that affects the app in the plan's "Impact" table.

Once real cataloguing starts, go back to strict backwards compatibility
(versioned routes, optional additions only).

## Open work for the app

- [x] Does the app create items as `RECORD`? Yes, both (2026-09-25) — accepted
      without a release window, see above.
- [x] Wire "Get data" to the COBISS preview — [backend note](../backend/history/archive-cobiss-preview.md).
- [ ] Move to metadata schema v2 — [migration guide](plans/metadata-schema-v2-archive-app.md)
      (includes dropping the main/child switch and creating with `parentIds`).
