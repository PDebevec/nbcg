# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)
- [Text Extraction Indicator](frontend-text-extraction-indicator.md) — warn users about missing/bad PDF text (backend done, frontend TODO)
- [Optimistic Concurrency UX](frontend-optimistic-concurrency-ux.md) — handle 409 conflicts on item edits (TODO)
- [Search API Update](frontend-search-api-update.md) — adapt frontend to refactored search API, suggest endpoint, multi-select filters (TODO)

## Backend

- [Cookie Auth for File Downloads](backend-file-download-cookie-auth.md) — browser-native `<img>`/`<a>` loads of PRIVATE items' files 404 (no Bearer header); accept token cookie on the download GET only
- [Material-Type-Based Field Visibility](backend-archive-material-type-field-visibility.md) — annotate schema fields with `relevantForTypes` + pre-computed `typeProfiles` per material type (TODO)

## Backend — Archive (desktop app) integration

- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — backend done; archive still needs to wire "Get data" to the preview endpoint (frontend TODO)
