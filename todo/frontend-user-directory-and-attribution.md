# Frontend: Catch Up With Attribution + the User Directory

## Status: DONE (2026-08-17)

Reacts to [User Directory + Attribution Snapshots](backend-user-directory-sync.md),
which shipped 2026-08-13. The backend now persists and serves human names; the
frontend still renders nothing.

**Nothing is broken today.** Every change here is additive — the frontend has no
attribution UI to fix, because there was no name to show. This task is about
consuming what now exists, plus two small type corrections.

## What changed in the backend

| Change | Frontend consequence |
|---|---|
| `createdByName` / `updatedByName` on every item, in Postgres **and** the search index | "Created by Ana" needs **zero** extra requests — read it off the hit |
| Same fields **stripped** for principals below `drafts:manage` / `records:manage` | They must be **optional** in TS; a reader/anonymous response omits them entirely |
| `userName` on every revision | The history timeline can name the actor (see [Statistics + History GUI](frontend-statistics-and-history.md)) |
| `?fields=` is now allowlisted | Unknown names are silently dropped. Nothing sets it today — document it before someone does |
| New `GET /api/users` + `/:id` + `/sync` + `/sync/status` | New API client; picker, filter dropdown, admin sync button |
| `/api/stats/users` rows gained `displayName` | The stats panel no longer has to map UUIDs itself |
| `createdByName` mapped as OpenSearch `keyword` | Sorting and grouping **by creator name** is now possible engine-side |

## Current state of the frontend

Checked 2026-08-13:

- **Nothing renders attribution anywhere.** No component reads `createdByUserId`,
  and there is no "created by" column. Nothing to migrate — only to add.
- **Nothing sets `?fields=`.** `SearchParams.fields` exists on the type
  (`src/api/search.ts:181`) but no call site passes it, so the new allowlist
  cannot break anything today.
- **`auth.roles` already holds the `nbcg-api` client roles**
  (`src/services/keycloak.ts:59`), so the UI can decide locally whether to show an
  attribution column without a new endpoint or a token re-parse.
- **There is no `users` API client** — `src/api/` has only `admin.ts` and
  `search.ts`.
- **There is no stats or history UI yet**, so the `displayName` and `userName`
  additions have no consumer until
  [Statistics + History GUI](frontend-statistics-and-history.md) is built. Noted
  there rather than duplicated here.

## Two type corrections in `src/api/search.ts`

**1. `IndexedRecord` is missing the new fields.** Add them **optional** — the
backend omits them for anyone below the staff bar, so a required field would be a
lie:

```ts
export interface IndexedRecord {
  // …
  createdByUserId: string;
  updatedByUserId: string;
  /** Display-name snapshot. Absent unless the caller holds drafts:manage or records:manage. */
  createdByName?: string;
  updatedByName?: string;
  // …
}
```

