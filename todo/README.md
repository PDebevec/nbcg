# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)
- [Text Extraction Indicator](frontend-text-extraction-indicator.md) — warn users about missing/bad PDF text (backend done, frontend TODO)
- [Optimistic Concurrency UX](frontend-optimistic-concurrency-ux.md) — handle 409 conflicts on item edits (TODO)
- [Search API Update](frontend-search-api-update.md) — adapt frontend to refactored search API, suggest endpoint, multi-select filters (TODO)

## Backend

- [Cookie Auth for File Downloads](backend-file-download-cookie-auth.md) — browser-native `<img>`/`<a>` loads of PRIVATE items' files 404 (no Bearer header); accept token cookie on the download GET only
- [Material-Type-Based Field Visibility](backend-archive-material-type-field-visibility.md) — annotate schema fields with `relevantForTypes` + pre-computed `typeProfiles` per material type (TODO)
- ✅ [Schema `?level` is unvalidated](backend-schema-level-validation.md) — **DONE 2026-08-07**: invalid `?level` now `400` (case-sensitive) via a validated DTO; ETag cache bounded to 3 keys
- ✅ [Empty `PATCH` skips the 404 and 409 checks](backend-patch-noop-skips-404-and-409.md) — **DONE 2026-08-07**: no-op return moved after both guards, `PATCH` always returns `{version}`. The 404 half never reproduced (the access check 404s first). `version` kept as a write counter and documented
- ✅ [Indexed timestamps have no timezone](backend-search-index-timestamps-missing-timezone.md) — **DONE 2026-08-07**: columns migrated to `timestamptz` + full reindex; indexed and REST timestamps now parse to the same instant

## Backend — Archive (desktop app) integration

- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — backend done; archive still needs to wire "Get data" to the preview endpoint (frontend TODO)
- ✅ [Relation writes bump the parent's version silently](backend-archive-relations-return-parent-version.md) — **DONE 2026-08-07**: `connect`/`disconnect` return `{parentId, version, childrenInDrafts, childrenInRecords}` and `transition` returns `{id, version}[]`; `disconnect` is now `200` (was `204`)
