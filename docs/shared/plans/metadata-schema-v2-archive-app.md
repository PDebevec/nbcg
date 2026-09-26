# Archive app → metadata schema v2: migration guide

## Status: DONE (reported by the archive app 2026-09-26) — the app runs on v2; v1 removed by backend B7 the same day

For the desktop archive application (TypeScript/Vue, runs at the client on
`nbcg-dc`, source not in this repo). It builds its whole metadata editor from
`GET /api/schema/record` (v1). This guide says what to change so it uses
[schema v2](metadata-schema-v2.md): dynamic fields, draft and record rules,
typeahead hints, searchable vocabularies, validation on save.

The contract's [decisions of 2026-09-25](metadata-schema-v2.md#decisions-2026-09-25-review-against-the-archive-app)
came out of reviewing the app against the contract.

---

## What the app did before v2 (confirmed 2026-09-25)

Kept as the starting point of this guide; since 2026-09-26 the app follows the
steps below.

| | |
|---|---|
| `targetState` on create | **Both.** The operator picks Draft or Record per batch (default Draft) and can change it per item (`useProcessing.ts`). |
| Order of calls | create the item → upload its files → link it to the batch's parents (`POST /api/relations/connect`). Every item of a batch gets the batch's parents. The app stores the parent `version` that connect returns (`upload.ts`). |
| Items already on the backend | a re-upload edits the item (`PATCH`, `replaceOnBackend` in `upload.ts`); so does taking over an existing record after an id collision. Both then link with connect. |
| Deleted batch parent | the item still uploads; only the link fails and is listed (`upload.test.ts`) |
| Main/child | a hand-set level per item picks v1's `?level=main\|child` form; "child" hides 10 fields |
| Required fields | every v1-required field blocks "Go to processing", for Draft and Record alike |
| `/api/tasks` | **not called.** The app never moves an item between Draft and Record (`transitionItems` in `items.ts` exists but is unused), so task workflow v2 does not affect it. |
| "Get data" | already calls `GET /api/import/cobiss/preview/:cobissId` (`useMetadataForm.ts`). The preview's `keywords` and `summaryNote` are dropped because v1 doesn't list them — v2 fixes that. |
| Big code lists | filtered locally from the cached v1 schema (all 449 languages etc.) |

## No compatibility window

All data is test data (2026-09-25). The backend changes ship when they are
ready; until the app runs v2 its uploads may fail with a 400. On dev that is
already the case (B8–B12, 2026-09-25): a book as Record without `extent`
(which v1 cannot express), and any item — Draft too — without a material type
(v1 has `materialType` as optional). That's accepted: wipe, move the processed
batches back to "scanned", test again on v2.

v1 (`GET /api/schema/record`) stayed until the app had moved; it was deleted
on 2026-09-26 (backend B7).

---

## Step by step

### 1. Fetch the schema

```text
GET /api/schema/v2/record
If-None-Match: <etag from last time>     → 304: reuse the stored copy
```

Revalidate on every start (`Cache-Control: no-cache`); the stored copy only
saves the download. The app is always connected — there is no offline mode for
lookups (step 6).

### 2. Build the form from `groups` + `fields`

- Sections = `groups` sorted by `order`; fields in a group sorted by `order`.
- Field caption = `label[uiLanguage]` (`en` or `cnr`); tooltip = `help`.
- A new item starts with each field's `default` (`collectionType` → 0).
- Choose the widget from `input` — the backend already decided it:

| `input` | Widget |
|---|---|
| `text` / `textarea` | text box / multi-line |
| `number` | numeric box; for `type: quantity` show the evaluated `unit[uiLanguage]` as a suffix |
| `checkbox` | checkbox |
| `date` | text box accepting `YYYY`, `YYYY-MM`, `YYYY-MM-DD` |
| `select` / `multiselect` | dropdown / multi-select filled from `vocabularies[values.vocabulary].values` |
| `autocomplete` | text box with a drop-down of hints (step 6) |
| `object` | sub-panel with `objectShape`; with `multiple: true` a repeatable panel with add/remove |

