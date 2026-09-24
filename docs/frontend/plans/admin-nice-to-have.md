# Frontend: Admin nice-to-have improvements

## Status: DECISION PENDING — each item below needs a yes/no before it goes into the admin redesign

## Summary

While designing the admin redesign (canvas: https://claude.ai/artifact/291iYMzbyaTpu1oGcP6gEF, 2026-09-22) a set of
small workflow improvements for editors and cataloguers came up. None of them is part of the redesign yet.
Each one is a separate decision: tick it once it is accepted, strike it once it is rejected. Accepted items get
added to the design canvas first, then implemented together with the redesign.

Section A needs no backend change: every item works on data the API already returns.
Section B needs a backend endpoint or field first.

## A. Frontend only (data already available)

- [ ] **A1 Unsaved-changes guard in the item editor** — leaving `/admin/items/:id` with a dirty form opens a "Save / Discard / Stay" dialog (`onBeforeRouteLeave` + `beforeunload`). Recommended.
- [ ] **A2 Publish / Return to draft inside the editor** — a transition button in the Status side card, so the user does not go back to the list. Publishing auto-closes REVIEW_PUBLISH tasks, so the Open task card must refetch after the transition. Recommended.
- [ ] **A3 "Continue where you left off" on the dashboard** — the 5 items the signed-in user last edited (search with creator filter = me, sorted by `updatedAt` desc). Check first that the search endpoint accepts that sort. Recommended.
- [ ] **A4 Review queue card for publishers** — "Waiting for review": open REVIEW_PUBLISH tasks regardless of assignee (`listTasks` with status OPEN/IN_PROGRESS, filtered by kind client-side), shown only to users with `records:manage`. Recommended.
- [ ] **A5 Relative times in lists** ("2 h ago") with the full timestamp in a tooltip. Applies to items, tasks inbox, dashboard, task activity.
- [ ] **A6 Filters persisted in the URL** — `?q=&creator=&page=` on items, `?status=&hideClosed=` on the inbox (today only `?scope=` is persisted). Coming back from a detail page restores the same list and page. Recommended.
- [ ] **A7 Keyboard shortcuts** — `/` focuses the list search, `n` opens "New item", `Ctrl+S` saves the editor. `Ctrl+Enter` for comments already exists.
- [ ] **A8 "Open task" marker is a link** — clicking the amber marker in the items table opens the item directly on its Tasks tab (`?tab=tasks`).
- [ ] **A9 Assign task to several selected items** — an "Assign task" entry in the bulk-actions bar; one `POST /tasks` per selected item with the same kind, title and assignee (max 200 rows, so at most 200 calls; show progress). Useful right after an import. Recommended.
- [ ] **A10 Empty states with a call to action** — "Nothing is waiting on you" gets a "Drafts without a task" link; "No items found" gets "New item" / "Run import" buttons.
- [ ] **A11 Task count in the browser tab title** — "(4) Administration" while there are open tasks assigned to me; reuses the drawer badge count.
- [ ] **A12 Statistics: compare with the previous period** — a second `stats` request for the preceding range; each tile shows the delta as an arrow and percentage.

## B. Needs backend work first

- [ ] **B1 Global activity feed on the dashboard** — "Ana published X 10 minutes ago". Item history exists only per item today; needs something like `GET /items/history?limit=20` (cross-item, newest first, same row shape as the per-item log).
- [ ] **B2 Stale drafts** — "Drafts older than 30 days without an open task". Needs a date filter on the search endpoint (or a dedicated endpoint) plus the existing `itemIds` task lookup.
- [ ] **B3 Due date when creating a task** — the task detail page already renders `dueDate`; verify whether `POST /tasks` / `PATCH /tasks/:id` accept it. If they do, this moves to section A (date picker in CreateTaskDialog and the detail page).
- [ ] **B4 Notifications** — at minimum "a new task was assigned to you" on login; e-mail later. Needs a backend notification store or an unread marker on tasks.

## Decisions log

| Item | Decision | Date | Note |
|------|----------|------|------|
| — | — | — | fill in as each item is accepted or rejected |

## Notes

- **Task workflow v2 (planned 2026-09-23) changes A2, A4, A9** — see
  [task-workflow-v2.md](task-workflow-v2.md#nice-to-have-list): A4 becomes a
  server-side `status=OPEN&kind=REVIEW_PUBLISH` query (IN_PROGRESS is gone), A9
  must handle a per-item `409 ITEM_HAS_OPEN_TASK`, A2 shares the publish-error
  dialog with metadata schema v2.

- The recommendation in the chat (2026-09-22) was A1, A2, A3, A4, A6 and A9; everything else is optional polish.
- Every new label needs both locales (`src/i18n/en-US`, `src/i18n/me`).
- Accepted items are added to the redesign canvas before implementation so the layout is settled once.
