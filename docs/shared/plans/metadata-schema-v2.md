# Metadata schema v2 — the contract

## Status: backend DONE (B1–B6, 2026-09-24, not yet in production) · web and archive app next

The backend implements this contract as written, with the refinements marked
**(as built)** below; details and the decisions taken on the way are in the
[backend plan](../../backend/plans/metadata-schema-v2.md#done--what-was-built-2026-09-24).

| Doc | What it covers |
|---|---|
| **this file** | The JSON contract every client builds its editor from, the rule language, the suggest/vocabulary calls, publish validation. The one place both sides agree on. |
| [Backend plan](../../backend/plans/metadata-schema-v2.md) | What changes in NestJS, in which order, which tests. |
| [Web frontend plan](../../frontend/plans/metadata-schema-v2.md) | Moving the admin editor from hard-coded fields to this schema. |
| [Archive app migration](metadata-schema-v2-archive-app.md) | What the desktop archive app (at the client, `nbcg-dc`) must change to use v2. |

Supersedes [material-type field visibility](../../backend/history/material-type-field-visibility.md)
(`relevantForTypes` + `typeProfiles`), which only covered visibility by material type.
Its web half lives on as an interim step: [a static visibility map in the web editor](../../frontend/plans/material-type-field-visibility.md)
that switches to these rules once they exist.

---

## Why

Today `GET /api/schema/record` (v1, see [reference](../../backend/reference.md#schema-v1))
returns a flat list of field descriptors. The desktop archive app builds its
whole editor from it. The web admin editor takes only its code lists from it and
hard-codes everything else: which fields exist, layout, labels (all 40 fields
since `cd8e5bd`). What is missing:

1. **Dynamic fields.** Which fields are shown and which are required depends on
   what is being described:
   - **material type** — a book has a page count, a video a duration (the same
     number, only the unit changes: `str.` → `min`), a map a cartographic scale;
   - **is the item itself a collection** (`collectionType ≠ 0`) — then e.g. the
     page count is not required; it lives on the sub-collections/children;
   - **is the parent a serial collection** (`collectionType = 4`) — then the
     child is an issue and needs issue number / date.
2. **How to fill a field.** v1 says `type: "string"`; the editor also needs to
   know: plain input, dropdown, or a search box — and if a search box, where to
   search and whether the user must pick one of the results.
3. **Typeahead hints for repeating free text.** For values that repeat but are
   free text (publisher, place, keywords, dimensions), the user should see the
   5 most common existing spellings as they type, click one to fill the input,
   and still edit it freely. The point is consistency ("how did others write
   this?"), not restriction.
4. **Small closed lists inline, big ones searchable.** A list of 10–20 values is
   sent whole (no extra calls). Languages (449) and relator roles (116) are not;
   they get a search endpoint instead.
5. **Labels.** v1 has none, so every client keeps its own translations.

### Decisions already made (2026-09-23)

| Question | Decision |
|---|---|
| New schema per selection (e.g. re-fetch when material type changes)? | **No.** One call, one JSON, with the conditions inside. The client re-evaluates locally on every change. |
| Where are required fields enforced? | **In the UI, and the backend blocks publishing** (DRAFT → RECORD). A draft may be incomplete. |
| How does the schema know "collection" / "serial"? | The existing `collectionType` on the item: `0` not a collection, `1` primary, `3` standard, `4` serial. "Child of a serial" = a parent has `collectionType = 4`. |
| Should the web frontend load the schema from the backend or keep a static copy? | **From the backend.** See [the frontend plan](../../frontend/plans/metadata-schema-v2.md#decision-load-the-schema-from-the-backend). |

---

## Endpoints

| Call | Purpose | Auth |
|---|---|---|
| `GET /api/schema/v2/record` | The whole schema. | public |
| `GET /api/search/vocabularies/:name?q=&limit=` | Search a controlled vocabulary too big to inline. | public |
| `GET /api/search/suggest?field=&q=&limit=` | Existing endpoint: most common existing values. | public (visibility-filtered) |
| `GET /api/items/:id/validation?target=RECORD` | Dry run of the publish check. | same as reading the item |

**v1 stays frozen** at `GET /api/schema/record` until the archive app has moved
to v2 (the app runs at the client and cannot be updated in lock-step with a
deploy). After that v1 is deleted — see the archive plan.

Caching: `ETag` + `Cache-Control: no-cache`. Clients send `If-None-Match` and get
a `304` with no body when nothing changed. (v1's `max-age=86400` lets a client
run on a day-old schema after a deploy; v2 must not.)

All `path` values inside the schema are **relative to the API base** (`/api`) and
start with `/search` — the client prefixes its own base URL.

---

## Response shape

```jsonc
{
  "schemaVersion": 2,
  "languages": ["en", "cnr"],          // keys every Label object carries
  "inlineVocabularyMax": 50,           // informational: lists above this are searched, not inlined
  "context":      [ /* ContextKey */ ],
  "vocabularies": { /* name → Vocabulary */ },
  "groups":       [ /* Group */ ],
  "fields":       [ /* Field */ ]
}
```

### Label

```jsonc
{ "en": "Publisher", "cnr": "Izdavač" }
```

### ContextKey — the only things a rule may look at

Rules never read arbitrary metadata paths. They read a small, declared
**context** the client computes from the item being edited (and its parent).
That keeps the rule evaluator ~50 lines in any language.

```jsonc
"context": [
  { "key": "materialType",         "type": "string",   "source": "item",   "path": "materialType.code",
    "description": "2-char COBISS code, e.g. am = book, em = printed map" },
  { "key": "recordType",           "type": "string",   "source": "item",   "path": "recordType.code",
    "fallback": "materialType.code[0]" },
  { "key": "bibliographicLevel",   "type": "string",   "source": "item",   "path": "bibliographicLevel.code",
    "fallback": "materialType.code[1]" },
  { "key": "collectionType",       "type": "number",   "source": "item",   "path": "collectionType", "default": 0 },
  { "key": "isChild",              "type": "boolean",  "source": "parent", "description": "the item has at least one parent" },
  { "key": "parentCollectionType", "type": "number[]", "source": "parent", "path": "collectionType",
    "description": "collectionType of every parent; [] when there is none" },
  { "key": "itemState",            "type": "string",   "source": "item",   "description": "NEW | DRAFT | RECORD" }
]
```

`source: "parent"` means the client must know the parent(s). The archive app
knows it when it creates a child under a selected parent; the web editor reads
`parent_relations` from the item and fetches the parent. The backend loads it
itself when validating.

### Vocabulary — a closed list of allowed values

```jsonc
"vocabularies": {
  "materialType": {
    "size": 25,
    "values": [ { "code": "am", "en": "Book", "cnr": "Knjiga" }, "…" ]
  },
  "collectionType": {
    "size": 4,
    "values": [
      { "code": 0, "en": "Not a collection",   "cnr": "Nije zbirka" },
      { "code": 1, "en": "Primary collection", "cnr": "Primarna zbirka" },
      { "code": 3, "en": "Collection",         "cnr": "Zbirka" },
      { "code": 4, "en": "Serial collection",  "cnr": "Serijska zbirka" }
    ]
  },
  "language": {
    "size": 449,
    "search": { "path": "/search/vocabularies/language?limit=5", "queryParam": "q", "minChars": 1 }
  }
}
```

- `size ≤ inlineVocabularyMax` (50) → `values` is present and complete.
- Bigger → no `values`; `search` says where to look up. (Today: `language` 449,
  `relator` 116, `contentType` 69.)
- One vocabulary is shared by every field that uses it — the three language
  fields no longer ship 449 entries three times (v1: ~98 KB, most of it that;
  v2: ~41 KB).
- **(as built)** Vocabularies: `materialType` 25, `recordType` 14,
  `bibliographicLevel` 6, `country` 28, `illustration` 16, `literaryForm` 35,
  `biography` 5, `responsibility` 3 (`primary`/`alternative`/`secondary`,
  stored as the bare code), `collectionType` 4, `extentUnit` 5 (`pages`,
  `sheets`, `volumes`, `items`, `minutes`) — inline; `language` 449, `relator`
  116 (COMARC numeric codes, `070` = author), `contentType` 69 — searched.
- Vocabulary labels are the `{ code, en, cnr }` objects from
  `cobiss-code-map.ts`, unchanged.

### Group

```jsonc
{ "key": "publication", "order": 6, "label": { "en": "Publication", "cnr": "Izdavanje" } }
```

### Field

```jsonc
{
  "key": "publisher",
  "label": { "en": "Publisher", "cnr": "Izdavač" },
  "help":  { "en": "As on the title page", "cnr": "Kao na naslovnoj strani" },   // optional
  "group": "publication",
  "order": 12,

  "type": "string",          // string | text | integer | number | boolean | date | enum | quantity | object
  "multiple": false,         // true → the stored value is a JSON array of `type`
  "input": "autocomplete",   // how to render — see the table below

  "values":  null,           // enum only: { "vocabulary": "language", "storeAs": "resolvedCode" | "code" }
  "suggest": {               // optional typeahead from existing data
    "path": "/search/suggest?field=publisher&limit=5",
    "queryParam": "q",
    "minChars": 2,
    "strict": false          // false = hints only, value stays free text
  },

  "required": false,
  "visible": true,
  "readOnly": false,
  "unit": null,              // quantity only, e.g. { "code": "pages", "en": "p.", "cnr": "str." }
  "constraints": {           // all optional
    "minLength": 1, "maxLength": 500,
    "min": 1, "max": 100000,
    "minItems": 1, "maxItems": 50,
    "pattern": "^\\d{4}$",
    "patternHint": { "en": "Four-digit year", "cnr": "Godina od četiri cifre" }
  },

  "rules": [ /* Rule — applied in order */ ],
  "objectShape": null,       // object only: Field[]; nested fields see the same context

  "parentInheritable": true, // unchanged from v1: a linked parent may pass the value down
  "issueIdentifying": false  // unchanged from v1: must be filled per child even with a parent
}
```

#### `type` — what is stored

| type | Stored JSON | Notes |
|---|---|---|
| `string` | `"…"` | single line |
| `text` | `"…"` | multi-line (notes, summary) |
| `integer`, `number` | `123` | |
| `boolean` | `true` | |
| `date` | `"1905-03-12"`, `"1905-03"` or `"1905"` | ISO, partial dates allowed |
| `enum` | depends on `values.storeAs` | `resolvedCode` → `{ "code", "en", "cnr" }` (like `language` today); `code` → the bare code (`"primary"`, `4`) |
| `quantity` | `{ "value": 253, "unit": "pages" }` | the unit comes from the evaluated `unit`; the user types only the number |
| `object` | `{ … }` | shape in `objectShape` |

v1 described `authors[].responsibility` and `authors[].role` both as `enum` but
stores them differently (a bare string vs a full code object) — the client had
to know. `storeAs` makes it explicit.

#### `input` — how to render (computed by the backend, so clients don't re-derive it)

| type | values / suggest | input | Behaviour |
|---|---|---|---|
| string | — | `text` | plain input |
| text | — | `textarea` | |
| string | `suggest.strict = false` | `autocomplete` | free text; typing calls `suggest.path`; clicking a hint fills the input and it stays editable |
| string | `suggest.strict = true` | `autocomplete` | must pick one of the returned hints (UI-enforced only) |
| enum | vocabulary has `values` | `select` (`multiselect` if `multiple`) | dropdown, no calls |
| enum | vocabulary has `search` | `autocomplete` | strict: search the vocabulary, must pick a result |
| integer / number | — | `number` | |
| quantity | — | `number` | number input with the unit as a suffix (`253 str.`) |
| boolean | — | `checkbox` | |
| date | — | `date` | |
| object | — | `object` | a sub-form; with `multiple` a repeatable sub-form ("+ add author") |

`multiple` on a string field with `suggest` = chips with typeahead
(keywords, parallel titles).

`suggest` on an **object** field (`authors`): each hint's `value` is an object
(`{ familyName, firstName, … }`); picking one fills the sub-fields with the same
keys, which then stay editable.

### Rule — the conditional part

```jsonc
{
  "when": { "all": [
    { "ref": "recordType", "in": ["a", "b"] },
    { "ref": "collectionType", "eq": 0 }
  ] },
  "set": { "visible": true, "required": true, "unit": { "code": "pages", "en": "p.", "cnr": "str." } }
}
```

**Conditions** (`when`):

| Form | True when |
|---|---|
| `{ "ref": K, "eq": v }` | context `K` equals `v` |
| `{ "ref": K, "in": [v1, v2] }` | context `K` is one of the values |
| `{ "ref": K, "empty": true }` | `K` is null/undefined/`""`/`[]` (`false` = the opposite). **(as built)** Also a blank string and `{}` — the same `isEmpty` decides "required but empty" on publish |
| `{ "all": [c…] }` / `{ "any": [c…] }` / `{ "not": c }` | the usual |

If the context value is an **array** (`parentCollectionType`), `eq`/`in` are true
when **any** element matches. Comparison is strict (`4` ≠ `"4"`). A `ref` that
is not declared in `context` is a schema bug — the backend's own tests reject it.

**Effects** (`set`) may change: `visible`, `required`, `readOnly`, `unit`, `label`,
`help`, and `constraints` (merged key by key into the current constraints). Nothing
else — `type`, `input`, `values` never change, so a field's stored shape is
fixed regardless of material type.

### Evaluation — identical in every client and in the backend

```text
evaluate(field, ctx):
    s = { visible, required, readOnly, unit, label, help, constraints } of the field
    for rule in field.rules:                 # in order; a later match wins
        if matches(rule.when, ctx):
            for k, v in rule.set:
                if k == "constraints": s.constraints = { ...s.constraints, ...v }
                else:                  s[k] = v
    if not s.visible: s.required = false     # a hidden field is never required
    return s

object fields: evaluate the object, then each objectShape field with the same ctx;
               a hidden object hides its children.
```

The TypeScript implementation lives once in the backend and is copied verbatim
into the web frontend; a conformance fixture (`context` in → expected field
states out) is published so the archive app can test its own port against the
same cases. See the backend plan.

**(as built)** Implementation: `backend/src/modules/schema/rules/evaluate.ts`
— `buildContext`, `isEmpty`, `matches`, `evaluateField`, `evaluateAll`
(states keyed by dotted path: `extent`, `issue.number`) and `checkMetadata`,
the publish check itself, so a client can show exactly what the backend will
refuse. Fixture: `backend/src/modules/schema/rules/conformance.json`, sections
`isEmpty`, `buildContext`, `mechanics` (the rule language on synthetic fields),
`record` (the rule table against `GET /schema/v2/record`) and `check`
(metadata in → `missing` / `violations` paths out). In `expected`, only the
listed properties are compared; `unit` is the unit code, `label`/`help` the
English text.

### Editor rules every client follows

1. **Hidden ≠ deleted.** A field that evaluates `visible: false` but already has
   a value (typical after a COBISS import or a material-type change) is shown in
   a collapsed **"Other fields"** section with a note, and saved unchanged. A
   client never drops data because of a rule.
2. **Required is shown, not blocking on save.** Mark with `*`; show a
   non-blocking "N required fields missing — cannot be published yet" summary.
   Saving a draft always works.
3. **Units are written, not typed.** For a `quantity`, the client writes the
   evaluated `unit.code` next to the number on save. If the material type later
   changes, the editor shows the stored unit and flags the mismatch instead of
   silently reinterpreting 253 pages as 253 minutes.
4. **Re-evaluate on every change** of a context field (`materialType`,
   `recordType`, `bibliographicLevel`, `collectionType`) — no re-fetch.

---

## Suggest and vocabulary search

### Free-text hints — `GET /api/search/suggest`

Already exists (see [reference](../../backend/reference.md#suggest-typeahead)).
Response:

```json
{ "field": "publisher", "suggestions": [ { "value": "Obod", "count": 12 } ] }
```

The client appends `&q=<typed text>` to `suggest.path` and shows `value`s in
order. v2 changes on the backend: prefix-matching values only (not sibling
values of array fields), accent-insensitive matching, default `limit` 5, and
every field that declares `suggest` must be in the allowlist (checked at
startup).

### Controlled vocabularies — `GET /api/search/vocabularies/:name`

New. Searches the code list itself, **not** OpenSearch — a language nobody has
used yet must still be selectable. Same response shape as suggest, so a client
needs one parser:

```bash
curl 'http://localhost:3000/api/search/vocabularies/language?q=crn&limit=5'
```
```json
{ "field": "language",
  "suggestions": [ { "value": { "code": "cnr", "en": "Montenegrin", "cnr": "Crnogorski" } } ] }
```

Matches `code`, `en` and `cnr` (prefix first, then substring; accent- and
case-insensitive). No `count`.

---

## Publish validation

Every path that makes an item a RECORD runs the same check:
`POST /api/items/transition` (single or bulk), `POST /api/items` with
`targetState: RECORD`, and completing a REVIEW_PUBLISH task (see
[task workflow v2](task-workflow-v2.md) — built 2026-09-25: it goes through
`transition()`, the 400 reaches the caller unchanged and the task stays OPEN).

For every field: evaluate it with the item's context; if it is **visible and
required and empty** → missing; if it has a value that breaks `constraints` →
violation. Required sub-fields of repeatable objects are checked per element
(`corporateBodies[1].name`).

Failure is all-or-nothing (transition is one transaction today) and says which
item and which field:

```json
{
  "statusCode": 400,
  "code": "PUBLISH_VALIDATION_FAILED",
  "message": "1 of 2 items is not ready to publish",
  "items": [
    { "id": "clx…",
      "missing":    [ { "path": "extent", "label": { "en": "Number of pages", "cnr": "Broj strana" } } ],
      "violations": [ { "path": "publication.year", "constraint": "pattern",
                        "hint": { "en": "Four-digit year", "cnr": "Godina od četiri cifre" } } ] }
  ]
}
```

**(as built)** Each violation also carries the field's evaluated `label`, and
`limit` for a broken bound (`minLength: 3` → `3`). A `quantity` whose stored
unit is not the evaluated one is a violation `{ constraint: "unit", limit:
"minutes" }` — editor rule 3 enforced on publish. `items` lists only failing
items; `id` is `null` when `POST /api/items` created nothing. `message` is
`"1 of 1 item is not ready to publish"` / `"1 of 2 items are not ready to
publish"`.

`GET /api/items/:id/validation?target=RECORD` returns the same `missing` /
`violations` for one item with `200 { ok: boolean, … }`, so a dialog can show
the checklist before the user clicks.

Deliberately **not** validated:
- draft create/update (a draft is work in progress);
- PATCH on an existing RECORD — otherwise every old COBISS record would demand
  the new fields on its next edit. The editor still shows the warnings;
- the COBISS import worker, even with `target: RECORD` — COBISS is the
  catalogue of record; the job result lists the items that would fail, so they
  can be fixed later. **(as built)** In `progress.warnings[] { id, reason }` of
  `GET /api/import/jobs/:id`, separate from `errors` (those items did import).

---

## Initial rule set — to confirm with the library

The mechanism is the deliverable; the concrete rules below are a first proposal
based on COMARC/B and the examples given (pages / duration / map scale / serial
issue). Material-type categories are keyed on `recordType` (first letter of
`materialType`): `a` `b` text, `c` `d` printed/manuscript music, `e` `f` maps,
`g` video/projected, `i` `j` sound, `k` graphics, `l` electronic, `m` multimedia,
`r` 3-D object.

| Field | Base | Rules |
|---|---|---|
| `title` | required | — |
| `collectionType` | `select`, required, default 0 | hidden when `isChild` and the parent is a serial (an issue is not a collection) |
| `materialType` | `select` | required on publish (it drives every other rule) |
| **`extent`** (new, `quantity`) | hidden | `a b c d` → visible, unit `pages` "str.", label "Broj strana"; `g i j` → visible, unit `minutes` "min", label "Trajanje"; `e f k` → visible, unit `sheets` "list."; **required** when `collectionType = 0` and `recordType ∈ a b g i j`; never required when `collectionType ≠ 0` (it lives on the children) |
| `cartographicMathematicalData` (206, scale) | hidden | `e f` → visible + required, label "Scale" / "Razmjera" (as built; was "Merilo" here), help "1:25 000" |
| `musicEditionStatement` (208) | hidden | `c d j` → visible |
| `ismn` | hidden | `c d` → visible |
| `isbn` | visible | hidden when `bibliographicLevel = s` or `parentCollectionType ∋ 4` |
| `issn` | hidden | visible when `bibliographicLevel ∈ s i` or `collectionType = 4` or `parentCollectionType ∋ 4` |
| `numberingAndDates` (207) | hidden | visible when `bibliographicLevel ∈ s i` or `collectionType = 4` |
| **`issue`** (new, `object`: `volume`, `number`, `date`) | hidden | `parentCollectionType ∋ 4` → visible; `number` and `date` required |
| `textualMaterialCodes` (105) | hidden | `a b` → visible |
| v1 `levels: ['main']` fields: `collectionType`, `isbn`, `ismn`, `textualMaterialCodes`, `titleByAnotherAuthor`, `authors`, `corporateBodies`, `edition`, `cartographicMathematicalData`, `musicEditionStatement` | — | **(as built, decided 2026-09-24)** hidden when `parentCollectionType ∋ 4` (an issue of a serial), as the last rule so it wins over the material-type rules. Not for other children: a book inside a fond keeps its authors |
| `cobissId` | editable | **(as built)** `readOnly` + help "Cannot be changed after creation." once `itemState ≠ NEW` |
| **`keywords`** (new, 610, `string` × multiple) | visible | `suggest` free — the "repeating free text" example |
| **`summaryNote`** (330) | visible, `text` | — (the web editor had a Summary field that the API silently dropped; it was removed in `cd8e5bd` until this lands — see the backend plan) |

`issue.date` is also what the planned serial collection view needs for its
date picker ([collection views](../../frontend/plans/collection-views.md)).

### Suggest / vocabulary per field (initial)

| Mode | Fields |
|---|---|
| free hints (`suggest`) | `publication.publisher`, `publication.place`, `publication.placeOfManufacture`, `publication.manufacturerName`, `seriesTitle`, `authors[]` (family/first name), `corporateBodies[].name`, `keywords`, `edition`, `dimensions`, `physicalDescription` |
| inline select | `materialType` (25), `recordType` (14), `bibliographicLevel` (6), `country` (28), `collectionType` (4), `illustrationCodes` (16), `literaryForm` (35), `biographyCode` (5), `authors[].responsibility` (3) |
| vocabulary search | `language`, `originalLanguage`, `translationLanguages` (449), `authors[].role` (relators, 116), `contentTypeCodes` (69) |

---

## Open questions (not blocking the backend work)

- [ ] Montenegrin check of the captions new in v2 (list in the
      [reference](../../backend/reference.md#schema-v2)).
- [ ] Accent-insensitive matching inside OpenSearch (`asciifolding` + reindex):
      suggest filters accent-insensitively, but `Niksic` still finds nothing.
      Skipped on 2026-09-24; do it with the next reindex.

- [ ] The rule table above — confirm with the library, especially what is
      required for which material type.
- [ ] `collectionType` values `2` and `5+`: unused today? (The web
      [collection views](../../frontend/plans/collection-views.md) plan has the
      same question.)
- [ ] Parse `extent` out of COBISS `physicalDescription` (`"253 str."`,
      `"1 video disk (95 min)"`) on import? Best-effort regex; nice for search,
      not required.
- [ ] Merge the web editor's interim visibility rules into the rule table
      above? (2026-09-24: not for now — the contract table was built as is.) They make series, `edition`, original/translation languages,
      place/name of manufacture, `titleByAnotherAuthor` and
      `documentTypology` type-specific, and hide ISBN for `cm dm aa ai li ud`
      too ([§2a](../../frontend/plans/material-type-field-visibility.md#2a-differences-from-the-schema-v2-initial-rule-set)).
      Otherwise the web editor's switch to v2 brings those fields back.
- [ ] Fields for types that have none of their own: article host
      publication / volume / pages (463), colour and sound (115, 125/126),
      file format (135), event place and date (620). `extent` covers only
      duration. List in the [web plan, §4](../../frontend/plans/material-type-field-visibility.md#4-known-gaps-backend-decide-separately).
