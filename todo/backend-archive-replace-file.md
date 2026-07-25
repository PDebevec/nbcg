# Backend: Replace a file's PDF + full text in place (re-upload)

## Status: TODO

## Why we need it

When the archive **re-processes** an item (e.g. TIFFs were added or changed), it
produces a new web PDF and new OCR text and must **re-upload** them, replacing
what's on the record. Today the files API can only **add**
(`POST /files/upload/:itemId`), **delete** (`DELETE /files/:fileId`), or
**re-extract via Tika** (`POST /files/:fileId/extract`) — there is **no atomic
"swap this attachment's blob + text"**. Doing it as delete-then-upload is two
round-trips and briefly leaves the record with no file (and a new attachment id,
which the archive would have to re-learn). A dedicated replace keeps the
attachment **id stable** and the swap **atomic**.

## Current State

- `FilesService` (`backend/src/modules/files/files.service.ts`): `upload`
  (create), `delete`, `reextract`. `FileAttachment.originalFid` is the
  SeaweedFS blob; `extractedText` is only set by the Tika processor.
- No endpoint replaces an existing attachment's content.

## Changes Needed

- Add `PUT /files/:fileId` (or `POST /files/:fileId/replace`) that:
  - accepts the new file (multipart) and, like the external-text-ingest task,
    an optional **pre-extracted `extractedText`** (archive OCR);
  - uploads the new blob to SeaweedFS, updates `originalFid`, `filename`,
    `mimeType`, `sizeBytes`;
  - sets `extractedText` + `textExtractionStatus` from the supplied text (skip
    Tika when text is provided; otherwise honor `doOCR` as on upload);
  - **deletes the old blob** only after the DB row is updated (same orphan-
    safety ordering as `delete`).
- Keep the attachment **id** unchanged so the archive's stored fileId stays
  valid.
- Pairs with `backend-archive-external-fulltext-ingest.md` (shared text-input
  handling) and `backend-archive-file-attachment-roles.md` (replace the WEB PDF
  specifically).

## Tasks

- [ ] Add the replace route + `FilesService.replace`.
- [ ] Reuse the external-text path (store provided text, skip Tika).
- [ ] Swap blob with orphan-safe ordering (update row, then delete old fid).
- [ ] Return the updated attachment; keep the id stable.
- [ ] Archive: on re-upload, call replace for the item's web-PDF attachment.

## Key Files

- `backend/src/modules/files/files.controller.ts`
- `backend/src/modules/files/files.service.ts`
- `backend/src/modules/files/dto/upload-files.dto.ts`
- `backend/src/core/seaweedfs/seaweedfs.service.ts` (reference)
