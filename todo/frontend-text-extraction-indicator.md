# Frontend: Text Extraction Status Indicator

## Status: TODO (backend is done)

## Summary

Show a visual indicator on records/drafts management views when a PDF attachment has missing or garbage extracted text. This lets users know they may need to re-upload with OCR enabled.

## Backend (DONE)

The `textExtracted` boolean has been replaced with a `textExtractionStatus` enum on `FileAttachment`:

| Status | Meaning |
|--------|---------|
| `NOT_EXTRACTED` | No extraction attempted or pending |
| `EXTRACTED` | Text was extracted and passes quality check |
| `GARBAGE` | Text was extracted but failed the garbled-text heuristic |
| `NO_TEXT` | Extraction ran but produced no text (e.g. image-only PDF) |

The status is returned in file attachment list responses (`GET /files/:itemId`). The `extractedText` field itself is still omitted from responses (too large).

## Design

- On the records/drafts table (or wherever attachments are managed), show an icon per row:
  - **No icon** — no PDF attachments, or all PDFs have `EXTRACTED` status
  - **Warning icon** (exclamation triangle) — at least one PDF has `GARBAGE` status
  - **Info icon** (or grey indicator) — at least one PDF has `NOT_EXTRACTED` or `NO_TEXT` status
- Tooltip on hover explaining the status (e.g. "PDF text may be unreadable — consider re-uploading with OCR")
- Optionally: in the record/draft detail view, show per-file status next to each attachment

## Tasks

- [ ] Read `textExtractionStatus` from file attachment API responses
- [ ] Add status icon component (warning / info / none)
- [ ] Integrate icon into records/drafts table rows
- [ ] Add tooltip with actionable message
- [ ] Optionally: show per-file status in detail view
