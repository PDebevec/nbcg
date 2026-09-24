# Frontend: Admin nice-to-have improvements

## Status: DECIDED 2026-09-24 — accepted: A1, A2, A3b, A4, A5, A6, A8, A9 (on the canvas since 2026-09-24, implemented with the redesign); rejected: A7, A10, A11; deferred: A12, A3a, B1–B4

## Summary

While designing the admin redesign (canvas: https://claude.ai/artifact/291iYMzbyaTpu1oGcP6gEF, 2026-09-22) a set of
small workflow improvements for editors and cataloguers came up. None of them is part of the redesign yet.
Each one is a separate decision: tick it once it is accepted, strike it once it is rejected. Accepted items get
added to the design canvas first, then implemented together with the redesign.

Section A needs no backend change: every item works on data the API already returns.
Section B needs a backend endpoint or field first.

## A. Frontend only (data already available)

- [x] **A1 Unsaved-changes guard in the item editor** — leaving `/admin/items/:id` with a dirty form opens a "Save / Discard / Stay" dialog (`onBeforeRouteLeave` + `beforeunload`). Recommended.
- [x] **A2 Publish / Return to draft inside the editor** — a transition button in the Status side card, so the user does not go back to the list. Publishing auto-closes REVIEW_PUBLISH tasks, so the Open task card must refetch after the transition. Recommended.
- [x] **A3b "Recently opened" on the dashboard** — the last 5 items the signed-in user opened in the editor. The editor page writes `{id, title, itemType, openedAt}` to `localStorage` (key per user id, max 10) on load; the dashboard shows the newest 5 with a relative time. Frontend only; the list is per browser. Chosen 2026-09-24 over A3a, which moved to section B as B5.
  - Background: "last edited by me" is not supported by the current backend. `GET /search` sorts only by `relevance` or `newest` (= `createdAt desc`, `search-query.dto.ts` / `search.service.ts:606`) and filters on `createdBy` only; `updatedByUserId` is indexed but has no query filter.
- [x] **A4 Review queue card for publishers** — "Waiting for review": open REVIEW_PUBLISH tasks regardless of assignee (`listTasks` with status OPEN/IN_PROGRESS, filtered by kind client-side), shown only to users with `records:manage`. Recommended.
- [x] **A5 Relative times in lists** ("2 h ago") with the full timestamp in a tooltip. Applies to items, tasks inbox, dashboard, task activity.
- [x] **A6 Filters persisted in the URL** — `?q=&creator=&page=` on items, `?status=&hideClosed=` on the inbox (today only `?scope=` is persisted). Coming back from a detail page restores the same list and page. Recommended.
- ~~**A7 Keyboard shortcuts** — `/` focuses the list search, `n` opens "New item", `Ctrl+S` saves the editor. `Ctrl+Enter` for comments already exists.~~ Rejected 2026-09-24.
- [x] **A8 "Open task" marker is a link** — clicking the amber marker in the items table opens the item directly on its Tasks tab (`?tab=tasks`).
- [x] **A9 Assign task to several selected items** — an "Assign task" entry in the bulk-actions bar; one `POST /tasks` per selected item with the same kind, title and assignee (max 200 rows, so at most 200 calls; show progress). Useful right after an import. Recommended.
- ~~**A10 Empty states with a call to action** — "Nothing is waiting on you" gets a "Drafts without a task" link; "No items found" gets "New item" / "Run import" buttons.~~ Rejected 2026-09-24 (not needed).
- ~~**A11 Task count in the browser tab title** — "(4) Administration" while there are open tasks assigned to me; reuses the drawer badge count.~~ Rejected 2026-09-24.
- [ ] **A12 Statistics: compare with the previous period** — a second `stats` request for the preceding range; each tile shows the delta as an arrow and percentage. **Deferred 2026-09-24**: not in this round, revisit after the redesign ships.

## B. Needs backend work first

**All of section B is deferred (2026-09-24)**: nothing here is part of the redesign round. Revisit once the redesign and task workflow v2 are done.

- [ ] **B1 Global activity feed on the dashboard** — "Ana published X 10 minutes ago". Item history exists only per item today; needs something like `GET /items/history?limit=20` (cross-item, newest first, same row shape as the per-item log).
- [ ] **B2 Stale drafts** — "Drafts older than 30 days without an open task". Needs a date filter on the search endpoint (or a dedicated endpoint) plus the existing `itemIds` task lookup.
- [ ] **B3 Due date when creating a task** — the task detail page already renders `dueDate`; verify whether `POST /tasks` / `PATCH /tasks/:id` accept it. If they do, this moves to section A (date picker in CreateTaskDialog and the detail page).
- [ ] **B4 Notifications** — at minimum "a new task was assigned to you" on login; e-mail later. Needs a backend notification store or an unread marker on tasks.
- [ ] **B5 "Last edited by me" (was A3a)** — `sort=updated` (`updatedAt desc`) and an `updatedBy` filter on `GET /search` (DTO + service). Replaces the localStorage list of A3b with a server-side one that follows the user across browsers. Deferred with the rest of section B.

## Decisions log

| Item | Decision | Date | Note |
|------|----------|------|------|
| A1 | accepted | 2026-09-24 | unsaved-changes guard |
| A2 | accepted | 2026-09-24 | publish / return to draft in the editor's Status card; saves first when dirty |
| A3 | accepted as A3b | 2026-09-24 | localStorage "Recently opened" now; A3a (server-side sort + filter) deferred as B5 |
| A4 | accepted | 2026-09-24 | review queue card, `records:manage` only |
| A5 | accepted | 2026-09-24 | relative times + full timestamp tooltip |
| A6 | accepted | 2026-09-24 | list filters in the URL |
| A7 | rejected | 2026-09-24 | no keyboard shortcuts |
| A8 | accepted | 2026-09-24 | open-task marker links to the Tasks tab |
| A9 | accepted | 2026-09-24 | bulk "Assign task" |
| A10 | rejected | 2026-09-24 | not needed |
| A11 | rejected | 2026-09-24 | — |
| A12 | deferred | 2026-09-24 | later, after the redesign |
| B1–B5 | deferred | 2026-09-24 | whole section, after the redesign |

## Notes

- **Task workflow v2 (planned 2026-09-23) changes A2, A4, A9** — see
  [task-workflow-v2.md](task-workflow-v2.md#nice-to-have-list): A4 becomes a
  server-side `status=OPEN&kind=REVIEW_PUBLISH` query (IN_PROGRESS is gone), A9
  must handle a per-item `409 ITEM_HAS_OPEN_TASK`, A2 shares the publish-error
  dialog with metadata schema v2.

- The recommendation in the chat (2026-09-22) was A1, A2, A3, A4, A6 and A9; everything else is optional polish.
- Every new label needs both locales (`src/i18n/en-US`, `src/i18n/me`).
- Accepted items are added to the redesign canvas before implementation so the layout is settled once.
- Where the accepted items are on the canvas (added 2026-09-24): A1 → "Unsaved changes" dialog board (row with the editor tabs); A2 → the Status side card on the editor boards ("Return to draft" / "Publish as record", with the saves-first hint); A3b → "Recently opened" card and A4 → "Waiting for review" card on the Dashboard board; A5 → the Updated columns on Records and Tasks show relative times, full timestamp in the tooltip; A6 → nothing visual (URL only); A8 → the amber "Open task" marker on Records is a link to the item's Tasks tab; A9 → "Assign task" in the bulk-actions bar on Records plus the "Assign task to 3 items" dialog board.
