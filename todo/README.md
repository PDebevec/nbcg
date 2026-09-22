# TODO Tasks

## Frontend

- [Collection View Types](frontend-collection-views.md) — type-based collection rendering (PLANNING)
- [Attribution + User Directory catch-up](frontend-user-directory-and-attribution.md) — `createdByName` off the row, `users.ts` API client, creator filter and admin sync button; two type fixes in `search.ts` (**DONE** 2026-08-17)
- [Task Delegation](frontend-task-delegation.md) — "Assign task" dialog (kind → capability-aware searchable picker), a "My tasks" inbox, task detail rendering the append-only log, return-with-notes in one atomic PATCH, an open-task badge from `?itemIds=`, an item task-history tab, and a "waiting on me" card on the dashboard (**DONE** 2026-09-22)

## Backend

- [User Directory + Attribution Snapshots](backend-user-directory-sync.md) — `createdByName`/`updatedByName` snapshot columns for instant display, plus a `user_profiles` shadow of the Keycloak realm (daily + manual Admin API sync) for pickers, filters and delegation (**DONE** 2026-08-13)
- [`tasks` + `task_history` rewrite](backend-task-history-rewrite.md) — replaced `work_tasks`/`task_comments` with a current-state table plus an append-only audit log, following the `item_revisions` pattern. A comment is now one action in the log, not its own object. The payoff: history **survives item deletion**. Also adds `returnTo` (the "return with notes" prefill) and `GET /tasks/item/:itemId/history` (**DONE** 2026-08-16)
- [Task Delegation — implementation plan](backend-task-delegation-plan.md) — a `TaskKind` enum with `(kind, status)` assignee guards, 5 endpoints, an observer in `transition()` that closes review tasks however the publish happened, §18 of the API suite. Also locked `/api/users` to staff only, which deleted the conditional-email branch. **Storage model superseded** by the rewrite above; everything else still authoritative (**DONE** 2026-08-16)
- [Task Delegation](backend-task-delegation.md) — background: why the feature exists, the two Keycloak traps, the terminology inversion (**DONE** 2026-08-16)
- **Usage metrics outlive their items** — `item_metrics_daily`/`file_metrics_daily` rows are never deleted when an item is, so `GET /api/stats/items/top` returns deleted items with `title: null, itemType: null`. Verified live: 5 of 5 `mostViewed` entries were deleted test items. User-visible on any "most viewed" dashboard, and it makes the §14 top-items test flaky as ghosts accumulate. Decide: delete metrics with the item, or filter them out of the stats read (TODO)
- [Material-Type-Based Field Visibility](backend-archive-material-type-field-visibility.md) — annotate schema fields with `relevantForTypes` + pre-computed `typeProfiles` per material type (TODO)
- [Move `user_profiles` out of `public`](backend-postgres-schema-split.md) — **deferred, not rejected.** A Postgres schema only earns its keep as a grant boundary, and no role needs one yet; `ALTER TABLE … SET SCHEMA` costs the same later. Trigger: a database connection that must not see staff names and emails (DEFERRED)

## Backend — Archive (desktop app) integration

- [Synchronous COBISS Preview](backend-archive-cobiss-preview.md) — backend done; archive still needs to wire "Get data" to the preview endpoint (frontend TODO)
