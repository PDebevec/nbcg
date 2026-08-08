# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)

## Backend

- 🔴 [Non-ASCII upload filenames are mangled](backend-multipart-filename-not-utf8.md) — **P1, live-verified**: a Cyrillic multipart filename comes back as `??????`, and because `extractedTexts` is keyed by filename the **full text is silently discarded** (`NOT_EXTRACTED`, `null`) on an HTTP `201`. Affects real Montenegrin material; ASCII control passes
- [Cookie Auth for File Downloads](backend-file-download-cookie-auth.md) — browser-native `<img>`/`<a>` loads of PRIVATE items' files 404 (no Bearer header); accept token cookie on the download GET only
- [Material-Type-Based Field Visibility](backend-archive-material-type-field-visibility.md) — annotate schema fields with `relevantForTypes` + pre-computed `typeProfiles` per material type (TODO)

## Backend — Archive (desktop app) integration

- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — backend done; archive still needs to wire "Get data" to the preview endpoint (frontend TODO)