What to store for an `enum` is given by `values.storeAs`: `resolvedCode` → the
whole `{ code, en, cnr }` object; `code` → only `code`. This replaces the
hard-coded special case in `metadata-wire.ts` (v1 left it implicit:
`authors[].responsibility` stored a string, `authors[].role` an object).

### 3. Copy the rule evaluator — don't port it

The app is TypeScript, so copy `backend/src/modules/schema/rules/evaluate.ts`
**verbatim** (e.g. to `src/domain/schemaRules.ts`), as the web frontend does.
Run `backend/src/modules/schema/rules/conformance.json` in the app's tests.
When the backend changes `evaluate.ts`, copy it again.

| Fixture section | Input → expected |
|---|---|
| `isEmpty` | `value` → `true`/`false` (null, blank string, `[]`, `{}` are empty) |
| `buildContext` | `metadata`, `parents` (their metadata), `itemState`, `targetState` → context values |
| `mechanics` | the rule language on synthetic fields (later rule wins, strict `4 ≠ "4"`, array any-match, `all`/`any`/`not`, constraints merge, hidden object hides its children) |
| `record` | `context` (merged over `contextDefaults`) against the fields of `GET /api/schema/v2/record` → field states |
| `check` | `metadata`, `parents`, `itemState`, `targetState` → `missing` paths and `violations` `{ path, constraint }` |

Per item:

```ts
// backendState: the item's state on the backend, from the sync; none before the first upload
const itemState   = item.backendState ?? 'NEW'              // 'NEW' | 'DRAFT' | 'RECORD'
const targetState = item.backendState ?? item.targetState   // 'DRAFT' | 'RECORD'
const ctx = buildContext(item.metadata, batchParentsMetadata, itemState, targetState)
const states = evaluateAll(schema, ctx)            // path → { visible, required, readOnly, unit, label, … }
const { missing, violations } = checkMetadata(schema, item.metadata, ctx)
```

- `batchParentsMetadata` = the metadata of the batch's parents, loaded once per
  batch with `GET /api/search/:parentId`. The rules only read their
  `collectionType`. A 404 means the parent was deleted — step 8.
- **Not uploaded yet:** `itemState` `NEW`, `targetState` = the item's
  Draft/Record choice.
- **Already on the backend:** both are the state the item has there. The
  Draft/Record choice is locked (step 7), because the backend checks every edit
  against the item's current state. `itemState` ≠ `NEW` also makes `cobissId`
  read-only.
- Re-run when the user changes `materialType`, `recordType`,
  `bibliographicLevel` or `collectionType`, switches Draft/Record, changes
  the batch's parents, or the sync brings a new backend state. **Do not
  re-fetch the schema.**

### 4. Remove the main/child switch

v2 has no levels. Whether an item is a child, and a child of what, comes only
from its parents — for the archive app, the batch's parents. The 10 fields v1
hid on every "child" (collection type, ISBN, ISMN, textual-material codes,
title by another author, authors, organisations, edition, map scale, music
edition) are hidden only when a parent is a **Serial collection**
(`collectionType` 4):

| The item | Batch parent | v2 form |
|---|---|---|
| a book | none | full form |
| *Pobjeda*, no. 1234, 12 Mar 1950 | *Pobjeda* (Serial collection) | the 10 fields hidden, issue number/date shown |
| a 1910 map of Cetinje | "Old maps of Montenegro" (Collection) | full form: its own author and scale |
| a book | "Books from King Nikola's library" (Collection) | full form: its own author and ISBN |

Delete the switch. Anything else that reads it reads the batch's parents
instead — e.g. which ingestion case the editor suggests (`provenance.ts`):
"child" = the batch has parents; case 4 = a parent is a Serial collection
(`collectionType` 4).

### 5. Hidden fields keep their data

