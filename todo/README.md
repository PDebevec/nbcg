# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)
- [Change History + Statistics GUI](frontend-statistics-and-history.md) — item revision timeline + admin statistics screens; backend and endpoints done, GUI design open (TODO)

## Backend

- [User Directory + Attribution Snapshots](backend-user-directory-sync.md) — `createdByName`/`updatedByName` snapshot columns for instant display, plus a `user_profiles` shadow of the Keycloak realm (daily + manual Admin API sync) for pickers, filters and delegation (TODO)
- [Task Delegation](backend-task-delegation.md) — assign review/publish work between users; new `WorkTask`/`TaskComment` tables, consuming the user directory above (TODO)
- [Material-Type-Based Field Visibility](backend-archive-material-type-field-visibility.md) — annotate schema fields with `relevantForTypes` + pre-computed `typeProfiles` per material type (TODO)

## Backend — Archive (desktop app) integration

- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — backend done; archive still needs to wire "Get data" to the preview endpoint (frontend TODO)