**2. `item_relations` does not exist — the field is `parent_relations`.** Latent
bug, verified against a live document: the index has `parent_relations` (the
pgsync node's `label`), and the interface declares
`item_relations: ItemRelationChild[]` as **required**. Nothing reads it yet, so it
has never thrown, but anything that does would get `undefined` from a
non-optional field. Fix it while editing this interface.

## Design notes and traps

### Filter by UUID, display the name

`createdByUserId` is the indexed `keyword` the engine filters on.
`createdByName` is for **display, sorting and aggregation only**. The picker
resolves a person to their `userId` and sends *that*. Filtering by name string
would break the moment someone is renamed — and would miss every item created
before the rename, because the snapshot is frozen on purpose.

### Do not cache the user list in the frontend

`GET /api/users` is a single indexed read against a table that holds one row per
staff member. Fetch it when the picker opens. A frontend-side cache would add a
staleness layer on top of a directory that is already up to one sync interval
behind, and would need its own invalidation for the admin sync button.

### `canPublish` is a hint, not a permission

It may be up to 24h stale. Use it to filter the picker and to grey out an option;
never to decide whether an action is allowed. The backend enforces on the token
and will return a correct `403` regardless. Same rule the backend follows.

### A freshly created item has no name in search yet

`hit.source` is the CDC-lagged copy. Straight after a create, Postgres has the
name and the index does not. This is existing behaviour for every other field, not
something attribution introduces — but a "created by" column that renders blank
for two seconds after a create will look like a bug if nobody expects it.

### Absence is not an error

For a reader or an anonymous visitor the fields are simply not in the response.
Render nothing — not "Unknown", which would imply the data is missing rather than
withheld.

## Changes Needed

### API layer
- [x] `src/api/search.ts` — add optional `createdByName` / `updatedByName` to
      `IndexedRecord`; fix `item_relations` → `parent_relations`. (The element
      shape was wrong too: the index carries `parentId`/`parentType` — one row
      per **parent** — not `childId`/`childType`. Verified against
      `infrastructure/docker/pgsync/schema.json`.)
- [x] `src/api/search.ts` — comment `SearchParams.fields` as allowlisted
      server-side, with unknown names dropped silently.
- [x] New `src/api/users.ts`:
      ```ts
      export interface UserProfile {
        userId: string; username: string; displayName: string;
        canPublish: boolean; isActive: boolean; enabled: boolean;
        deletedAt: string | null;
        /** Staff-only — absent below drafts:manage / records:manage. */
        email?: string | null;
      }
      listUsers(params?: { capability?: 'publish'; active?: boolean; q?: string; limit?: number })
      getUser(userId)
      triggerUserSync()        // POST /users/sync      — users:manage
      getUserSyncStatus()      // GET  /users/sync/status — users:manage
      ```
      `listUsers` returns `{ total, users }`, not a bare array.

### Auth helper
- [x] A `canSeeAttribution` computed off `auth.roles`
      (`drafts:manage` **or** `records:manage`) next to the existing helpers, so
      three call sites do not each re-derive it. It mirrors the backend rule
      exactly; if they ever disagree the backend wins, because it strips the field.

### UI
- [x] "Created by" column in `AdminItemsPage.vue` (columns array around
      `src/pages/admin/AdminItemsPage.vue:220`), shown only when
      `canSeeAttribution`. Renders `createdByName` directly off the hit.
- [x] Creator filter on the admin items list: a user picker fed by
      `GET /api/users`, sending `createdByUserId`. The backend `createdBy`
      param was added as part of this task — see Open questions.
- [x] Admin sync control on `AdminDashboardPage.vue`: a "Refresh user directory"
      button (`POST /api/users/sync`) plus last-run / last-error from
      `GET /api/users/sync/status`. Visible only with `users:manage`. Worth having
      because a sync failing silently for a week is otherwise invisible until the
      picker is mysteriously empty.
- [x] i18n strings in **both** `en-US` and `me` — every new label.

### Follow-on, tracked elsewhere
- [ ] Assignee picker — [Task Delegation](backend-task-delegation.md) frontend
      section. It consumes `GET /api/users?capability=publish`; there is no
      `assignable-users` endpoint and none is coming.
- [ ] Revision timeline showing `userName`, and the stats panel showing
      `displayName` — [Statistics + History GUI](frontend-statistics-and-history.md).

## Open questions

- **Sorting and filtering by creator need backend params that do not exist yet.**
  ~~The index now supports both (`createdByName` is a `keyword`, `createdByUserId`
  already was), but `SearchQueryDto` has no `createdBy` filter and `sort` only
  accepts `relevance | newest`.~~ **Resolved 2026-08-17:** `?createdBy=<userId>`
  was added here (a `term` filter on `createdByUserId` in `SearchQueryDto` +
  `search.service.ts`) because the filter UI is unbuildable without it and the
  change is two lines. `sort=creator` was **not** added — no UI consumes it yet;
  add it with the first consumer.
- **Should the public catalogue ever show a creator?** Currently impossible: the
  backend strips names below the staff bar, so this is an admin-only feature by
  construction. Changing that is a backend policy decision, not a frontend one.

## Key Files

- `frontend/src/api/search.ts:141` — `IndexedRecord`, both type corrections
- `frontend/src/api/search.ts:181` — `SearchParams.fields`, now allowlisted
- `frontend/src/api/users.ts` — **new**
- `frontend/src/services/keycloak.ts:59` — `auth.roles`, the source for `canSeeAttribution`
- `frontend/src/pages/admin/AdminItemsPage.vue:220` — the columns array
- `frontend/src/pages/admin/AdminDashboardPage.vue` — home for the sync control
- `frontend/src/i18n/en-US/` + `frontend/src/i18n/me/` — both locales
- `backend/BACKEND_REFERENCE.md` — "User Directory" and "Attribution" sections describe the contract