If a field evaluates `visible: false` but has a value (common after "Get data"
or after changing the material type), show it in a collapsed **"Other fields"**
section with a short note, and send it unchanged. Never drop a value because a
rule hid it.

### 6. Typeahead — always online

Nothing big is sent whole: lists of ≤ 50 values come inline (step 2),
everything else is asked for as the user types.

**Free hints** — a field with `suggest` and `suggest.strict: false` (keywords,
publisher, place, edition, dimensions, author names, …):

```text
on text change (debounce ~250 ms, only if length ≥ suggest.minChars):
    GET /api + suggest.path + "&" + suggest.queryParam + "=" + urlencode(text)
    → { suggestions: [ { value, count } ] }
show the values (≤ 5); on click: put the value into the box; the user may keep editing
```

Nothing is enforced — the list only shows how others wrote it. For `authors`
the `value` is an object; fill `familyName`/`firstName` from it. Matching is
from the start of the text (`comp` finds `computers`, `comu` does not).

**Strict** — `suggest.strict: true`, or an `enum` whose vocabulary has
`search` instead of `values` (`language` 449, `relator` 116, `contentType` 69):
same call pattern (for a vocabulary use `vocabularies[name].search`), but the
box only accepts a clicked result. The result `value` is a `{ code, en, cnr }` —
store it per `storeAs`. Showing a stored value needs no call.

### 7. What blocks an item

Run `checkMetadata` with the context from step 3. Anything in
`missing` or `violations` → the item cannot go to processing. What that means
comes from the schema, not from the app:

- **Draft:** title, material type, collection type (prefilled 0), a name in each
  organisation entry, a URL in each link entry, and every value in a valid
  format.
- **Record:** all of that, plus extent (books, video, sound), map scale (maps),
  issue number and date (issues of a serial).

Check again right before upload (`metadata.isReady(item)` in
`useProcessing.ts`) — before the first upload the Draft/Record choice can still
change.

**The Draft/Record choice exists only for new items.** Once the item is on the
backend the toggle is locked and shows the backend state; a re-upload never
changes it. Moving an item between Draft and Record is done in the web app, and
the app picks the new state up through its sync. Example: a book uploaded as
Record, then edited in the app with its page count cleared, is blocked in the
app — it does not reach the backend and bounce with a 400.

Optional: for a Draft item, also evaluate with `'RECORD'` and show "N more
fields needed to publish" without blocking.

### 8. Upload

**A new item** — create it with its parents:

```text
POST /api/items
{ "visibilityStatus": "…", "targetState": "DRAFT" | "RECORD",
  "metadata": { … }, "parentIds": [ …the batch's parents ] }
→ 201 { …the item…, "parents": [ { "parentId", "version", "childrenInDrafts", "childrenInRecords" } ] }
```

The backend checks the item with those parents and creates the links in the
same transaction (backend B10). Then upload the files. No separate
`POST /api/relations/connect` for items this upload creates. Linking changes
the parent, so the app's account needs manage rights on each parent's
collection, the same as for connect today (otherwise 403).

Store each `parents[].version` on the local parent, as the app does today with
connect's answer — otherwise the next edit of that parent fails with a 409. If
uploads run in parallel, keep the highest version seen per parent (answers can
arrive out of order).

**An item already on the backend** — a re-upload (`replaceOnBackend`) or a
record taken over after an id collision — works as today: `PATCH` the item
(checked against its backend state, step 7), then link it with
`POST /api/relations/connect` and store the returned version. Linking a parent
the item already has adds nothing. From backend B9, connect also re-checks the
item with its parents after the link.

**A deleted parent stops the batch.** The parent is gone for every item of the
batch, so none of them can upload:

- *Before processing:* the parent load in step 3 returns 404 → block the whole
  batch.
- *At upload* (deleted in the meantime): create or connect returns
  `400 PARENT_NOT_FOUND` with the missing ids in `parentIds`. Stop the batch —
  don't try the remaining items.

