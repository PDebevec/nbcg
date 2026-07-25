# Backend: Accept externally-extracted full text (OCR on the archive)

## Status: TODO

## Why we need it

We decided **OCR happens in the desktop archive** (PaddleOCR), not the backend.
But today, on every PDF upload the backend **always enqueues Tika extraction**;
the `doOCR` flag only toggles Tika's OCR *strategy* (default `false` =
embedded-text-layer only). So a scanned/downscaled PDF that the archive already
OCR'd, uploaded with `doOCR=false`, ends up with `textExtractionStatus=NO_TEXT`
and an **empty** `extractedText` — the archive's good OCR text never reaches the
backend, and **full-text search silently breaks** for those documents.

We need the archive to be able to **push its already-extracted text**, and the
backend to store it (and skip Tika for that file).

## Current State

- `POST /files/upload/:itemId` — `UploadFilesDto { doOCR?: boolean = false }`
  (`backend/src/modules/files/dto/upload-files.dto.ts`).
- `FilesService.upload` (`files.service.ts`) creates the `FileAttachment` then,
  for every PDF, **always** enqueues `pdf-extraction` (passing `doOcr`).
- `PdfExtractionProcessor` runs Tika, sets `extractedText` +
  `textExtractionStatus` (`EXTRACTED | GARBAGE | NO_TEXT`).
- `FileAttachment.extractedText` is **only ever** written by the processor —
  there is no way for a client to supply text.

## Changes Needed

1. Let the client supply already-extracted text on upload. Because upload
   accepts up to 10 files, map text→file. Simplest for the archive: **one PDF
   per request + its text** (or a `filename → text` JSON map in the body).
2. When text is supplied for a file: store `extractedText`, set
   `textExtractionStatus = EXTRACTED` (or `NO_TEXT` if empty; optionally run the
   existing `looksGarbled` check), and **do NOT enqueue Tika** for that file.
3. Keep the existing `doOCR`/Tika path as a fallback for other clients.
4. Optionally add `PUT /files/:fileId/text` to (re)set text after the fact
   (mirrors the existing `POST /files/:fileId/extract`).

## Tasks

- [ ] Extend `UploadFilesDto` with an optional text input (per-file map, or
      document the one-PDF-per-request contract).
- [ ] In `FilesService.upload`: if text is provided for a PDF, write it + set
      status and **skip** `pdfQueue.enqueue` for that file.
- [ ] Reuse `TikaService.looksGarbled` for the quality flag (optional).
- [ ] (Optional) `PUT /files/:fileId/text` endpoint + `FilesService.setText`.
- [ ] Confirm the archive uploads the **downscaled/web PDF** with `doOCR=false`
      and the PaddleOCR text alongside.

## Key Files

- `backend/src/modules/files/dto/upload-files.dto.ts`
- `backend/src/modules/files/files.controller.ts`
- `backend/src/modules/files/files.service.ts`
- `backend/src/modules/files/queue/pdf-extraction.processor.ts` (reference only)
