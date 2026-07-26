# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)
- [Text Extraction Indicator](frontend-text-extraction-indicator.md) — warn users about missing/bad PDF text (backend done, frontend TODO)

## Backend

- [Cookie Auth for File Downloads](backend-file-download-cookie-auth.md) — browser-native `<img>`/`<a>` loads of PRIVATE items' files 404 (no Bearer header); accept token cookie on the download GET only
- [Search API Refinement](backend-search-api-refinement.md) — configurable response shapes, sorting, filter params
- [Search Autocomplete API](backend-search-autocomplete-api.md)

## Backend — Archive (desktop app) integration

Changes to support the **archive** desktop app (Tauri/Vue) that processes scans
and uploads records/drafts. The backend stays the single source of truth; the
archive is a client. The archive is now organised around **batches** and a
four-destination UI (see `nbcg-dc/docs/01-concept-and-ux.md`); batches are
**local-only** and need no backend API. Rough priority order:

- [Identity / Verify](backend-archive-identity-verify.md) — verify token → email + access level (powers Settings → Test connection, write-gating) **(P1)**
- [Metadata Schema Endpoint](backend-archive-metadata-schema-endpoint.md) — expose field defs (incl. main/child levels + parent-inheritable / issue-identifying flags) so clients build forms dynamically **(P1)**
- [External Full-Text Ingest](backend-archive-external-fulltext-ingest.md) — accept archive-side OCR text (OCR runs on the archive) **(P1)**
- [Replace File (re-upload)](backend-archive-replace-file.md) — atomic swap of an attachment's PDF + full text after re-processing **(P2)**
- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — fetch+parse without persisting, to prefill the form **(P2)**
- [Direct Item Read](backend-archive-direct-item-read.md) — Postgres read-by-id for read-after-write (avoid CDC lag) **(P2)**
- [Optimistic Concurrency](backend-archive-optimistic-concurrency.md) — version + `If-Match` → 409 on concurrent edits **(P3)**
- [File Attachment Roles](backend-archive-file-attachment-roles.md) — archival vs web vs thumbnail variant **(P3)**
- [item_relations Integrity](backend-item-relations-integrity.md) — clean up dangling relations/counts on delete **(P3)**

**No backend change needed:** **visibility** — Public/Private/Hidden already
exist as `VisibilityStatus` on `Draft`/`Record` (required in `CreateItemDto`);
the archive just sends `visibilityStatus`. **PDF naming** — derived from the
scanner's folder name on the archive; there is no backend naming step.

## Infrastructure

- [Infrastructure](infrastructure.md) — (no tasks yet)
