# Frontend: Material-type-driven field visibility in the item editor

## Status: TODO (2026-09-23) — web only, no backend work needed; §3b's backend side (schema v2 B1–B2) is done 2026-09-24, it waits for web F1

| Doc | Relation |
|---|---|
| [Metadata schema v2 — contract](../../shared/plans/metadata-schema-v2.md) | Where visibility ends up: per-field `rules` that evaluate to `visible`. Its initial rule set differs from §2 here — see §2a. |
| [Web plan for schema v2](metadata-schema-v2.md) | Its F1 (`useSchemaForm`) is what §3b switches to. |
| [Backend: `relevantForTypes` + `typeProfiles`](../../backend/history/material-type-field-visibility.md) | The backend counterpart this plan was written against. **Superseded 2026-09-23** by schema v2, so §3b is retargeted. |

This task is written so it can be built **before** the backend ships, on a static map, and then switched to the
schema by deleting the map. Written 2026-09-23 as `todo/frontend-material-type-field-visibility.md` (commit
`7e26b2e`), moved here 2026-09-24. Its own instruction "if the backend task changes the shape, update §3 here" is
why §3b changed. §2a and the tables at the end are new. §1, §2, §3a and §4 are as written; §4 only gained a
pointer to the contract.

Design: canvas https://claude.ai/artifact/291iYMzbyaTpu1oGcP6gEF, row "Item editor: book, journal, map"
(three artboards showing the same editor with the fields each type uses).

## 1. What the user sees

- **Material type is the first field of the form**, in its own highlighted row above the sections. The dropdown
  groups the 25 codes by category (Text, Music, Cartographic, Visual, Sound, Electronic, Other) and shows the
  code next to the label (`Book · am`).
- Picking a material type **also sets `recordType` and `bibliographicLevel`** (the code is `001/b + 001/c`,
  so `am` → `a` + `m`). Those two pickers leave the main form; they stay visible read-only under Advanced.
  Editing them by hand is no longer possible — they cannot disagree with the material type.
- After a type is chosen the form shows **only the sections and fields that type uses** (§2). Everything else
  folds into one collapsed row at the bottom: **"Other fields (n)"** with the hidden field names in the caption.
  Expanding it shows the full form; the user can fill anything. This is a visibility hint, not validation.
- If a hidden field already holds data (a COBISS import fills whatever the record has), "Other fields" opens
  by itself so nothing is ever invisible.
- **No material type selected → every field is shown**, exactly as today.
- The right-hand "On this page" card lists the visible sections with a filled/total count (`Identification 5/9`)
  and jumps to them. It reflects the same visibility.

## 2. Which fields belong to which type

Codes: first letter = record type (a text, c/d music, e/f maps, g video, i/j sound, k graphic, l electronic,
m multimedia, r 3D, u event); second letter = bibliographic level (m monograph, s serial, a analytic,
i integrating, c collection, d performed work). `*m` means "every code ending in m".

**Universal (always visible):** title, subtitle, parallelTitle, titleInOtherScript, titleMediumDesignation,
firstResponsibility, subsequentResponsibility, authors, corporateBodies, publication.publisher/place/year,
publicationDate1/2, language, country, physicalDescription, otherPhysicalDetails, dimensions, notes,
electronicLocation, cobissId.

| Field / group | Visible for | COMARC |
|---|---|---|
| `textualMaterialCodes` (illustrations, content types, literary form, biography, conference, festschrift, index) | text: `am as aa ai ac` | 105 |
| `cartographicMathematicalData` | maps: `em es fm` | 206 |
| `musicEditionStatement` | music: `cm cs dm jm js` | 208 |
| `numberingAndDates` | serials + integrating: `*s *i` | 207 |
| `isbn` | monographs + collections `*m *c`, except `cm dm` | 010 |
| `issn` | `*s *i` | 011 |
| `ismn` | `cm cs dm` | 013 |
| series (`seriesTitle`, `seriesSubtitle`, `seriesResponsibility`, `seriesIssn`, `seriesVolume`) | monographs `*m` | 225 |
| `edition` | monographs `*m` | 205 |
| `originalLanguage`, `translationLanguages` | `a* c* d* j* g* m*` | 101 c/d |
| `publication.placeOfManufacture`, `publication.manufacturerName` | printed: `a* c* e* k*` | 210 e/g |
| `titleByAnotherAuthor` | `am ac` | 200/c |
| `documentTypology` | `a* l*` | 001/t |

