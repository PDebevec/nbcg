# Metadata schema v2 — the contract

## Status: backend B1–B6 DONE (2026-09-24, dev) · decisions of 2026-09-25 → backend B8–B12 OPEN · then web and archive app

The backend implements this contract as written, with the refinements marked
**(as built)** below; details and the decisions taken on the way are in the
[backend plan](../../backend/plans/metadata-schema-v2.md#done--what-was-built-2026-09-24).
The review against the archive app (2026-09-25) changed the contract: marked
**(2026-09-25)** below, not built yet — backend phases B8–B12.

| Doc | What it covers |
|---|---|
| **this file** | The JSON contract every client builds its editor from, the rule language, the suggest/vocabulary calls, validation on save. The one place both sides agree on. |
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
   this?" — so one person's `computer` and another's `computers` don't both end
   up in the keywords), not restriction. These lists grow without limit, so they
   are never sent whole.
4. **Small closed lists inline, big ones searchable.** A list of up to 50
   values is sent whole (no extra calls). Languages (449), relator roles (116)
   and content types (69) are not; they get a search endpoint instead.
5. **Labels.** v1 has none, so every client keeps its own translations.

### Decisions already made (2026-09-23)

| Question | Decision |
|---|---|
| New schema per selection (e.g. re-fetch when material type changes)? | **No.** One call, one JSON, with the conditions inside. The client re-evaluates locally on every change. |
| Where are required fields enforced? | ~~In the UI, and the backend blocks publishing (DRAFT → RECORD). A draft may be incomplete.~~ **Replaced 2026-09-25:** drafts have their own short required list, and the backend checks every write — see below. |
| How does the schema know "collection" / "serial"? | The existing `collectionType` on the item: `0` not a collection, `1` primary, `3` standard, `4` serial. "Child of a serial" = a parent has `collectionType = 4`. |
| Should the web frontend load the schema from the backend or keep a static copy? | **From the backend.** See [the frontend plan](../../frontend/plans/metadata-schema-v2.md#decision-load-the-schema-from-the-backend). |

### Decisions 2026-09-25 (review against the archive app)

| Question | Decision |
|---|---|
| Do a draft and a record need different fields? | **Yes, by a rule.** New context key `targetState` (`DRAFT` / `RECORD`): the state the item is being saved as. A **draft** needs a title and a material type, plus what was already required: collection type (defaults to 0), a name in each organisation entry, a URL in each link entry. A **record** also needs the publish fields: extent, map scale, issue number and date. Both editors evaluate with the state they save to — the web editor's draft or record, the archive app's Draft/Record choice per item. |
| What does the backend check, and when? | **Every write**, against the rules of the state the item ends up in: create (as DRAFT or RECORD), PATCH (the item's current state — a RECORD must stay complete), transition (both directions), linking or unlinking a parent (each child re-checked). Only the COBISS import is exempt. See [Validation on save](#validation-on-save). |
| Creating a child straight as RECORD: the backend checked it without its parents | **`POST /api/items` takes `parentIds`.** The check uses those parents, and the links are created in the same transaction. The response carries each parent's new `version`. Parents can still be linked later with `POST /api/relations/connect` (the archive app still does, for re-uploads). |
| A parent was deleted before its children were uploaded | **The write stops:** `400 PARENT_NOT_FOUND` naming the missing ids, on create and on connect; nothing is created or linked. The client tells the user to change or remove that parent. |
| Can the archive app's Draft/Record choice change after the item exists? | **No.** It is chosen only when the item is created, then locked. An existing item is edited in the state it is in on the backend (the app learns it through its sync); moving between Draft and Record is done in the web app. |
| The archive app's hand-set main/child switch | **Removed.** "Child" and "issue of a serial" come only from the item's actual parents. |
| Code lists too big to send whole — offline? | **Not needed**: both clients are always connected. Free text with many values gets hints (`suggest`), big fixed lists are searched (`language`, `relator`, `contentType`), only lists of ≤ 50 are sent whole. |
| `collectionType` default | **`default: 0` in the schema** (new optional `default` on a field); `POST /api/items` keeps filling it in too. |
| `numberingAndDates` (207) is marked "fill per issue" but never shown on an issue | **The marker is dropped.** 207 is the serial's own statement ("God. 1, br. 1 (1944)-"); issues use the `issue` object. |
| Release order: the publish check vs. clients that are not on v2 yet | **None.** All data is test data (2026-09-25): wipe, reimport a few examples, re-upload from the archive app. |

---

## Endpoints

| Call | Purpose | Auth |
|---|---|---|
| `GET /api/schema/v2/record` | The whole schema. | public |
| `GET /api/search/vocabularies/:name?q=&limit=` | Search a controlled vocabulary too big to inline. | public |
| `GET /api/search/suggest?field=&q=&limit=` | Existing endpoint: most common existing values. | public (visibility-filtered) |
| `GET /api/items/:id/validation?target=RECORD` | Dry run of the check; **(2026-09-25)** also `target=DRAFT`. | same as reading the item |
| `POST /api/items` | **(2026-09-25)** new optional `parentIds: string[]`: checked with these parents, linked in the same transaction. The response adds `parents: [ { parentId, version, childrenInDrafts, childrenInRecords } ]` (what `connect` returns, one per parent). An unknown parent → `400 PARENT_NOT_FOUND`. | as today |
| `POST /api/relations/connect` | **(2026-09-25)** re-checks each child ([Validation on save](#validation-on-save)); an unknown parent → `400 PARENT_NOT_FOUND` (was a plain 400). | as today |

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
  { "key": "itemState",            "type": "string",   "source": "item",   "description": "NEW | DRAFT | RECORD — where the item is now (NEW = not created yet)" },
  { "key": "targetState",          "type": "string",   "source": "item",   "description": "DRAFT | RECORD — the state it is being saved as" }   // (2026-09-25)
]
```

`source: "parent"` means the client must know the parent(s). The archive app
knows them before it creates the item (the batch's parents); the web editor
reads `parent_relations` from the item and fetches each parent. The backend
loads them itself when validating — from `item_relations`, or from `parentIds`
on create.

**(2026-09-25)** `targetState` is what the save goes to: on create, the chosen
state; on an edit, the item's current state; on a transition, the new one.
`itemState` stays for rules about the item's existence (`cobissId` locks once
the item exists).

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
  "default": null,           // (2026-09-25) optional: the value a new item starts with (collectionType → 0)
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
into the web frontend and the archive app (both TypeScript — nobody ports it);
a conformance fixture (`context` in → expected field states out) is published
so each copy is tested against the same cases. See the backend plan.

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

**(2026-09-25)** `buildContext(metadata, parents, itemState, targetState)` —
`targetState` becomes the fourth argument; `checkMetadata` is unchanged (it
reads whatever context it is given).

### Editor rules every client follows

1. **Hidden ≠ deleted.** A field that evaluates `visible: false` but already has
   a value (typical after a COBISS import or a material-type change) is shown in
   a collapsed **"Other fields"** section with a note, and saved unchanged. A
   client never drops data because of a rule.
2. **(2026-09-25) Required depends on the state being saved to, and blocks
   that save.** Evaluate with `targetState` = where the save goes, mark required
   fields with `*`, and don't send while one is empty or a value breaks its
   constraints — the backend would refuse it anyway. While editing a draft, a
   client may also evaluate with `targetState: RECORD` and show a non-blocking
   "N more fields needed to publish". (Was: required never blocks a draft.)
3. **Units are written, not typed.** For a `quantity`, the client writes the
   evaluated `unit.code` next to the number on save. If the material type later
   changes, the editor shows the stored unit and flags the mismatch instead of
   silently reinterpreting 253 pages as 253 minutes.
4. **Re-evaluate on every change** of a context field (`materialType`,
   `recordType`, `bibliographicLevel`, `collectionType`), of the draft/record
   choice, or of the parents — no re-fetch.
5. **(2026-09-25) New items start from `default`.** A field with a `default`
   is prefilled on a new item (`collectionType` → 0).

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

## Validation on save

**(2026-09-25)** Was "publish validation": only paths that made an item a
RECORD were checked. Now every write is checked, against the rules of the state
the item ends up in (`targetState`):

| Write | `targetState` | Parents |
|---|---|---|
| `POST /api/items` | the requested `targetState` | `parentIds` |
| `PATCH /api/items/:id` with `metadata` (the stored metadata with the patch applied) | the item's current state — a RECORD must stay complete | `item_relations` |
| `POST /api/items/transition` (single or bulk), and completing a REVIEW_PUBLISH task ([task workflow v2](task-workflow-v2.md): it goes through `transition()`, the 400 reaches the caller unchanged and the task stays OPEN) | the new state (both directions) | `item_relations` |
| `POST /api/relations/connect` / `disconnect` | each child, in its current state | the child's parents after the change |

For every field: evaluate it with the item's context; if it is **visible and
required and empty** → missing; if it has a value that breaks `constraints` →
violation. Required sub-fields of repeatable objects are checked per element
(`corporateBodies[1].name`).

Failure is all-or-nothing (one transaction; nothing is created, changed, moved
or linked) and says which item and which field:

```json
{
  "statusCode": 400,
  "code": "METADATA_VALIDATION_FAILED",
  "message": "1 of 2 items is not ready to publish",
  "items": [
    { "id": "clx…",
      "state": "RECORD",
      "missing":    [ { "path": "extent", "label": { "en": "Number of pages", "cnr": "Broj strana" } } ],
      "violations": [ { "path": "publication.year", "constraint": "pattern",
                        "hint": { "en": "Four-digit year", "cnr": "Godina od četiri cifre" } } ] }
  ]
}
```

**(2026-09-25)** `code` was `PUBLISH_VALIDATION_FAILED` (as built in B6); it
becomes `METADATA_VALIDATION_FAILED` because drafts fail too, and each item
says whose rules it failed (`state`). `message` says "not ready to publish"
when every failing item is a RECORD, "cannot be saved" otherwise.

**(as built)** Each violation also carries the field's evaluated `label`, and
`limit` for a broken bound (`minLength: 3` → `3`). A `quantity` whose stored
unit is not the evaluated one is a violation `{ constraint: "unit", limit:
"minutes" }` — editor rule 3 enforced. `items` lists only failing items; `id`
is `null` when `POST /api/items` created nothing.

**(2026-09-25)** A parent that does not exist (deleted, or a wrong id) is a
separate error, checked before the metadata:

```json
{ "statusCode": 400, "code": "PARENT_NOT_FOUND",
  "message": "Parent not found: clx…", "parentIds": [ "clx…" ] }
```

`GET /api/items/:id/validation?target=RECORD|DRAFT` returns the same `missing` /
`violations` for one item with `200 { ok: boolean, … }`, so a dialog can show
the checklist before the user clicks.

Deliberately **not** validated:
- the COBISS import worker — COBISS is the catalogue of record; the job result
  lists the items that fail their target's rules, so they can be fixed later.
  **(as built)** In `progress.warnings[] { id, reason }` of
  `GET /api/import/jobs/:id`, separate from `errors` (those items did import).
  **(2026-09-25)** Because editing a RECORD is now checked, the import also
  fills `extent` from COBISS 215 where it can (backend B11), so most imported
  books don't block their first edit;
- the **children** of an item whose own metadata changes (a Collection turned
  into a Serial collection) or that is deleted — re-checking every child would
  be unbounded. Each child is checked on its next write.

---

## Initial rule set — to confirm with the library

The mechanism is the deliverable; the concrete rules below are a first proposal
based on COMARC/B and the examples given (pages / duration / map scale / serial
issue). Material-type categories are keyed on `recordType` (first letter of
`materialType`): `a` `b` text, `c` `d` printed/manuscript music, `e` `f` maps,
`g` video/projected, `i` `j` sound, `k` graphics, `l` electronic, `m` multimedia,
`r` 3-D object.

**(2026-09-25)** Required for a **draft**: `title`, `materialType`,
`collectionType` (defaults to 0), `corporateBodies[].name`,
`electronicLocation[].url`. Required for a **record**: all of those, plus
`extent`, `cartographicMathematicalData` (scale), `issue.number`, `issue.date` —
each only where its rule makes it visible. "record only" below = a rule with
`targetState = RECORD` in its `when`.

| Field | Base | Rules |
|---|---|---|
| `title` | required (draft + record) | — |
| `collectionType` | `select`, required (draft + record), **`default: 0`** (2026-09-25) | hidden when `isChild` and the parent is a serial (an issue is not a collection) |
| `materialType` | `select`, required — **(2026-09-25) for drafts too** | — (it drives every other rule) |
| **`extent`** (new, `quantity`) | hidden | `a b c d` → visible, unit `pages` "str.", label "Broj strana"; `g i j` → visible, unit `minutes` "min", label "Trajanje"; `e f k` → visible, unit `sheets` "list."; **required, record only**, when `collectionType = 0` and `recordType ∈ a b g i j`; never required when `collectionType ≠ 0` (it lives on the children) |
| `cartographicMathematicalData` (206, scale) | hidden | `e f` → visible, label "Scale" / "Razmjera" (as built; was "Merilo" here), help "1:25 000"; **required, record only** |
| `musicEditionStatement` (208) | hidden | `c d j` → visible |
| `ismn` | hidden | `c d` → visible |
| `isbn` | visible | hidden when `bibliographicLevel = s` or `parentCollectionType ∋ 4` |
| `issn` | hidden | visible when `bibliographicLevel ∈ s i` or `collectionType = 4` or `parentCollectionType ∋ 4` |
| `numberingAndDates` (207) | hidden; **(2026-09-25) no longer `issueIdentifying`** — the serial's own statement, issues use `issue` | visible when `bibliographicLevel ∈ s i` or `collectionType = 4` |
| **`issue`** (new, `object`: `volume`, `number`, `date`) | hidden | `parentCollectionType ∋ 4` → visible; `number` and `date` **required, record only** |
| `textualMaterialCodes` (105) | hidden | `a b` → visible |
| `corporateBodies[].name`, `electronicLocation[].url` | required (draft + record) inside each entry | — (an entry without them means nothing) |
| v1 `levels: ['main']` fields: `collectionType`, `isbn`, `ismn`, `textualMaterialCodes`, `titleByAnotherAuthor`, `authors`, `corporateBodies`, `edition`, `cartographicMathematicalData`, `musicEditionStatement` | — | **(as built, decided 2026-09-24)** hidden when `parentCollectionType ∋ 4` (an issue of a serial), as the last rule so it wins over the material-type rules. Not for other children: a book inside a collection keeps its authors. **(2026-09-25)** v2 has no main/child level at all; the archive app drops its switch |
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
- [x] Accent-insensitive matching inside OpenSearch (`asciifolding` + reindex):
      suggest filters accent-insensitively, but `Niksic` still finds nothing.
      Skipped on 2026-09-24. **Planned 2026-09-25** as backend B12 — the data
      is wiped and reindexed anyway.

- [ ] The rule table above — confirm with the library, especially what is
      required for which material type.
- [ ] `collectionType` values `2` and `5+`: unused today? (The web
      [collection views](../../frontend/plans/collection-views.md) plan has the
      same question.)
- [x] Parse `extent` out of COBISS `physicalDescription` (`"253 str."`,
      `"1 video disk (95 min)"`) on import? **Yes, planned 2026-09-25** as
      backend B11: editing a RECORD is now checked, so an imported book without
      `extent` could not be edited until someone typed it in.
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
