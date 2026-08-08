# Backend: non-ASCII upload filenames are mangled, silently losing the full text

## Status: TODO — **P1** (silent data loss on real library material)

Found and **live-verified** 2026-08-07 during the `nbcg-dc` write round-trip. This
was filed on the archive side as a *risk*
(`nbcg-dc/docs/tasks/naming-base-and-unicode-filenames.md`); it is now a confirmed
bug with a reproduction.

## What happens

`POST /api/files/upload/:itemId` with a multipart part whose `filename` contains
Cyrillic characters:

```
filename sent      : ОКТОИХ петогласник 2.pdf
extractedTexts     : {"ОКТОИХ петогласник 2.pdf": "Црногорски текст"}
→ HTTP 201
filename returned  : "?????? ??????????? 2.pdf"      ← every Cyrillic char → '?'
textExtractionStatus: NOT_EXTRACTED
extractedText      : null                            ← the text is GONE
```

**ASCII control, same request shape, same item** — proving it is the filename
encoding and not the endpoint:

```
filename sent      : ascii_name.pdf
→ 201, filename "ascii_name.pdf", textExtractionStatus EXTRACTED,
  extractedText "plain text"                          ← works
```

## Why this is P1

Two separate failures, and the request returns **`201 Created`** for both:

1. **The stored filename is corrupted.** `?????? ??????????? 2.pdf` is
   irreversible — the original characters are gone, not escaped. It is what the
   website will display and what `Content-Disposition` will offer on download.
2. **The full text is silently discarded.** `extractedTexts` is keyed **by
   filename**. The backend matches the JSON key against the (already mangled)
   part filename, finds no match, and stores nothing — so the file lands with
   `NOT_EXTRACTED` and `extractedText: null`. **No error, no warning, HTTP 201.**

The material this affects is not an edge case: the National Library of Montenegro
catalogues in **Cyrillic**. `ОКТОИХ петогласник 2` is a real folder in the sample
scan set. Every such item would publish with a garbled filename and **no
searchable full text**, and nothing would report a problem — the archive's own
upload would show success.

## Cause

Classic multipart decoding default: `busboy`/`multer` decode the `filename`
parameter as **latin1** unless told otherwise, so UTF-8 bytes are reinterpreted
and unmappable ones become `?`. The `extractedTexts` *value* survives (it is a
normal form field, decoded as UTF-8) — only the `filename` is damaged, which is
exactly why the mismatch is silent.

Worth checking all three places a filename is read:

- the `FileInterceptor` / multer config for `POST /api/files/upload/:itemId`
- `PUT /api/files/:fileId` (replace) — same interceptor pattern, presumably same bug
- `Content-Disposition` on `GET /api/files/:fileId/download` (RFC 6266 —
  non-ASCII needs `filename*=UTF-8''…`, not a bare `filename=`)

## Fix

1. **Decode the multipart filename as UTF-8.** Either configure the underlying
   parser (`defParamCharset: 'utf8'` on busboy ≥1.x), or repair at the boundary:
   `Buffer.from(file.originalname, 'latin1').toString('utf8')`. Prefer the parser
   option so nothing downstream has to remember.
2. **Then re-check the `extractedTexts` match**, since it keys off the decoded
   name. A test with a Cyrillic filename + a matching `extractedTexts` key should
   assert `textExtractionStatus === 'EXTRACTED'`.
3. **Consider failing loudly on an unmatched `extractedTexts` key.** Even after
   the encoding fix, a key that matches no uploaded file is almost certainly a
   client bug, and silently dropping the text is the worst possible response. A
   `400` (or at minimum a warning in the response) would have made this bug
   obvious in minutes rather than needing a targeted probe.
4. `Content-Disposition` should use the RFC 6266 `filename*` form for non-ASCII.

## Workaround available to clients (verified)

`PUT /api/files/:fileId/text` with `{ text }` is keyed by **fileId, not
filename**, and works correctly: it returned `{"updated":true}` and moved the file
to `textExtractionStatus: EXTRACTED`. So a client can upload, notice the returned
filename differs from what it sent, and re-attach the text by id. The archive is
adding that fallback (`nbcg-dc` Epic 07) — but it is a patch over a backend bug
that every other client would also need.

## Acceptance

- Uploading a part named `ОКТОИХ петогласник 2.pdf` returns that exact filename.
- With a matching `extractedTexts` key, that file comes back `EXTRACTED` with the
  text attached.
- The same holds for `PUT /api/files/:fileId` (replace).
- Downloading it offers the original filename.
- An `extractedTexts` key matching no uploaded file no longer passes silently.
