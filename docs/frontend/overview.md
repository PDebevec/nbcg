# Frontend overview

Vue 3 + Quasar 2 (Vite) SPA in `frontend/`: the public catalogue and the
`/admin` staff area.

## Run / build

```bash
cd frontend
npm install              # runs `quasar prepare`
npm run dev              # quasar dev; proxies /api → http://localhost:3000
npm run build            # quasar build → dist/spa (served by nginx in prod)
```

Keycloak config comes from `frontend/.env` (`VITE_KEYCLOAK_URL`,
`VITE_KEYCLOAK_REALM`, `VITE_KEYCLOAK_CLIENT_ID`, `VITE_KEYCLOAK_API_CLIENT_ID`,
optional `VITE_KEYCLOAK_BASE_PATH`, default `/auth` behind nginx). The prod
image is built per environment — see
[infrastructure-cli.md](../infrastructure/infrastructure-cli.md#the-frontend-image-is-environment-specific).

There is **no test runner** (`npm test` is a no-op) — verify with `npm run
build` (vue-tsc type-check), `npx vue-tsc --noEmit`, `npm run lint` and by
hand. `npm run format` runs prettier over the whole tree; use it on specific
files only.

## Structure

| Path | What |
|---|---|
| `src/boot/` | `axios.ts` (instance with `baseURL: '/api'`, bearer token), `keycloak.ts`, `i18n.ts` |
| `src/services/keycloak.ts` | login/refresh; exposes `auth.userId`, `auth.roles` (the API scopes) |
| `src/api/` | one typed client per backend area: `search.ts` (search, suggest, getItem), `admin.ts` (items, validation dry run, files, history, stats, import), `tasks.ts` (task workflow v2), `users.ts`, `schema.ts` (metadata schema v2, vocabulary search), `errors.ts` (`apiErrorMessage`, `validationFailure`, `openTaskConflict`) — types mirror the backend and the comments explain the contracts |
| `src/utils/schemaRules.ts` | **verbatim copy** of `backend/src/modules/schema/rules/evaluate.ts` (a backend test fails if the two differ — change it there, then copy) |
| `src/composables/` | `useAuthz.ts` (`canManageRecords`, `canTransition`, `isStaff`, … — UI shaping only), `useSchemaForm.ts` (evaluated field states + save / publish check), `useItemSummary.ts` (one item's title for a task view) |
| `src/stores/` | `schema-store.ts` (schema v2, loaded once per session), `task-count-store.ts` (the drawer's open-task count) |
| `src/router/routes.ts` | public routes (Montenegrin slugs: `/o-nama`, `/napredna-pretraga`, `/kontakt`, `/uslovi-koriscenja`, `/profil`) and `/admin/*` with `meta.scopes` (AND-only guard) |
| `src/layouts/` | `MainLayout.vue` (public), `AdminLayout.vue` (navy drawer, no top bar) |
| `src/pages/` | `IndexPage`, `CatalogPage`, `AdvancedSearchPage`, `RecordDetailPage`, … |
| `src/pages/admin/` | dashboard, items list (drafts/records), item editor, import, stats, tasks inbox + detail |
| `src/components/admin/` | shared pieces (`AdminPageHeader`, `FormField`, badges, `UserAvatar`, `RelativeTime`, dialogs); `editor/` (the sectioned item form), `form/` (inputs, the form model, the field table), `tasks/` (detail pane, action dialogs) |
| `src/css/admin.sass` | the admin look, scoped under `body.admin-body` (dialogs and menus are teleported to `<body>`) |
| `src/i18n/en-US`, `src/i18n/me` | UI strings — **every new label goes into both**; the `admin` namespace is split into `admin/*.ts`, one file per page. Field captions of the item editor are not here: they come from the metadata schema (`en` / `cnr`) |

## Admin area

Redesigned 2026-09-30 after the design canvas
(https://claude.ai/artifact/291iYMzbyaTpu1oGcP6gEF): warm paper ground, navy
drawer with grouped navigation and the open-task count, no top bar — every page
starts with `AdminPageHeader` (eyebrow, serif title, caption, actions). Source
Sans 3 / Source Serif 4 are used inside the admin only; the public site keeps
Inter. Icons are the outlined Material set (`o_*`).

- **Dashboard** (`/admin`): KPI tiles, "Waiting on me", "Waiting for review"
  (publishers only), "Recently opened" (this browser, `localStorage`), catalogue
  at a glance, user-directory sync.
- **Drafts / Records** (`/admin/drafts`, `/admin/records`): a filter rail
  (material type, collection type, created by me, year — all in the URL) and a
  slim table from the search index; an "Open task" marker links to the item's
  Tasks tab; bulk actions float at the bottom (assign task, visibility,
  publish / return to draft, delete). A refused publish opens
  `ValidationErrorDialog`.
- **Item editor** (`/admin/items/:id`, `/admin/items/new?type=`): material type
  first, then one card per section. The form is hand-laid-out
  (`editor/ItemMetadataForm.vue`, field table in `form/fields.ts`); the
  **metadata schema v2** decides per item what is visible / required and what it
  is called, and the copied evaluator says before any request whether a save or
  a publish would be refused. A field the schema hides for this item moves to
  "Other fields" and stays fillable. A draft needs a title and a material type;
  a record must stay complete (Save is off while a required field is empty).
  Tabs: JSON, files (upload with OCR text state), revision history, the item's
  task history. Status card: publish / return to draft. Saves use optimistic
  concurrency (`expectedVersion`; a 409 is merged when the two sides touched
  different fields). Leaving with unsaved changes asks first.
- **Tasks** (`/admin/tasks`, `/admin/tasks/:id`): task workflow v2 — a task is
  Open, Completed or Cancelled and its kind is the stage it is in. The inbox
  filters server-side (scope, stage, status, returned) and opens a task in a
  pane next to the list (`?task=`). Actions: Complete (by stage: finish, hand
  on, or publish), Return, Reassign, Cancel — one dialog each.
- **Statistics** (`/admin/stats`) and **COBISS import** (`/admin/import`, with
  the warnings of a finished job).

## Known issues (2026-10-01)

| Issue | Where | Plan |
|---|---|---|
| **Records imported from COBISS mostly fail the record check** — the import fills the extent statement ("168 str.") but not the numeric `extent`, which the schema requires on a record for books, video and sound; the editor then says "This record cannot be saved yet: Number of pages" and Save stays off until it is typed in. Every one of the 11 dev records is affected | `AdminItemEditPage.vue` (correct behaviour), backend import | backend: parse the number out of the extent statement on import, or make `extent` publish-only for imported records |
| A headless-Chrome pass on 2026-10-01 clicked through every admin page, the four task dialogs along the whole stage chain, both languages and a 1100 px viewport; what it did not cover: file upload, the JSON tab round-trip, the 409 merge, bulk actions on many rows, and the import itself | `src/pages/admin`, `src/components/admin` | manual: [task workflow v2 test script](plans/task-workflow-v2.md#manual-test-script-no-frontend-test-runner-exists) |
| Task lists show the task title and the item's type, not the item's title: a task carries only `itemId` / `itemType`, and `GET /search/:id` counts an item view, so it is not called per row | `AdminTasksPage.vue`, `AdminDashboardPage.vue` | backend: item title (and material type) on task views, or an `ids` filter on `/api/search` |
| Records / drafts list has no "Visibility" and "Has an open task" filter and no sort on "Updated" — the API has no such filter or sort | `AdminItemsPage.vue` | [search filters](plans/search-filters.md) |
| Import warnings name the COBISS id only, so they do not link to the item | `AdminImportPage.vue` | backend: item id in `progress.warnings` |
| A numeric extent cannot be entered for a material type the schema gives no unit (electronic resources, 3-D objects …) | `editor/MetaField.vue` | a rule change in `record-fields.ts`, if wanted |
| **Home-page category tiles open an empty catalog**: they filter by `Monograph`, `Serial publication`, `Map`… — not material type labels (found 2026-09-29) | `IndexPage.vue` | [search filters W2](plans/search-filters.md#w2--home-page-category-tiles-match-nothing-s--bug-verified-2026-09-29) |
| A search the backend rejects (400, e.g. a bad year in the URL) leaves the old results on screen with no message | `CatalogPage.vue` (`fetchItems` has no `catch`) | [search filters W8](plans/search-filters.md#w8--a-rejected-filter-xs) |
| No "Summary" (`summaryNote`) on the public record page | `RecordDetailPage.vue` | [web schema v2 plan F6](plans/metadata-schema-v2.md) |
| Unused `pm2` dependency (AGPL) | `package.json` | [license audit](../shared/license-audit.md) — remove |
| Quasar starter leftovers (`EssentialLink.vue`, `ExampleComponent.vue`, `stores/example-store.ts`, `models.ts`) | `src/` | delete when convenient |

## Plans

- [Schema-driven metadata editor](plans/metadata-schema-v2.md) — F1, F2, F4, F5 built 2026-09-30
- [Task workflow v2](plans/task-workflow-v2.md) — built 2026-09-30
- [Search filters](plans/search-filters.md) — admin list built, public site open
- [Admin nice-to-have list](plans/admin-nice-to-have.md) — accepted items built 2026-09-30
- [Collection view types](plans/collection-views.md) — needs input
- [Material-type field visibility](plans/material-type-field-visibility.md) — superseded by schema v2
- Done: [task delegation UI](history/task-delegation.md)
