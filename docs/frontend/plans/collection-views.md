# Frontend: Collection View Types

## Status: PLANNING — needs user input

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

## Open Questions (ask user)

- [ ] Confirm which `collectionType` numbers map to which collection kind (1, 3, 4, 5, ... — are 2 and others used?)
- [ ] What metadata fields should each type display? (title, subtitle, authors, publication info, notes, ...?)
- [ ] Type 1 (primary): should children be browsable at all, or just a count?
- [ ] Type 3 (standard): which child metadata to show in the list (title, thumbnail, description, date, authors)?
- [ ] Type 4 (serial): date selector UX — calendar view, timeline, year/month drill-down?
- [ ] Type 5+: what are these types and how should they look?
- [ ] Should `collectionType` be editable by the user, or system-assigned?
- [ ] Any shared UI elements across all types (breadcrumbs, edit button, visibility badge)?

## Tasks

- [ ] Finalize type mapping with user
- [ ] Design/wireframe each view variant
- [ ] Implement collection detail page with type-based rendering
- [ ] Implement child list component (paginated, with images) for type 3
- [ ] Implement date selector component for type 4
- [ ] Add routing: collection detail page loads correct view based on `collectionType`

## Related

- Backend metadata type: `collectionType` field in `BaseMetadata`
- Depends on: backend providing `collectionType` in API responses (already present)
