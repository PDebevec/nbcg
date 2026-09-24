# Archive app → metadata schema v2: migration guide

## Status: PLANNED (2026-09-23) — can start once the backend ships `GET /api/schema/v2/record`

For whoever maintains the desktop archive application (runs at the client on
`nbcg-dc`, source not in this repo). It already builds its whole metadata
editor from `GET /api/schema/record` (v1). This guide says what to change so
it uses [schema v2](metadata-schema-v2.md): dynamic fields, typeahead hints,
searchable vocabularies and publish validation.

Nothing here assumes the app's language or UI toolkit; the algorithms are given
as pseudo-code, and the TypeScript reference implementation plus a conformance
fixture are in the backend (paths below).

---

## Compatibility promise from the backend

- **v1 (`/api/schema/record`) does not change** and keeps working until the app
  confirms it runs on v2. Nothing forces a same-day upgrade at the client.
- v2 is additive in meaning: every v1 field still exists under the same `key`
  and the stored metadata JSON is the same shape — except the fields that are
  **new** (`extent`, `issue`, `keywords`, `summaryNote`) and the field type
  that is **new** (`quantity`).
- **One behavioural change is not opt-in:** publishing (DRAFT → RECORD) is
  validated for every client once v2 ships — see step 7. If the app creates items
  directly as `targetState: "RECORD"`, it will start receiving `400
  PUBLISH_VALIDATION_FAILED` for incomplete metadata even while it still reads
  v1. **Check which `targetState` the app sends before the backend release.**

---

## Step by step

### 1. Fetch v2 once, cache with the ETag

```text
GET /api/schema/v2/record
If-None-Match: <etag from last time>     → 304: reuse the cached copy
```

Persist the body + ETag locally (the app can start offline with the last copy).
Do not rely on `max-age`; always revalidate on startup.

### 2. Build the form from `groups` + `fields`

- Sections = `groups` sorted by `order`; fields in a group sorted by `order`.
- Field caption = `label[uiLanguage]` (`en` or `cnr`); tooltip = `help`.
- Choose the widget from `input` — the backend already decided it:

| `input` | Widget |
|---|---|
| `text` / `textarea` | text box / multi-line |
| `number` | numeric box; for `type: quantity` show the evaluated `unit[uiLanguage]` as a suffix |
| `checkbox` | checkbox |
| `date` | text box accepting `YYYY`, `YYYY-MM`, `YYYY-MM-DD` |
| `select` / `multiselect` | dropdown / multi-select filled from `vocabularies[values.vocabulary].values` |
| `autocomplete` | text box with a drop-down of hints (step 4) |
| `object` | sub-panel with `objectShape`; with `multiple: true` a repeatable panel with add/remove |

What to store for an `enum` is given by `values.storeAs`:
`resolvedCode` → the whole `{ code, en, cnr }` object; `code` → only `code`.
(In v1 this was implicit — `authors[].responsibility` stored a string while
`authors[].role` stored an object.)

### 3. Evaluate the rules — on load and on every context change

Compute the **context** from the item being edited:

```text
ctx.materialType         = metadata.materialType?.code
ctx.recordType           = metadata.recordType?.code         ?? ctx.materialType?[0]
ctx.bibliographicLevel   = metadata.bibliographicLevel?.code ?? ctx.materialType?[1]
ctx.collectionType       = metadata.collectionType ?? 0
ctx.isChild              = parents is not empty
ctx.parentCollectionType = [ p.metadata.collectionType ?? 0 for p in parents ]
ctx.itemState            = "NEW" | "DRAFT" | "RECORD"
```

`parents` = the parent the user is creating this item under, or, for an
existing item, the ids in its `parent_relations` loaded with
`GET /api/search/:parentId`.

Then for every field (and recursively for `objectShape`):

```text
evaluate(field, ctx):
    s = copy of { visible, required, readOnly, unit, label, help, constraints }
    for rule in field.rules:
        if matches(rule.when, ctx):
            for (k, v) in rule.set:
                s[k] = (k == "constraints") ? merge(s.constraints, v) : v
    if not s.visible: s.required = false
    return s

matches(c, ctx):
    if "all" in c: return every(matches(x, ctx) for x in c.all)
    if "any" in c: return some(matches(x, ctx) for x in c.any)
    if "not" in c: return not matches(c.not, ctx)
    val = ctx[c.ref]
    vals = val is list ? val : [val]
    if "eq"    in c: return some(v == c.eq for v in vals)
    if "in"    in c: return some(v in c.in for v in vals)
    if "empty" in c: return isEmpty(val) == c.empty
```