Examples: **Book (am)** hides 206/207/208, ISSN, ISMN (5 fields). **Journal (as)** hides series, ISBN, ISMN,
edition, 206, 208, title-by-another-author (11). **Printed map (em)** hides 105, 207, 208, ISSN, ISMN,
document typology, title-by-another-author (13).

### 2a. Differences from the schema v2 initial rule set

The contract's [initial rule set](../../shared/plans/metadata-schema-v2.md#initial-rule-set--to-confirm-with-the-library)
(also still "to confirm with the library") was written on the same day, independently. Judged on material type alone,
both agree on 105, 206, 207, 208, ISSN and ISMN. They differ on:

| Field | §2 here | v2 initial rule set |
|---|---|---|
| `isbn` | `*m *c` except `cm dm` | shown for everything except serials (and children of a serial collection), so also for `cm dm aa ai li ud` |
| series (225), `edition`, `originalLanguage` / `translationLanguages`, `placeOfManufacture` / `manufacturerName`, `titleByAnotherAuthor`, `documentTypology` | type-specific (table above) | no rule, so always visible |
| 206, 207, ISSN, ISBN | material type only | also react to `collectionType` and a serial parent; 206 is **required** for maps |
| hidden field that holds data | "Other fields" opens by itself | "Other fields" stays collapsed and shows a note (contract, editor rule 1) |

The contract's rule table is the list that wins (§5). Until these rules are merged into it (open question there),
switching to v2 (§3b) makes the fields above reappear for the types where the static map hides them.

## 3. Implementation

### 3a. Static map (now)

`frontend/src/components/admin/form/fieldVisibility.ts`:

```ts
/** Keys of MetadataForm (or dotted sub-keys) that are type-specific; absent = universal. */
export const RELEVANT_FOR_TYPES: Record<string, (code: string) => boolean> = {
  textualMaterialCodes: (c) => c.startsWith('a'),
  cartographicMathematicalData: (c) => c.startsWith('e') || c.startsWith('f'),
  musicEditionStatement: (c) => /^[cdj]/.test(c),
  numberingAndDates: (c) => /[si]$/.test(c),
  isbn: (c) => /[mc]$/.test(c) && !/^[cd]/.test(c),
  issn: (c) => /[si]$/.test(c),
  ismn: (c) => /^(cm|cs|dm)$/.test(c),
  seriesTitle: (c) => c.endsWith('m'), // + the other four series keys
  edition: (c) => c.endsWith('m'),
  originalLanguage: (c) => /^[acdjgm]/.test(c), // + translationLanguages
  'publication.placeOfManufacture': (c) => /^[acek]/.test(c), // + manufacturerName
  titleByAnotherAuthor: (c) => /^(am|ac)$/.test(c),
  documentTypology: (c) => /^[al]/.test(c),
};

export function isFieldVisible(key: string, materialType: string | null): boolean {
  if (!materialType) return true;
  const rule = RELEVANT_FOR_TYPES[key];
  return rule ? rule(materialType) : true;
}
```

- `ItemMetadataForm.vue`: every field wrapper gets `v-if="show('key')"`; a section disappears when none of its
  fields are visible. Hidden fields render again inside a `q-expansion-item` "Other fields (n)" at the bottom
  (same components, so the data binding is identical). `advancedOpen`-style watch opens it when any hidden field
  has data.
- Material type picker: `CodeSelect` over `codeLists.materialType`, options grouped with `q-select`'s
  `#option` slot plus category headers (map code → category by first letter). On change, set
  `form.recordType` / `form.bibliographicLevel` from the schema's `recordType` / `bibliographicLevel` lists
  by code (`am` → `a`, `m`). Clearing the type clears both.
