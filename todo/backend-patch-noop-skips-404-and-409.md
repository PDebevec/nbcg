# Backend: an empty `PATCH` returns success without checking existence or version

## Status: TODO — P2 (silent false success), plus a P3 semantics question

Found during `nbcg-dc` Epic 10 / API round-trip verification, 2026-08-07.
Behaviour 1 is **read from the code** (`items.service.ts:139-145`) — the live token
had expired before it could be probed, so please confirm before fixing.
Behaviour 2 was **measured live** against the dev backend.

## 1. The no-op early return precedes both guards (P2)

`ItemsService.update` short-circuits *before* it loads the item:

```ts
// backend/src/modules/items/items.service.ts
const hasMetadataChanges =
  metadataUpdate !== undefined && Object.keys(metadataUpdate).length > 0;

// Nothing to update — return success without touching the DB.
if (!visibilityStatus && !hasMetadataChanges) {
  return;                       // ← before the 404 check AND the 409 check
}

const [draft, record] = await Promise.all([...]);
if (!draft && !record) throw new NotFoundException(...);   // never reached
if (existing.version !== expectedVersion) throw new ConflictException(...);  // never reached
```

So for any request whose payload carries no `visibilityStatus` and no non-empty
`metadata`:

- **`PATCH /api/items/<id-that-does-not-exist>` → `200` empty, not `404`.**
- **`PATCH /api/items/<id>` with a wrong `expectedVersion` → `200` empty, not
  `409`.**

Both are *silent false successes*. A client that batches "save" operations and
sends `{ expectedVersion, metadata: {} }` when a form is untouched will be told
the write succeeded against an item that may not exist, or whose version it has
demonstrably lost track of. `nbcg-dc` is not currently exposed (it only PATCHes
with real changes), but the shape of the bug is that **the weakest payload gets
the weakest checking**, which is the wrong way round.

Note the request is still *authorised* — `@RequireScopes` runs on the route — so
this is a correctness bug, not an access-control one.

### Fix

Move the early return **after** the existence and version checks. Cheapest form:
load the item, 404 if missing, 409 on version mismatch, and only then return
early if there is nothing to write.

Also decide what an empty `PATCH` should return. It currently returns `undefined`
→ an empty `200` body, while a real update returns `{ version }`. A client cannot
distinguish "nothing to do" from "done, here is your new version" without
inspecting the body, so `nbcg-dc` treats a bodiless response as "version
unknown". Returning `{ version: existing.version }` (unchanged) would make the
response shape uniform and let callers always trust the returned version.

## 2. A `PATCH` that changes nothing still increments `version` (P3)

**Measured live 2026-08-07:** created a draft (v0), patched `subtitle` to
`"added by patch"` → `{version: 1}`, then patched `subtitle` to the **identical**
value with `expectedVersion: 1` → **`{version: 2}`**.

That follows from the code: the no-op check tests whether the *payload* is empty,
never whether the values *differ* from what is stored. `version` is therefore
"number of accepted write requests", not "number of times this item changed".

Consequences, none fatal but all mildly unpleasant:

- **Re-saving an unchanged form burns a version**, so any other client holding the
  previous version now gets a `409` for a change that never happened.
- `version` cannot be used as a change signal (e.g. to skip re-indexing or to
  decide whether a mirror is stale). `nbcg-dc`'s sync deliberately does not
  rely on it for that reason.
- `updatedAt` moves too, so it is equally unreliable as a "content changed" marker.

### Is this worth changing?

Arguably not — "version = write count" is a legitimate, simple contract, and
optimistic concurrency works correctly either way. But it should be **documented
as such**, because "version" invites the other reading. If you do want
change-detection semantics, compare the sanitised metadata against the stored
metadata and skip the bump when the merge is a fixpoint.

Either way, please state the intended meaning in the API docs so clients stop
guessing. (Related but separate: relation writes bump the parent's `version`
through a trigger and return nothing —
[`backend-archive-relations-return-parent-version.md`](backend-archive-relations-return-parent-version.md).)

## Acceptance

- `PATCH` with an empty payload to a nonexistent id → `404`.
- `PATCH` with an empty payload and a stale `expectedVersion` → `409`.
- `PATCH` with an empty payload on a real item at the right version → success,
  ideally carrying the (unchanged) `version`.
- The meaning of `version` — write counter vs change counter — is documented, and
  matches the implementation.
