# Frontend: Handle optimistic concurrency conflicts (409)

## Status: TODO

## Context

The backend now enforces optimistic concurrency on `PATCH /api/items/:id`.
Clients can send `expectedVersion` in the request body; if the item was
modified by someone else in the meantime the API returns **409 Conflict**.
The response body includes a message like:
`"Version conflict: expected 2, current 3. Re-fetch the item and retry."`

Even without `expectedVersion`, the backend guards against TOCTOU races
internally (the write uses `WHERE version = <read_version>`) and can still
return 409.

The `PATCH` response on success returns `{ version: <new_version> }` so the
client can track the latest version it knows about.

This affects **both** the web frontend (Next.js) and the archive desktop app.

## What the frontend needs to do

### 1. Track version in client state

When loading/fetching an item (via OpenSearch `_source` or direct DB read),
store the `version` field alongside the rest of the item data in whatever
state management is used (React state, context, store).

### 2. Send `expectedVersion` on every PATCH

Include the last-known version in update requests:

```json
{
  "expectedVersion": 2,
  "metadata": { "title": "Updated title" }
}
```

### 3. Handle 409 responses

When the API returns 409:

#### Automatic retry (first attempt)
- Re-fetch the item from the API to get the latest version + data.
- If the conflict is on **different fields** (i.e. the user changed `title`,
  but the server-side change was to `childrenInDrafts` from the count trigger),
  silently merge and retry the PATCH with the new `expectedVersion`.
- If the auto-retry succeeds, no user-visible interruption is needed.

#### User-visible conflict (auto-retry fails or same-field conflict)
Show a warning/error notification or modal:

**Option A — Simple toast/banner (recommended for v1):**
> "This item was modified by another user. Your changes could not be saved.
> The page has been refreshed with the latest data — please re-apply your
> changes."
- Auto-refresh the item data in the form.
- The user re-makes their edits on the fresh data and saves again.

**Option B — Side-by-side diff (advanced, optional):**
- Show the user's unsaved changes next to the current server state.
- Let the user pick which values to keep (theirs vs. server).
- Save with the merged result + new `expectedVersion`.

**Option C — Force-save button (escape hatch):**
- After showing the conflict warning, offer a "Save anyway" button that
  sends the PATCH **without** `expectedVersion` (which the backend allows).
- This is a last-write-wins override — label it clearly so the user
  understands they may overwrite someone else's changes.

### 4. Suggestions for implementation

- **Start with Option A** — it covers 90% of real-world conflicts and is
  simple to implement. The count-trigger bumps version frequently but those
  conflicts auto-resolve (different fields), so users will rarely see the
  warning in practice.
- Add Option C as a secondary action on the conflict warning for power users.
- Option B is nice-to-have for a future iteration if conflicts become frequent.

## Tasks

- [ ] Store `version` from item fetch responses in client state.
- [ ] Include `expectedVersion` in PATCH request body.
- [ ] Intercept 409 responses in the API client / fetch wrapper.
- [ ] Implement auto-retry for non-conflicting field changes.
- [ ] Show conflict warning with auto-refresh (Option A).
- [ ] (Optional) Add "Save anyway" escape hatch (Option C).
- [ ] (Future) Side-by-side conflict resolution UI (Option B).

## Key Files

- API client / fetch wrapper (wherever PATCH calls are made)
- Item edit form / detail page component
- Notification / toast system