- Category labels are new i18n keys in both locales (`admin.edit.materialCategories.*`).
- "On this page" card: computed list of visible sections with `filled/total` (filled = non-empty after
  `formToMetadata`), anchors via `scrollIntoView` on the section `id`.

### 3b. Switch to the schema (after schema v2 B1–B2 and web F1)

Retargeted 2026-09-24: `relevantForTypes` / `typeProfiles` will not be built (superseded, see the table at the top).
Under v2, every field carries `rules`. The web plan's F1 evaluates them into one state per field
(`useSchemaForm`: `visible`, `required`, `unit`, `label`, …).

- `isFieldVisible()` reads `visible` from `useSchemaForm` instead of `RELEVANT_FOR_TYPES`, and the static map is
  deleted. It then needs the whole item as context, not only `materialType`: v2 rules also look at `collectionType`
  and the parent (serial issues).
- Code lists move from v1 `allowedValues` (`codeListsFromSchema()`) to v2 `vocabularies`.
- Nothing else in the form changes, because the visibility decision is behind that one function. Whether v2's
  `required`, units and labels go into this hand-written form or into F3's generic renderer is an open question in
  the [web v2 plan](metadata-schema-v2.md#f3--generic-renderer-l).

## 4. Known gaps (backend, decide separately)

Visibility only hides text/music/map/serial fields. These types have **no fields of their own** in the backend,
so the editor cannot show anything specific for them until the fields exist:

- **Article (aa/ac):** host publication, volume, pages (COMARC 463 `analyticIn`) — commented out in
  `cobiss.types.ts`. Relations (`ItemRelation`) cover the link, not the location inside the host.
- **Video / sound / electronic / 3D:** duration (127), colour/sound (115), sound codes (125/126), file format (135).
- **Event (ud):** place and date of the event (620).

Tracked as an open question in the [contract](../../shared/plans/metadata-schema-v2.md#open-questions-not-blocking-the-backend-work).
Of these, v2's planned `extent` field covers only duration (unit `min` for `g i j`).

## 5. Checklist

- [ ] `fieldVisibility.ts` with the map above and `isFieldVisible()`
- [ ] Material type picker with category groups; sets/clears `recordType` + `bibliographicLevel`
- [ ] `recordType` / `bibliographicLevel` read-only under Advanced
- [ ] `v-if` per field, section hidden when empty, "Other fields (n)" expansion with auto-open
- [ ] "On this page" card with counts
- [ ] i18n (en-US + me): category labels, "Other fields", "Showing fields for {type}", "Show all fields"
- [ ] After schema v2 B1–B2 + web F1: read `visible` from `useSchemaForm`, delete the static map (§3b)
- [ ] Settle §2a against the contract's rule table before switching; the contract's list wins

## Impact on the other side

| Frontend change | Backend / other clients need |
|---|---|
| §3a: static map, grouped type picker, "Other fields (n)", "On this page" card | the editor's code lists — loaded from v1 `GET /api/schema/record`, which was removed on 2026-09-26; after web schema v2 F2 they come from v2 `vocabularies` |
| Picking a type sets `recordType` + `bibliographicLevel`; clearing it sends `null` for both | nothing new. The API stores all three today, and `null` clears a field since `cd8e5bd` |
| §3b: switch to the schema | schema v2 **B1** (endpoint) + **B2** (evaluator) — both done 2026-09-24 — and web **F1** |
| §2a differences | a decision in the contract's rule table; otherwise the switch changes what users see |
| any of the above | archive app: nothing. It builds its own editor from the schema (v1 now, v2 later) |

## Key files

- `src/components/admin/ItemMetadataForm.vue`: the form, its sections and the "Advanced" expansion
- `src/components/admin/form/metadataForm.ts`: form model, `codeListsFromSchema()`
- `src/components/admin/form/CodeSelect.vue`: the picker that gets category groups
- new: `src/components/admin/form/fieldVisibility.ts`
- `src/i18n/en-US/index.ts`, `src/i18n/me/index.ts`