Either way show one message naming the parent, e.g. *"The parent 'Old maps of
Montenegro' no longer exists. Change or remove it in this batch, then upload
again."* Items uploaded before it stopped are on the backend; the next upload
treats them as re-uploads.

### 9. Handle `METADATA_VALIDATION_FAILED`

Rare once step 7 runs, but the backend has the last word:

```json
{ "statusCode": 400, "code": "METADATA_VALIDATION_FAILED",
  "message": "1 of 1 item is not ready to publish",
  "items": [ { "id": null, "state": "RECORD",
               "missing": [ { "path": "extent", "label": { … } } ],
               "violations": [ { "path": "publication.year", "label": { … },
                                 "constraint": "pattern", "hint": { … } } ] } ] }
```

A field is either missing or has a violation, never both — an empty field is
not format-checked. `id` is `null` on create (nothing was created), the item's
id on a re-upload. `state` says whose rules failed. Paths inside repeatable objects carry the index:
`corporateBodies[1].name`. Show the `label`s and let the user jump to the
field. (Until backend B9 — on dev since 2026-09-25 — the code was
`PUBLISH_VALIDATION_FAILED`, without `state`, and only for Record.)
`PARENT_NOT_FOUND` is a different error — step 8.

### 10. New things to support

| New | What the app needs |
|---|---|
| `type: quantity` (`extent`) | number box + unit suffix; save `{ "value": n, "unit": <evaluated unit.code> }` (integer ≥ 0). A stored unit that no longer matches the evaluated one is a violation (`constraint: "unit"`) |
| `summaryNote` (text) | the summary (COMARC 330); "Get data" fills it |
| `issue` object (`volume`, `number`, `date`) | nothing special — an `object` field; shown only under a Serial collection |
| `keywords` (string × multiple + suggest) | chips/tag box with free hints; "Get data" fills it |
| `collectionType` | a dropdown (was a raw number in v1), `default: 0`, values are numbers (`storeAs: "code"`) |
| Relator roles | searched via `/api/search/vocabularies/relator`; codes are COMARC numeric (`070` = author) |
| `readOnly` | render disabled (e.g. `cobissId` after the item exists) |

### 11. Switch off v1

When the app runs on v2, tell the backend side; `GET /api/schema/record` is
then removed (backend B7). **Done 2026-09-26.**

---

## Checklist

All done — reported by the archive app on 2026-09-26 ("v1 can go").

- [x] Which `targetState` the app sends — both (2026-09-25)
- [x] Does the app call `/api/tasks` — no (2026-09-25)
- [x] "Get data" → COBISS preview — done
- [x] Fetch v2 with ETag/If-None-Match, revalidate on start
- [x] Render from `groups`/`fields`/`input`, labels in both languages, `default`
- [x] `storeAs` for enums (drop the `metadata-wire.ts` special case)
- [x] `evaluate.ts` copied verbatim + `conformance.json` passing
- [x] Context from the batch's parents; Draft/Record choice before the first upload, the backend state after
- [x] Draft/Record toggle locked once the item is on the backend
- [x] Main/child switch removed; the ingestion-case suggestion reads the batch's parents
- [x] "Other fields" section for hidden-with-value
- [x] Free and strict typeahead (`/search/suggest`, `/search/vocabularies/:name`)
- [x] Processing blocked by `checkMetadata` for the item's state; re-checked before upload
- [x] New items: create with `parentIds`, no connect; store `parents[].version` (highest wins)
- [x] Re-uploads and taken-over records: `PATCH` + connect, as today
- [x] Deleted parent: batch blocked (404 on load, `PARENT_NOT_FOUND` on upload), one message
- [x] `METADATA_VALIDATION_FAILED` handling
- [x] `quantity`, `issue`, `keywords`, `summaryNote`, `collectionType` dropdown, `readOnly`
- [x] Tell the backend: v1 can be removed
