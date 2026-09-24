# Frontend: schema-driven metadata editor (schema v2)

## Status: PLANNED (2026-09-23) — backend ready (B1–B6 done 2026-09-24), can start

Contract: [shared/plans/metadata-schema-v2.md](../../shared/plans/metadata-schema-v2.md).
Backend: [backend/plans/metadata-schema-v2.md](../../backend/plans/metadata-schema-v2.md).
Interim step: [material-type field visibility](material-type-field-visibility.md),
a static visibility map in the current form that switches to F1's `useSchemaForm`.

---

## What the backend now provides (2026-09-24)

Everything F1–F5 needs is live on dev ([backend plan](../../backend/plans/metadata-schema-v2.md#done--what-was-built-2026-09-24)):

| Need | Where |
|---|---|
| Schema | `GET /api/schema/v2/record` — `Cache-Control: no-cache` + `ETag` |
| Types to mirror in `src/api/schema.ts` | `backend/src/modules/schema/v2/schema-v2.types.ts` + the rule types at the top of `evaluate.ts` |
| File to copy verbatim to `src/utils/schemaRules.ts` | `backend/src/modules/schema/rules/evaluate.ts` — besides `evaluateField` / `evaluateAll` / `matches` / `isEmpty` it has `buildContext(metadata, parentsMetadata, itemState)` and **`checkMetadata(schema, metadata, ctx)`**, the exact function the backend's publish check runs. Use it for F4's banner, so "N required fields missing" and the backend's 400 can never disagree. The backend jest test `evaluate.spec.ts` starts checking the copy byte-for-byte as soon as the file exists (skipped until then). |
| Conformance cases for the web's own tests (optional) | `backend/src/modules/schema/rules/conformance.json` |
| Vocabulary search | `GET /api/search/vocabularies/:name?q=&limit=5` — same response shape as suggest, without `count` |
| Publish check | `400 { code: "PUBLISH_VALIDATION_FAILED", message, items: [{ id, missing: [{ path, label }], violations: [{ path, label, constraint, limit?, hint? }] }] }`; dry run `GET /api/items/:id/validation?target=RECORD` → `{ ok, missing, violations }` |
| New fields accepted | `summaryNote` (330), `keywords` (610), `extent` `{ value, unit }`, `issue` `{ volume, number, date }` |
| Import warnings | `GET /api/import/jobs/:id` → `progress.warnings[]` (records imported that would fail the publish check) |

Label changes to know about: 215/a `physicalDescription` is now "Extent
statement" / "Podatak o obimu" in the schema, because the new numeric `extent`
is "Extent" / "Obim" (and switches to "Number of pages", "Duration", "Number of
sheets" by material type).

### ⚠ Already affects the current web app

Publish validation is **on** in the backend (every client, every publish):

- **A book (`am`, and any `a b g i j` type that is not a collection) can no
  longer be published without `extent`, and the current form has no field for
  it** — only the JSON tab can add `"extent": { "value": 253, "unit": "pages" }`.
  Same for an issue of a serial (`issue.number`, `issue.date`) and a map's
  scale (206, which the form has under "Advanced"). Title-only items need a
  material type to publish.
- Bulk publish on `AdminItemsPage.vue` shows only the error's `message`
  ("1 of 2 items are not ready to publish") in a toast, not which fields.
  "New record" (create as RECORD) fails the same way.

So on production the backend's B6 must ship **together with** at least the
`extent`/`issue` inputs and the F4 error dialog, or the web cannot publish
books. The quick path: add a Summary field (`summaryNote`), an extent number
input with the unit from the material type, and issue number/date to the
current form, render `PUBLISH_VALIDATION_FAILED` item by item — then F1–F3.

---

## Current state (verified 2026-09-24, after `cd8e5bd`)

`src/pages/admin/AdminItemEditPage.vue` (≈ 630 lines) hosts
`src/components/admin/ItemMetadataForm.vue`, a hand-written form over every
field the API accepts (the 40 `DomainRecord` keys: identification,
responsibility, publication, physical description, series, identifiers,
languages and countries, notes and links, plus COMARC 105/206/207/208 under a
collapsible "Advanced"), and keeps the raw-JSON tab. The form model and
`metadataToForm()` / `formToMetadata()` live in
`src/components/admin/form/metadataForm.ts`. A field cleared on update is sent
as `null`, which the API treats as "unset".

Problems this plan removes, and what `cd8e5bd` already did about them:

1. ~~**`summaryNote` is never saved.**~~ The backend drops unknown keys and
   `summaryNote` is not one of them. `cd8e5bd` made the web `DomainRecord`
   mirror the backend's exactly, so the editor and the record page have **no
   Summary field** now. Backend B3 is done (2026-09-24): `summaryNote` is
   accepted and parsed from COBISS 330 — add the field back.
2. ~~**Dropdowns only offer values already in the data.**~~ Fixed on v1:
   code lists (material/record type, level, languages, countries, relators,
   105 codes) come from `allowedValues` in `GET /api/schema/record`
   (`codeListsFromSchema()`). `/search/suggest` is only a fallback when the
   schema call fails. v1 still inlines all 449 languages, filtered locally.
3. **No material-type awareness**: a map shows no scale field, a book no page
   count, a serial issue no issue number. The interim
   [material-type visibility](material-type-field-visibility.md) plan covers
   the visibility part.
4. The form and the archive app can disagree on labels and required fields.
   Both now read `/api/schema/record` for options, but v1 has no labels and no
   conditions.

## Decision: load the schema from the backend

Asked: "kliči metadata schema iz backenda ali rajši statično?" — **from the
backend**, `GET /api/schema/v2/record`, once per session:

- **One source of truth.** The backend already needs the rules to validate a
  publish; the archive app already renders from the schema. A static copy in the
  web app is a third copy that drifts — `summaryNote` is exactly such a drift.
- **Dynamic rules** (required by material type / collection / parent) would
  otherwise be re-implemented by hand in Vue.
- **Cost is negligible:** one request, browser-cached (`ETag` + `no-cache` →
  a 304 on later loads), a few tens of KB once big vocabularies are searched
  instead of inlined.
- The only thing kept static is the rule **evaluator** — ~50 lines copied
  verbatim from the backend and checked byte-identical by a backend test.

---

## Phases

### F1 — schema plumbing (S)

- `src/api/schema.ts` — TypeScript types mirroring the contract (`SchemaV2`,
  `FieldV2`, `Rule`, …) and `getRecordSchema()`. No manual ETag handling: with
  `Cache-Control: no-cache` the browser revalidates and hands axios the cached
  body on a 304.
- `src/stores/schema-store.ts` (Pinia) — load once, expose `schema`, `field(key)`,
  `vocabulary(name)`, `label(obj)` (picks `en`/`cnr` from the current i18n
  locale: `en-US` → `en`, `me` → `cnr`).
- `src/utils/schemaRules.ts` — **verbatim copy** of
  `backend/src/modules/schema/rules/evaluate.ts`, header comment saying so.
- `src/composables/useSchemaForm.ts` — `(metadata: Ref, parents: Ref, itemState)`
  → `computed` map `path → FieldState` (`visible`, `required`, `readOnly`, `unit`,
  `label`, `constraints`), plus `missingRequired` and `hiddenWithValue` lists.

### F2 — quick win on the current form (S)

Before the full renderer, point the existing three dropdowns at schema
vocabularies: `materialType` and `country` → `vocabulary.values`; `language` →
strict search via `vocabularies.language.search`. Removes problem 2 without
waiting for F3.

**Update 2026-09-24:** problem 2 is already gone on v1 (`cd8e5bd`). What is
left: `codeListsFromSchema()` reads v2 `vocabularies`, and the language fields,
relator roles and content types move from inline options (449 / 116 / 69) to
the vocabulary search.

### F3 — generic renderer (L)

> **Open question (2026-09-24):** this phase was written when the editor was a
> 12-field form. Since `cd8e5bd` it is a hand-written form over all 40 fields
> (`ItemMetadataForm.vue` + `form/`). Either F3 replaces that form with the
> generic renderer below, or it keeps it and feeds it the evaluated field states
> from `useSchemaForm` (`visible`, `required`, `unit`, `label`). The second is
> how the [material-type visibility](material-type-field-visibility.md) plan
> switches to v2. Decide before starting F3: it changes the size and what
> happens to `form/metadataForm.ts`.

New components in `src/components/metadata/`:

| Component | Renders |
|---|---|
| `SchemaForm.vue` | groups as `q-expansion-item` sections (ordered), then "Other fields" |
| `SchemaField.vue` | switch on `field.input` → one of the below; shows `*`, `help`, constraint errors |
| `VocabularySelect.vue` | `select`/`multiselect` from inline values; strict `autocomplete` from `vocabulary.search`; stores per `values.storeAs` |
| `SuggestInput.vue` | free `autocomplete`: `q-select use-input fill-input hide-selected` (the pattern the page already uses for publisher/author), calls `suggest.path` + `&q=`; with `multiple` → chips |
| `QuantityInput.vue` | `q-input type=number` with the evaluated unit as `suffix`; writes `{ value, unit }`; flags a stored unit that differs from the evaluated one |
| `ObjectField.vue` | sub-form; `multiple` → repeatable with add/remove/reorder (authors, corporate bodies) |
| `OtherFieldsSection.vue` | fields that evaluate hidden but have a value — collapsed, with a note, still editable |

`AdminItemEditPage.vue`:
- Form tab = title + visibility (as now) + `<SchemaForm v-model="metadata">`.
  The flat `form` model and `metadataToForm`/`formToMetadata` go away — the form
  binds straight to the metadata object, so fields the form does not know are
  preserved automatically (today that relies on the `...metadata` spread).
- JSON tab stays; it now serialises/parses the same object.
- Optimistic concurrency, files, history and tasks tabs are untouched.
- `cobissId` readonly-after-create comes from the schema (`readOnly` rule on
  `itemState`) instead of `:readonly="!isNew"`. (Since `cd8e5bd` the API
  rejects a changed `cobissId` with a 400 either way.)

### F4 — publish readiness (S)

- Non-blocking banner in the editor: "N required fields missing — cannot be
  published yet", each a link that scrolls to the field (client-side from
  `useSchemaForm`, no call).
- A shared `PublishErrorDialog.vue` for `400 PUBLISH_VALIDATION_FAILED`:
  per item → missing labels + violations, link to `/admin/items/:id`. Used by:
  - bulk publish on `AdminItemsPage.vue` (the whole batch is rejected — say so);
  - the editor publish button (nice-to-have **A2**, accepted 2026-09-24: the
    Status side card's "Publish as record", which saves first when dirty — so
    the check runs on the saved metadata). The button can show the missing
    fields up front from `checkMetadata()` instead of waiting for the 400;
  - the task "Complete REVIEW_PUBLISH" dialog ([task workflow plan](task-workflow-v2.md)),
    which also calls `GET /api/items/:id/validation?target=RECORD` up front to
    show the checklist before the click.

### F5 — parent context (S)

The rules for serial issues need `isChild` / `parentCollectionType`. The editor
reads `parent_relations` from the loaded item, fetches each parent with
`getItem()` (normally one), and feeds `collectionType` into `useSchemaForm`.
The web app has no "create as child of…" flow today (relations are made via the
API/archive app), so a new item has no parents; if such a flow is added, pass
the chosen parent in.

### F6 — optional: public record page

`RecordDetailPage.vue` could use the same labels/units (e.g. "253 str.",
"95 min", the scale for maps). Not required for the editor work.

---

## i18n

Field and group labels come from the schema (`en`/`cnr`), so
`admin.edit.fields.*` keys are deleted once F3 lands. New UI strings (banner,
"Other fields", publish error dialog, unit-mismatch warning) go into both
`src/i18n/en-US/index.ts` and `src/i18n/me/index.ts`.

## Impact on the other side

| Frontend change | Backend needs | Backend status |
|---|---|---|
| F1–F3 | B1 (v2 endpoint), B2 (evaluator to copy), B5 (vocabulary search) | done 2026-09-24 |
| F2 alone | B1 + B5 | done |
| F4 | B6 (`PUBLISH_VALIDATION_FAILED`, `/items/:id/validation`) | done — and already enforced, see ⚠ above |
| New fields render | B3 (else the backend drops them, like `summaryNote`) | done |
| Import page shows `progress.warnings` | B6 import warnings | done (web renders only `errors` today) |
| Nothing | the archive app — independent client of the same contract | — |

## Estimate

F1 S · F2 S · F3 L · F4 S · F5 S · F6 optional.

## Key files

- `src/pages/admin/AdminItemEditPage.vue`, `src/pages/admin/AdminItemsPage.vue`
- `src/components/admin/ItemMetadataForm.vue`, `src/components/admin/form/*`
  (form model, `codeListsFromSchema()`, the input components)
- new: `src/api/schema.ts`, `src/stores/schema-store.ts`, `src/utils/schemaRules.ts`,
  `src/composables/useSchemaForm.ts`, `src/components/metadata/*`
- `src/api/search.ts` (`suggestValues` stays for catalog filters)
- `src/i18n/en-US/index.ts`, `src/i18n/me/index.ts`
