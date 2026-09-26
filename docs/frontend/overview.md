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
build` (vue-tsc type-check) and by hand. `npm run format` runs prettier over the
whole tree; use it on specific files only.

## Structure

| Path | What |
|---|---|
| `src/boot/` | `axios.ts` (instance with `baseURL: '/api'`, bearer token), `keycloak.ts`, `i18n.ts` |
| `src/services/keycloak.ts` | login/refresh; exposes `auth.userId`, `auth.roles` (the API scopes) |
| `src/api/` | one typed client per backend area: `search.ts` (search, suggest, getItem), `admin.ts` (items, files, history, stats, import), `tasks.ts`, `users.ts` — types mirror the backend and the comments explain the contracts |
| `src/composables/useAuthz.ts` | `canManageRecords`, `canManageDrafts`, `canTransition`, `canImport`, `isStaff`, … (UI shaping only) |
| `src/router/routes.ts` | public routes (Montenegrin slugs: `/o-nama`, `/napredna-pretraga`, `/kontakt`, `/uslovi-koriscenja`, `/profil`) and `/admin/*` with `meta.scopes` (AND-only guard) |
| `src/layouts/` | `MainLayout.vue` (public), `AdminLayout.vue` (drawer with task badge) |
| `src/pages/` | `IndexPage`, `CatalogPage`, `AdvancedSearchPage`, `RecordDetailPage`, … |
| `src/pages/admin/` | dashboard, items list (drafts/records), item editor, import, stats, tasks inbox + detail |
| `src/components/admin/` | the item metadata form (`ItemMetadataForm.vue`; inputs and the form model in `form/`), task dialogs/pickers, history timelines, stats widgets, badges |
| `src/i18n/en-US`, `src/i18n/me` | UI strings — **every new label goes into both** |

## Admin area in one paragraph

`/admin/drafts` and `/admin/records` list items from the search index (with an
"open task" badge per row, bulk publish/delete). `/admin/items/:id` is the
editor: a hand-written form over every metadata field the API accepts (~40, in
sections, with COMARC 105/206/207/208 under a collapsible "Advanced"; code lists
from `GET /api/schema/record` — removed 2026-09-26, see below — and clearing a
field sends `null`) plus a
raw-JSON tab, files (upload with OCR text), revision history and the item's task
history; saves use optimistic concurrency (`expectedVersion`, a 409 opens a
compare/resolve flow).
`/admin/tasks` is the inbox; `/admin/tasks/:id` the task with its activity log.
`/admin/stats` shows activity and usage charts. `/admin/import` runs COBISS
imports and polls the job.

## Known issues (2026-09-24)

| Issue | Where | Plan |
|---|---|---|
| **Dropdown code lists are gone**: the editor loaded them from v1 `GET /api/schema/record`, removed on 2026-09-26 (backend B7). It now shows its "code lists failed" notice and offers only in-use values for material type, language and country; record type, bibliographic level, illustration, content type, literary form, biography and author role are empty | `AdminItemEditPage.vue`, `metadataForm.ts` (`codeListsFromSchema`) | [web schema v2 plan F2](plans/metadata-schema-v2.md#f2--quick-win-on-the-current-form-s) — read v2 `vocabularies`, search the big ones |
| No "Summary" (`summaryNote`) field: removed in `cd8e5bd` because the API dropped it on every save | `ItemMetadataForm.vue`, `RecordDetailPage.vue` | the API accepts it since 2026-09-24 (schema v2 B3) — add the field back |
| **Publishing needs fields the form cannot enter; every save is checked.** Backend validation (schema v2: publish since 2026-09-24, every write since 2026-09-25, on dev) requires a material type on drafts, `extent` for books etc. and `issue.number`/`issue.date` for an issue of a serial on records; the form has no `extent` or `issue` input (JSON tab only). Errors come back as `400 METADATA_VALIDATION_FAILED`; the form and bulk publish show only its `message`, not which fields | `ItemMetadataForm.vue`, `AdminItemsPage.vue` | [web schema v2 plan ⚠](plans/metadata-schema-v2.md#-already-affects-the-current-web-app) — must land before the backend reaches production |
| Import page lists `progress.errors` but not the new `progress.warnings` (items imported that would fail the check for their state) | `AdminImportPage.vue` | web schema v2 plan |
| Every field shows for every material type (a book gets ISSN and ISMN, a journal gets ISBN, edition and series) | `ItemMetadataForm.vue` | [material-type field visibility](plans/material-type-field-visibility.md) |
| Open-task badge makes three calls per page (one per active status) | `AdminItemsPage.vue` | [task workflow v2](plans/task-workflow-v2.md) — backend has one open status since 2026-09-25 (dev) |
| Inbox "hide closed" filters client-side, after pagination | `AdminTasksPage.vue` | task workflow v2 — `status` filter is server-side and has three values |
| Unused `pm2` dependency (AGPL) | `package.json` | [license audit](../shared/license-audit.md) — remove |
| Quasar starter leftovers (`EssentialLink.vue`, `ExampleComponent.vue`, `stores/example-store.ts`, `models.ts`) | `src/` | delete when convenient |

## Plans

- [Schema-driven metadata editor](plans/metadata-schema-v2.md)
- [Material-type field visibility](plans/material-type-field-visibility.md): static map now, schema v2 rules later
- [Task workflow v2](plans/task-workflow-v2.md)
- [Collection view types](plans/collection-views.md) — needs input
- [Admin nice-to-have list](plans/admin-nice-to-have.md) — yes/no per item
- Done: [task delegation UI](history/task-delegation.md)
