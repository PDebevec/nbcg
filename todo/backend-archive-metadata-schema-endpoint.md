# Backend: Metadata Schema Endpoint (dynamic form definitions)

## Status: TODO

## Why we need it

The desktop **archive** app (and the web frontend) build create/edit forms for
record/draft metadata. Today the field definitions — which fields exist, which
are required, which are coded/enumerated, and their types — live **only**
server-side as validators and would have to be hand-duplicated in every client.
Exposing them over HTTP lets clients **render forms dynamically** and stay in
sync automatically when the metadata shape changes (add/remove a field) — no
client redeploy, no silent drift between what the backend accepts and what the
form offers.

## Current State

- Metadata is validated on write by `sanitizeMetadata` against
  `METADATA_VALIDATORS`, built from:
  - `EDITABLE_BASE_METADATA_SHAPE` — `backend/src/core/types/metadata.types.ts`
  - `DOMAIN_RECORD_SHAPE` — `backend/src/modules/import/cobiss/cobiss-util/cobiss.types.ts`
  - `REQUIRED_METADATA_VALIDATORS` (enforces non-empty `title`).
- Coded value maps (language, materialType, …) live in
  `backend/src/modules/import/cobiss/cobiss-util/cobiss-code-map.ts`.
- **None of this is exposed over HTTP.** There is no `/schema` route.

## Changes Needed

Add a read-only endpoint that serializes the existing shapes into a
client-consumable descriptor — derived from the shapes above (single source of
truth), never hand-maintained.

- `GET /api/schema/record` (and `/api/schema/draft` if they ever diverge)
- Per field, return: `key`, `label`, `type` (`string|number|date|enum|array|object`),
  `required`, `allowedValues` for coded/enum fields (include code→label maps so
  the form can show human labels), grouping/order, and optional help text.
- **Level distinction (main vs child).** The archive renders **two field sets**:
  a **main** record (standalone) and a **child** record (a serial issue). Serve
  both — either as `GET /api/schema/record?level=main|child` or as two blocks in
  one response — so the editor can switch by item level. (The archive's child
  form drops standalone fields like `author` and adds issue fields like
  volume/year, issue number, issue date.)
- **Inheritance flags (needed by the archive's serial-issue flow + per-field
  source picker).** Per field, also return:
  - `parentInheritable: boolean` — whether a linked **parent** record can pass
    this field down to its children (e.g. serial title, publisher, place,
    language, subject);
  - `issueIdentifying: boolean` — whether the field identifies the **specific
    issue** (volume/year, issue number, issue date) and so must be filled per
    child even when a parent is linked.
- Add an `ETag`/`Cache-Control` so clients cache the schema and refetch only on
  change.
- Auth: read-only; likely public or any-authenticated (decide during impl).

## Tasks

- [ ] Define a serializable `FieldDescriptor` type (incl. `parentInheritable`
      + `issueIdentifying` flags).
- [ ] Build a serializer that derives descriptors from `EDITABLE_BASE_METADATA_SHAPE`
      + `DOMAIN_RECORD_SHAPE`, folding in `cobiss-code-map` for coded fields.
- [ ] Serve **main** and **child** field sets (level param or two blocks).
- [ ] New `schema` module: `GET /api/schema/record` (+ `/draft`).
- [ ] Add `ETag` support.
- [ ] Decide auth for the endpoint.
- [ ] Consume it in the archive form renderer (main/child switch + per-field
      source picker) and (optionally) the web frontend.

## Key Files

- `backend/src/core/types/metadata.types.ts` — base shape + validators
- `backend/src/modules/import/cobiss/cobiss-util/cobiss.types.ts` — `DOMAIN_RECORD_SHAPE`
- `backend/src/modules/import/cobiss/cobiss-util/cobiss-code-map.ts` — coded values
- `backend/src/modules/schema/` — **new** controller + service
- `backend/src/app.module.ts` — register the module