Re-run it whenever the user changes `materialType`, `recordType`,
`bibliographicLevel` or `collectionType`, or picks a different parent. **Do not
re-fetch the schema.**

Test your port against the conformance fixture
`backend/src/modules/schema/rules/conformance.json` (list of
`{ context, expected: { fieldKey: { visible, required, unit } } }`). It is the
same file the backend and web frontend tests run.

### 4. Typeahead

**Free hints** — a field with `suggest` and `suggest.strict: false`:

```text
on text change (debounce ~250 ms, only if length ≥ suggest.minChars):
    GET /api + suggest.path + "&" + suggest.queryParam + "=" + urlencode(text)
    → { suggestions: [ { value, count } ] }
show value list (≤ 5); on click: put value into the box; user may keep editing
```

Nothing is enforced — the list only shows how others wrote it.
For `authors` the `value` is an object; fill `familyName`/`firstName` from it.

**Strict** — `suggest.strict: true`, or an `enum` whose vocabulary has `search`
instead of `values`: same call pattern (for a vocabulary use
`vocabularies[name].search`), but the box only accepts a clicked result. For a
vocabulary the result `value` is a `{ code, en, cnr }` — store it per `storeAs`.

Showing an existing value needs no call: a stored enum is already the full
`{ code, en, cnr }` object.

### 5. Hidden fields keep their data

If a field evaluates `visible: false` but has a value (common after a COBISS
"Get data" or after changing the material type), show it in a collapsed
**"Other fields"** section with a short note, and send it on save unchanged.
Never drop a value because a rule hid it.

### 6. Required = marker + summary, not a save blocker

Mark `required` fields with `*`, show "N required fields missing — cannot be
published yet". Saving a **draft** must still work with missing fields.

### 7. Handle publish validation

If the app publishes (transition or `targetState: RECORD`), handle:

```json
{ "statusCode": 400, "code": "PUBLISH_VALIDATION_FAILED",
  "items": [ { "id": "…", "missing": [ { "path": "extent", "label": { … } } ],
               "violations": [ … ] } ] }
```

Show the `label`s of `missing` and let the user jump to the field. Optionally
call `GET /api/items/:id/validation?target=RECORD` first to show the checklist
before the user presses Publish.

### 8. New things to support

| New | What the app needs |
|---|---|
| `type: quantity` (`extent`) | number box + unit suffix; save `{ "value": n, "unit": <evaluated unit.code> }` |
| `issue` object (`volume`, `number`, `date`) | nothing special — an `object` field; appears only for children of a serial collection (`collectionType` 4) |
| `keywords` (string × multiple + suggest) | chips/tag box with free hints |
| `collectionType` as a `select` | was a raw number input in v1 |
| `readOnly` | render disabled (e.g. `cobissId` after the item exists) |

### 9. Switch off v1

When the app runs on v2 in production, tell the backend team; `GET
/api/schema/record` is then removed (tracked in the backend plan).

---

## Also still open for the app (from before v2)

- Wire **"Get data"** to `GET /api/import/cobiss/preview/:cobissId` to prefill the
  form without creating anything — backend is done
  ([COBISS preview](../../backend/history/archive-cobiss-preview.md)). With v2,
  run the rule evaluation right after the prefill: COBISS sets `materialType`, so
  the form rearranges itself immediately.

## Checklist

- [ ] Confirm which `targetState` the app uses when creating items (before the backend release!)
- [ ] Fetch v2 with ETag/If-None-Match, persist locally
- [ ] Render from `groups`/`fields`/`input`, labels in both languages
- [ ] `storeAs` for enums
- [ ] Rule evaluator + passes `conformance.json`
- [ ] Context incl. parent (`isChild`, `parentCollectionType`)
- [ ] Free and strict typeahead (`/search/suggest`, `/search/vocabularies/:name`)
- [ ] "Other fields" section for hidden-with-value
- [ ] Required markers + "cannot be published yet" summary
- [ ] `PUBLISH_VALIDATION_FAILED` handling
- [ ] `quantity`, `issue`, `keywords`, `collectionType` select, `readOnly`
- [ ] "Get data" → COBISS preview
- [ ] Tell backend: v1 can be removed
