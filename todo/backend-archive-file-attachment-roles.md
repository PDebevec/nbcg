# Backend: File attachment role/variant (archival vs web vs thumbnail)

## Status: TODO (recommended)

## Why we need it

The archive produces several derivatives of one scanned item:
- a full-quality **archival PDF** (built from TIFFs) — kept **local**, not
  uploaded;
- a **downscaled web PDF** — **uploaded**, this is what the site serves;
- optionally a **thumbnail** image — the frontend collection views want
  thumbnails (`frontend-collection-views.md`).

`FileAttachment` today only records `FileType` (`IMAGE | PDF | UNKNOWN`), so the
backend cannot tell *which* image is the thumbnail or that a PDF is the
web/access copy. A `role`/`variant` lets the frontend pick the right asset
(thumbnail for cards, web PDF for the viewer).

## Current State

- `FileAttachment` (`schema.prisma`): `fileType FileType (IMAGE|PDF|UNKNOWN)`,
  one blob (`originalFid`) + optional `extractedText`. **No role/variant.**
- `frontend-collection-views.md` explicitly asks which child fields to show
  (title, **thumbnail**, description…).

## Changes Needed

- Add a `role`/`variant` enum to `FileAttachment`, e.g.
  `SOURCE | ARCHIVAL | WEB | THUMBNAIL`.
- Set it on upload (the archive supplies which role each file is).
- Index it in pgsync so search results / the frontend can select by role.
- Decide the upload contract: **web PDF always**; **thumbnail if the frontend
  needs it**; archival PDF + TIFFs stay local in the archive.

## Tasks

- [ ] Migration: add `role` enum + column to `FileAttachment`.
- [ ] Extend the upload DTO/flow so the archive tags each file's role.
- [ ] Add `role` to `infrastructure/docker/pgsync/schema.json` (nested
      `file_attachments`) and to search source mapping.
- [ ] Frontend: select assets by role (thumbnail vs web PDF).

## Key Files

- `backend/prisma/schema.prisma` (+ migration)
- `backend/src/modules/files/dto/upload-files.dto.ts`
- `backend/src/modules/files/files.service.ts`
- `infrastructure/docker/pgsync/schema.json`
