# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)
- [Text Extraction Indicator](frontend-text-extraction-indicator.md) — warn users about missing/bad PDF text (backend done, frontend TODO)
- [Optimistic Concurrency UX](frontend-optimistic-concurrency-ux.md) — handle 409 conflicts on item edits (TODO)
- [Search API Update](frontend-search-api-update.md) — adapt frontend to refactored search API, suggest endpoint, multi-select filters (TODO)

## Backend

- [Cookie Auth for File Downloads](backend-file-download-cookie-auth.md) — browser-native `<img>`/`<a>` loads of PRIVATE items' files 404 (no Bearer header); accept token cookie on the download GET only
- [Material-Type-Based Field Visibility](backend-archive-material-type-field-visibility.md) — annotate schema fields with `relevantForTypes` + pre-computed `typeProfiles` per material type (TODO)
- [Schema `?level` is unvalidated](backend-schema-level-validation.md) — `?level=bogus` (and `?level=MAIN`) return `200 {fields: []}` instead of a `400`, and clients are told to cache the empty schema for 24h; also caps the controller's unbounded ETag cache (P2)
- [Empty `PATCH` skips the 404 and 409 checks](backend-patch-noop-skips-404-and-409.md) — the no-op early return happens before the item is even loaded, so a payload with nothing to write reports success against a nonexistent id or a stale version; plus: `version` is a write counter, not a change counter (P2 + P3)
- [Indexed timestamps have no timezone](backend-search-index-timestamps-missing-timezone.md) — REST returns `…682Z` but `hit.source.createdAt` is `…682`, which JS parses as **local** time; every client reading search-hit timestamps is off by the UTC offset (P2)

## Backend — Archive (desktop app) integration

- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — backend done; archive still needs to wire "Get data" to the preview endpoint (frontend TODO)
- [Relation writes bump the parent's version silently](backend-archive-relations-return-parent-version.md) — `connect`/`disconnect` fire a trigger that increments the parent's `version` but return an empty body, so a later `PATCH` on that parent `409`s (P3 — the archive can work around it)
