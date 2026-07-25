# Backend + Frontend: Material-Type-Based Field Visibility

## Status: TODO

## Why we need it

Different material types (book, map, music, etc.) need different metadata fields.
A map needs scale/projection (`cartographicMathematicalData`), music needs
`musicEditionStatement`, books need `textualMaterialCodes`, etc. Showing all
fields equally overwhelms the form. We want the schema endpoint to tell clients
which fields are relevant for which material type, so forms show only what
matters and collapse the rest.

**The user can still fill in any field** — this is a UI visibility hint, not a
validation constraint.

## Current State

- The schema endpoint (`GET /api/schema/record`) already returns
  `FieldDescriptor[]` with groups, types, levels, allowed values, etc.
- `materialType` is already stored on every record — a two-character code
  combining `recordType` (001/b) + `bibliographicLevel` (001/c), e.g.
  `"am"` = Book, `"em"` = Printed map, `"cm"` = Printed music.
- No mechanism currently exists to indicate which fields are relevant for
  which material type.

## Design

### The "Type Teller" Field

Use the existing **`materialType`** field. No new field needed. Code categories:

| Category | Codes | Examples |
|---|---|---|
| Text | `am, as, aa, ai` | Book, Journal, Article |
| Music | `cm, cs, dm, jm, js` | Printed music, Music manuscript, Musical sound recording |
| Cartographic | `em, es, fm` | Printed map, Map serial, Manuscript map |
| Visual | `gm, gs, km` | Video/Film, Graphic |
| Sound | `im, is` | Non-musical sound recording |
| Electronic | `lm, ls, li` | Electronic resource, Website/Database |
| Other | `mm, rm, ud, ac, mc` | Multimedia, 3D object, Performed work, Collections |

### New Property on FieldDescriptor

```typescript
relevantForTypes?: string[];  // material type codes, e.g. ["am","as","aa","ai"]
                               // omit (undefined) = universal, shown for all types
```

Only ~6-8 fields out of ~35 need annotation. Everything else is universal:

| Field | Relevant for | Why |
|---|---|---|
| `textualMaterialCodes` | `a*` (am, as, aa, ai, ac) | COMARC 105 — text-only |
| `cartographicMathematicalData` | `e*, f*` (em, es, fm) | COMARC 206 — maps |
| `musicEditionStatement` | `c*, d*, j*` (cm, cs, dm, jm, js) | COMARC 208 — music |
| `isbn` | non-serial monographs | ISBN for standalone items |
| `issn` | serials (`*s`) | ISSN for serials |
| `ismn` | music (cm, cs, dm) | ISMN for printed music |
| `numberingAndDates` | serials + integrating (*s, *i) | COMARC 207 — serial numbering |

### Pre-computed Type Profiles in the Response

In addition to `relevantForTypes` on each field, the schema response includes a
**`typeProfiles`** map — a complete, pre-computed lookup so the archive app
needs **zero client-side filtering logic and zero additional API calls**.

```jsonc
{
  "fields": [ /* FieldDescriptor[] as before */ ],
  "typeProfiles": {
    "am": {
      "label": { "code": "am", "en": "Book", "cnr": "Knjiga" },
      "primaryFields": ["title", "collectionType", "cobissId", "recordType", "isbn", "language", "authors", "edition", "publication", ...]
    },
    "em": {
      "label": { "code": "em", "en": "Printed map", "cnr": "Štampana karta" },
      "primaryFields": ["title", "collectionType", "cobissId", "recordType", "cartographicMathematicalData", "language", "publication", ...]
    },
    // ... one entry per material type code
  }
}
```

**How the archive app uses it:**
1. Fetch schema once on startup → gets `fields` + `typeProfiles`.
2. User picks a material type (or COBISS import sets it) → look up
   `typeProfiles["am"].primaryFields` → instantly know which fields to show.
3. All other field keys not in `primaryFields` → collapse into "Additional
   fields" section (still fillable).
4. The full `fields` array has the type/allowedValues/objectShape needed to
   render each field — the app just needs to match by `key`.

**How the backend builds it:** For each material type code, iterate `fields`
and collect keys where `relevantForTypes` is absent (universal) or includes
that code. This is derived — single source of truth, no hand-maintenance.

### Frontend Filtering Logic (if not using typeProfiles)

```typescript
function getFieldVisibility(field, materialType) {
  if (!materialType) return 'primary';           // no type selected → show all
  if (!field.relevantForTypes) return 'primary';  // universal field
  return field.relevantForTypes.includes(materialType) ? 'primary' : 'secondary';
}
```

"Secondary" fields collapse into an expandable section. User can always expand.

## Changes Needed

### Backend

- [ ] Add `relevantForTypes?: string[]` to `FieldDescriptor` in `schema.types.ts`.
- [ ] Export `getAllMaterialTypeKeys()` from `cobiss-code-map.ts`.
- [ ] Add helper in `schema.service.ts` to derive type code lists from record
      type patterns (e.g. all codes starting with `a` → text types).
- [ ] Annotate the ~6-8 type-specific fields with `relevantForTypes` in
      `buildRecordFields()`.
- [ ] Build `typeProfiles` map in the schema service: for each material type
      code, compute `primaryFields` (keys of universal + matching fields) and
      include the `ResolvedCode` label. Return alongside `fields` in the
      response.
- [ ] Update `api-test-suite.sh` with checks for `relevantForTypes` and
      `typeProfiles`.

### Frontend / Desktop Archive App

- [ ] Consume `typeProfiles` from the schema response — on material type
      selection (or COBISS import), look up `primaryFields` to control which
      form fields are visible.
- [ ] Render non-primary fields in a collapsible "Additional fields" section.
- [ ] No extra API calls needed — everything comes in the single schema fetch.

## Key Files

- `backend/src/modules/schema/schema.types.ts` — FieldDescriptor interface
- `backend/src/modules/schema/schema.service.ts` — field definitions
- `backend/src/modules/import/cobiss/cobiss-util/cobiss-code-map.ts` — material type codes
- `backend/test/api-test-suite.sh` — API tests
- `frontend/src/pages/admin/AdminItemEditPage.vue` — current hardcoded form (future)
