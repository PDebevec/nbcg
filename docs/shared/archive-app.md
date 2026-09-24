# The desktop archive app

A separate desktop application used by archive staff at the client (on the
`nbcg-dc` machine, Windows). Its source is **not in this repository** and it is
released on its own schedule, so every backend change it depends on must stay
backwards-compatible until it is updated.

## What it does

Archive staff catalogue and upload in bulk: type a COBISS id → get the data →
check/edit the metadata in a generated form → create the item → upload scans
(with OCR text produced on the client) → link children to parents.

## What it uses from the API

| Endpoint | For | Contract notes |
|---|---|---|
| `GET /api/schema/record` (v1) | **builds its whole metadata editor from this JSON** | frozen — see below |
| `GET /api/import/cobiss/preview/:cobissId` | "Get data" without creating anything | backend done; wiring in the app still open |
| `POST /api/items`, `PATCH /api/items/:id` | create / edit | `expectedVersion` on PATCH (409 on conflict) |
| `POST /api/files/upload/:itemId` | scans + `extractedTexts` (filename → OCR text) + `role` | keys of `extractedTexts` must match an uploaded filename or the whole request is a 400 |
| `POST /api/relations/connect` | parent ↔ child | returns the parent's new `version` |
| `GET /api/search…` | lookups | |

This list is reconstructed from the backend plans written for the app (COBISS
preview, material-type visibility) — confirm it against the app itself when
possible, especially whether it creates items as `DRAFT` or `RECORD` and
whether it calls `/api/tasks` (it is assumed not to).

## Rules for backend changes

1. **Never change the shape of a response the app reads in place.** Add a new
   versioned route (`/api/schema/v2/record`) and keep the old one until the app
   has moved.
2. Adding optional response fields is fine; removing or retyping is not.
3. Behaviour changes that affect every client (e.g. publish validation in
   schema v2) must be called out in the plan's "Impact" table and checked with
   whoever maintains the app **before** the backend release.

## Open work for the app

- [ ] Wire "Get data" to the COBISS preview — [backend note](../backend/history/archive-cobiss-preview.md).
- [ ] Move to metadata schema v2 — [migration guide](plans/metadata-schema-v2-archive-app.md).
