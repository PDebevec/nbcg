# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)
- [Change History + Statistics GUI](frontend-statistics-and-history.md) — item revision timeline + admin statistics screens; backend and endpoints done, GUI design open (TODO)
- [Attribution + User Directory catch-up](frontend-user-directory-and-attribution.md) — render `createdByName` off the row, add a `users.ts` API client, creator filter and admin sync button; two type fixes in `search.ts` (TODO)

## Backend

- [User Directory + Attribution Snapshots](backend-user-directory-sync.md) — `createdByName`/`updatedByName` snapshot columns for instant display, plus a `user_profiles` shadow of the Keycloak realm (daily + manual Admin API sync) for pickers, filters and delegation (**DONE** 2026-08-13)
- [Task Delegation](backend-task-delegation.md) — assign review/publish work between users; new `WorkTask`/`TaskComment` tables. Its prerequisite (the user directory above) is now built, so what remains is the task model itself (TODO)
- [Material-Type-Based Field Visibility](backend-archive-material-type-field-visibility.md) — annotate schema fields with `relevantForTypes` + pre-computed `typeProfiles` per material type (TODO)
- [Move `user_profiles` to a `directory` Schema](backend-postgres-schema-split.md) — the staff directory is the only table with no item linkage; move it out of `public` and leave everything item-keyed where it is (PLANNING)

## Backend — Archive (desktop app) integration

- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — backend done; archive still needs to wire "Get data" to the preview endpoint (frontend TODO)
