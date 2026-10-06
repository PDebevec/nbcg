# Frontend: Collection View Types

## Status: PROTOTYPE BUILT — design and per-type views need user input

## Summary

The `collectionType` field on record/draft metadata controls how the frontend renders each collection. Each type gets a distinct layout and shows different metadata/children.

## Proposed Type Mapping (DRAFT — confirm with user)

| collectionType | Name | View Description |
|----------------|------|------------------|
| 0 | Not a collection | No collection UI — show full metadata detail view |
| 1 | Primary collection | Prominent placement on main screen. Opens to show: name, children count. Minimal chrome. |
| 3 | Standard collection | Name, children count, description, selected metadata. Bottom section: paginated child list with images, names, descriptions. |
| 4 | Serial / Periodical | Name, description, selected metadata. Bottom section: date-based selector showing publication dates of children. |
| 5 | ??? | TBD |

## Prototype (2026-10-06)

A plain Quasar version to design from later — one layout for every collection type.

- **Public** — `/catalog/:id` (`RecordDetailPage.vue`): when `collectionType > 0` the record layout (viewer,
  metadata cards, sidebar, siblings) is replaced by the title block, an "About this collection" card
  (`summaryNote` + responsibility, publisher, year, numbering, language, ISSN) and the child list. No separate
  contents route.
- **Child list** — `components/collection/CollectionChildrenList.vue`: `GET /search/:id/children`, 20 per page,
  `q-list` rows (cover or material icon, title + issue number, creator · date), `q-pagination`. Props `parentId`,
  `type` (`records`/`drafts`), `linkPrefix`, `sort`. Type 4 sorts by `sort=issueDate` (backend, oldest
  `metadata.issue.date` first, undated last); other types use the engine order.
- **Admin** — editor tab **Contents** (`AdminItemEditPage.vue`), shown when the *saved* `collectionType > 0`:
  Records / Drafts toggle with the counters, the same list linking to `/admin/items/:id`, and **Add items**
  (`components/admin/AddChildrenDialog.vue`): search drafts + records, pick, `POST /relations/connect`
  (`connectChildren` in `api/admin.ts`). A refusal opens `ValidationErrorDialog` with action `link`. After a connect
  the editor takes over the parent's new `version` and counters, so the next save does not 409.

Known gaps of the prototype:

- No way to remove a child (`POST /relations/disconnect`) from the UI.
- A sub-collection no longer shows its parent on the public page (the "Part of" card lived in the record sidebar).
- Children must pass the record check with their new parent; most COBISS-imported books currently fail on a missing
  `extent`, so they cannot be added until that is filled in.
- The list reloads 1.5 s after a connect to let pgsync catch up; it is not guaranteed to show the new children yet.
- Local dev: pgsync did not index `parent_relations` for any document until it was force-recreated (full resync).
  If new links do not show up again, check the incremental sync of `item_relations`.

## Open Questions (ask user)

- [ ] Confirm which `collectionType` numbers map to which collection kind (1, 3, 4, 5, ... — are 2 and others used?)
- [ ] What metadata fields should each type display? (prototype: summary, responsibility, publisher, year, numbering, language, ISSN)
- [ ] Type 1 (primary): should children be browsable at all, or just a count? Where on the home page?
- [ ] Type 3 (standard): which child metadata to show in the list (title, thumbnail, description, date, authors)?
- [ ] Type 4 (serial): date selector UX — calendar view, timeline, year/month drill-down?
- [ ] Type 5+: what are these types and how should they look?
- [ ] Should `collectionType` be editable by the user, or system-assigned?
- [ ] Any shared UI elements across all types (breadcrumbs, edit button, visibility badge)?
- [ ] Should a sub-collection show its parent collection, and where?

## Tasks

- [ ] Finalize type mapping with user
- [ ] Design/wireframe each view variant
- [x] Collection detail page with type-based rendering — prototype: one layout for all types on `/catalog/:id`
- [x] Child list component (paginated, with images) — prototype `CollectionChildrenList.vue`
- [x] Admin: Contents tab with the child list and "Add items" (`relations/connect`)
- [x] Backend: `sort=issueDate` for the children of a serial
- [ ] Admin: remove a child from the collection (`relations/disconnect`)
- [ ] Public: "Part of" link for a sub-collection
- [ ] Date selector component for type 4
- [ ] Type 1: placement on the home page
- [ ] Final design of each view (replace the prototype layout)

## Related

- Backend metadata type: `collectionType` field in `BaseMetadata`
- Depends on: backend providing `collectionType` in API responses (already present)
- Children endpoint and relations: [backend reference](../../backend/reference.md) (`GET /search/:id/children`, `POST /relations/connect`)
