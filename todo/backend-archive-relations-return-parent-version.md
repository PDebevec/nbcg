# Backend: return the parent's new `version` from relation writes

## Status: TODO — P3, nice-to-have (the archive can work around it)

Found during `nbcg-dc` Epic 09 (API contract verification), 2026-08-07.
**Not blocking** — the archive is fixing its own side regardless. File this only
if you agree the ergonomics are worth a small change.

## What happens today

`POST /api/relations/connect` and `/disconnect` return **empty bodies**. But each
edge row they write fires `trg_item_relations_children_count`
(migration `20260725120000_add_version_optimistic_concurrency`), which runs:

```sql
UPDATE drafts|records
SET metadata = jsonb_set(metadata, ARRAY[v_field], …),
    version  = version + 1
WHERE id = <parentId>;
```

So connecting N children advances the parent's `version` by N, and the caller is
never told.

**Live-verified 2026-08-07** against the dev backend: created a parent (v0),
connected one child, then `PATCH`ed the parent with `expectedVersion: 0` →
`409 Version conflict: expected 0, current 1`.

**Re-confirmed 2026-08-07** in a second, independent round-trip (`nbcg-dc` Epic 10
API verification) with a fully-scoped token — same result, so this is reproducible
and not an artefact of the first session's setup. One further observation from that
run: `GET /api/search/:id/children` returned `total: 0` immediately after the
`connect`, **even though the parent document itself was already indexed**. So the
relation edge propagates through CDC independently of the item, and reading
children back is not a usable way to confirm a connect either — which removes the
last cheap client-side workaround and slightly strengthens the case for returning
the parent's state from the write.

Two aggravating details:

- The trigger writes raw SQL, so the parent's **`updatedAt` does not move** even
  though its `version` and `metadata` did — `updatedAt` is not a usable change
  signal for parents.
- The obvious recovery, re-reading via `GET /api/search/:id`, is **CDC-lagged**,
  so immediately after the connect the search copy still holds the old version.
  The client is asked to recover a value the backend already computed, through
  the one path guaranteed to be stale.

`POST /api/items/transition` has the same shape (bumps `version` by 1, returns
empty).

## Why it is only P3

`nbcg-dc` never patches a parent in the same flow that connects to it —
`services/upload.ts` patches only the item being uploaded. The failure needs a
sequence across batches: upload a serial, later upload issues under it, later
still re-upload or edit the serial. When it does hit, the operator gets a
misleading message (*"The record changed on the server since it was last
synced"* — nothing did, except the archive's own `connect`), and the suggested
refresh may be CDC-stale and fail again.

The archive can close this without any backend change, by invalidating or
re-reading the affected parent's mirrored version after `connectParents`. That
work is tracked on the `nbcg-dc` side (Epic 07 follow-up).

## The change, if you want it

Return the parent's post-write state, e.g.

```jsonc
// POST /api/relations/connect  →  200
{ "parentId": "…", "version": 7, "childrenInDrafts": 3, "childrenInRecords": 0 }
```

`disconnect` the same. An `ETag` / `X-Item-Version` response header would do
equally well if a body on these endpoints is unwelcome. Doing the same for
`POST /api/items/transition` (returning `{ id, version }[]`) closes the matching
gap there.

## Acceptance

- A client that connects children under a parent can `PATCH` that parent
  immediately afterwards without a `409` and without a CDC-lagged re-read.
