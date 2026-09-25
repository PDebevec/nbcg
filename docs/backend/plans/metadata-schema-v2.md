# Backend: metadata schema v2

## Status: B1–B6 DONE (2026-09-24) · B8–B12 DONE (2026-09-25, dev) · B7 waits for the archive app

**Not yet deployed to production.** No release ordering is needed any more: all
data is test data (2026-09-25) — see [Deploy notes](#deploy-notes). B1–B7 below
"Phases" is the original plan, each phase marked with what was actually done;
B8–B12 come from the [contract decisions of 2026-09-25](../../shared/plans/metadata-schema-v2.md#decisions-2026-09-25-review-against-the-archive-app)
(review against the archive app) and were built the same day — see
[Done — B8–B12](#done--b8b12-2026-09-25).

The contract is in [shared/plans/metadata-schema-v2.md](../../shared/plans/metadata-schema-v2.md)
— read it first; this file is only "what changes in NestJS and in which order".
Related: [web frontend plan](../../frontend/plans/metadata-schema-v2.md),
[archive app migration](../../shared/plans/metadata-schema-v2-archive-app.md).

---

## Current state (verified 2026-09-23)

| What | Where | Notes |
|---|---|---|
| v1 field list | `src/modules/schema/schema.service.ts` → `buildRecordFields()` | hand-written, ~45 fields, no labels, no conditions |
| v1 types | `src/modules/schema/schema.types.ts` | `FieldDescriptor` |
| v1 route | `src/modules/schema/schema.controller.ts` | `GET /schema/record?level=main\|child`, in-memory ETag cache, `Cache-Control: public, max-age=86400` |
| Code lists | `src/modules/import/cobiss/cobiss-util/cobiss-code-map.ts` | sizes: language 449, relator 116, contentType 69, literaryForm 35, country 28, materialType 25, illustration 16, recordType 14, bibliographicLevel 6, biography 5 |
| What the API accepts | `DOMAIN_RECORD_SHAPE` in `cobiss.types.ts` + `EDITABLE_BASE_METADATA_SHAPE` in `core/types/metadata.types.ts` | unknown keys are **silently dropped**; a known key sent as `null` is removed on `PATCH` and ignored on create (since `cd8e5bd`) |
| Required check | `REQUIRED_METADATA_VALIDATORS` in `items.service.ts` | only `title`, on create |
| Suggest | `src/modules/search/suggest-fields.ts` + `search.service.ts#suggest` | terms agg over `.keyword`, count-ordered |
| Publish | `ItemsService.transition()` | one transaction, all-or-nothing; closes REVIEW_PUBLISH tasks |
| Import | `import-queue.processor.ts` | writes `tx.draft/record.create` directly — does **not** go through `ItemsService` |
| OpenSearch mapping | `infrastructure/docker/pgsync/schema.json` | `metadata` is a dynamic `object`; new keys map themselves (text + `.keyword`) |

### Bug found while planning — moot since `cd8e5bd`

The web editor saved `metadata.summaryNote` (its "Summary" textarea, shown on
the public record page), but `summaryNote` is not in `DOMAIN_RECORD_SHAPE`, so
**the API dropped it on every save without an error**. Anything typed there was
never stored. Fix: add `summaryNote?: string` (COMARC 330/a) to
`DomainRecord` + `DOMAIN_RECORD_SHAPE` (`str`). The v2 self-check below makes
this class of bug impossible to reintroduce.

**Update 2026-09-24:** `cd8e5bd` made the web `DomainRecord` mirror
`cobiss.types.ts` exactly and removed the Summary field from the editor and the
record page. Nothing is lost any more, but there is also nowhere to enter a
summary. Adding `summaryNote` is now an ordinary new field in B3, and the web
editor must add its field back when B3 lands.

---

## Done — what was built (2026-09-24)

### Decisions made while building (asked 2026-09-24)

| Question | Decision |
|---|---|
| Enforce `materialType` on publish now? Title-only items could be published before. | **Yes**, as the contract says. The API suite's publishable fixtures got a material type (`PUBLISHABLE` snippet). |
| How to map `issue.date` in OpenSearch? Dynamic mapping makes it `date` or `text` depending on the first document indexed. | **`keyword`**, declared in `pgsync/schema.json`. The field did not exist yet, so live indices only need a one-off `PUT _mapping`, no reindex. |
| Accent-insensitive matching inside OpenSearch (`asciifolding` + reindex)? | **Skipped for now.** The suggest post-filter is accent-insensitive, but OpenSearch still does not return `Nikšić` for `Niksic`. |
| Merge the web editor's interim visibility rules into the v2 rule table? | **No**, contract table only; stays an open question for the library. |
| How do v1's `levels: ['main']` become rules? Hiding for every child would take authors, ISBN etc. from a book inside a collection. | **Hidden only under a serial** (`parentCollectionType ∋ 4`) — as the last rule of each of those 10 fields, so it wins. Children of other collections keep them. |

### Where it is (`backend/src/modules/schema/`)

| File | What |
|---|---|
| `v2/schema-v2.types.ts` | `SchemaV2`, `FieldV2`, `ContextKey`, `Vocabulary`, … as in the contract |
| `v2/vocabularies.ts` | Registry: 10 COBISS lists + `collectionType`, `responsibility`, `extentUnit`; `INLINE_VOCABULARY_MAX = 50` |
| `v2/labels.ts` | `{ en, cnr }` captions; `NEW` marks the ones that need a Montenegrin check (list in [reference](../reference.md#schema-v2)) |
| `v2/record-fields.ts` | The field list and the rule table — data only |
| `v2/build-schema.ts` | Computes `input` and `order`, attaches labels |
| `v2/self-check.ts` | The boot-time/jest self-check (below) |
| `v2/vocabulary-search.ts` | B5 in-memory search |
| `rules/evaluate.ts` | Portable evaluator: `buildContext`, `isEmpty`, `matches`, `evaluateField`, `evaluateAll`, **`checkMetadata`** (the publish check itself — so the web banner and the backend 400 run the same code) |
| `rules/conformance.json` | 10 `isEmpty`, 4 `buildContext`, 12 rule-language, 21 record-table and 9 publish-check cases |
| `publish-validator.service.ts` | B6: `validate`, `check` (no DB), `assertPublishable` — **renamed `metadata-validator.service.ts` / `assertValid` in B9** |

Outside the module: `METADATA_VALIDATORS` moved from `items.service.ts` to
`core/types/metadata.types.ts` (the self-check needs it);
`shared/util/text-match.ts` (`normalizeForMatch`, `rankByQuery`) serves both the
suggest post-filter and vocabulary search.

### Deviations from the plan below, and why

- **`checkMetadata` lives in the portable `evaluate.ts`**, not only in the
  service. The plan had the service "walk the metadata"; putting the walk next
  to the evaluator means the web editor's "N required fields missing" is the
  same function as the backend's publish check.
- **`isEmpty` also treats a blank string and `{}` as empty** (the contract said
  `""` and `[]`), so `"   "` does not satisfy a required field.
- **Violations carry more** than the contract example: `{ path, label,
  constraint, limit?, hint? }`, and a `quantity` whose stored unit differs from
  the evaluated one is a `unit` violation (`extent` in pages on a video) —
  contract editor rule 3 made enforceable.
- **Import warnings go to `progress.warnings`**, not `progress.errors`:
  `errors` pairs with the `failed` count, and these items were imported.
- **`extentUnit` values**: `pages` (p./str.), `sheets` (sheets/list.),
  `volumes` (vols/sv.), `items` (items/kom.), `minutes` (min). Defined next to
  the COBISS code lists in `cobiss-code-map.ts`, because the validator in
  `cobiss.types.ts` checks against them.
- **Map scale caption** is "Razmjera" (the web frontend's word), not "Merilo".
- **`summaryNote` from COBISS**: repeated 330 fields are joined with a blank line.
- **No `collectionType` default in the schema**: the contract's `Field` has no
  `default`; `POST /items` still defaults it to 0. (B8 adds `default: 0`,
  decided 2026-09-25.)

### Tests

- Jest (`npx jest`): `rules/evaluate.spec.ts` (the whole fixture + frontend-copy
  identity, skipped until `frontend/src/utils/schemaRules.ts` exists),
  `v2/self-check.spec.ts` (the shipped schema passes; each failure mode is
  caught; `input`/`storeAs`/labels), `v2/vocabulary-search.spec.ts`,
  `publish-validator.service.spec.ts`, `cobiss-parser.spec.ts` (610/330), and
  8 new suggest cases in `search.service.spec.ts`. 183 pass.
- API suite: new **section 19** in `backend/test/api-test-suite.sh` (122
  checks: schema per persona, ETag/304/`no-cache`, v1 frozen, shape, every
  advertised suggest/vocabulary path answers, vocabulary search, new fields and
  their write validation, suggest sibling filter + new allowlist fields,
  publish validation incl. bulk all-or-nothing / create-as-RECORD / serial
  issue / unit violation / PATCH not validated, validation endpoint access,
  COBISS import warning, `issue.date` mapping). 530/530 pass on dev.

## Done — B8–B12 (2026-09-25)

### What changed where

| Phase | Where |
|---|---|
| B8 draft/record rules | `rules/evaluate.ts`: `TargetState`, `buildContext(metadata, parents, itemState, targetState)`. `v2/record-fields.ts`: context key `targetState`, `FOR_RECORD` helper, `extent` / map scale / `issue.number` / `issue.date` required only `FOR_RECORD`, `collectionType` `default: 0`, 207 no longer `issueIdentifying`. `FieldV2.default` (`null` when absent), built in `v2/build-schema.ts`, checked in `v2/self-check.ts` |
| B9 every write | `publish-validator.service.ts` → **`metadata-validator.service.ts`** (`MetadataValidatorService`): `validate` / `check` / `assertValid`, items carry `itemState` + `targetState` (+ optional `parents`); `assertStoredValid(ids, tx)` re-checks stored items in their current state. `ItemsService`: `create` (both targets; `REQUIRED_METADATA_VALIDATORS` deleted), `update` (metadata PATCH, inside the transaction), `transition` (both directions), `validation(id, target)`. `RelationsService.connect` / `disconnect`: one transaction with the re-check and the parent's revision. Import worker: warning per target |
| B10 `parentIds` | `CreateItemDto.parentIds`; `RelationsService.resolveParents` (→ `PARENT_NOT_FOUND`) and `linkNewChild(tx, …)`; `ResourceAccessService.assertCanManageParents` (manage rights on every parent, `PARENT_NOT_FOUND` for a missing one — also used by `relations/connect`); `shared/errors/parent-not-found.ts` |
| B11 `extent` from 215 | `parseExtent` in `cobiss-parser.ts`, called for 215/a |
| B12 accent folding | `setting` block in `infrastructure/docker/pgsync/schema.json` (both indices) |

### Deviations from the plan, and why

- **B12 is a `default` analyzer, not an `asciifolding` sub-field.** A sub-field
  would have needed every search and suggest query to name it; a folding
  default analyzer (`lowercase` + `asciifolding` with `preserve_original`)
  makes every `text` field match `Niksic` ↔ `Nikšić` with no query change, and
  keeps exact accented matches scoring higher. `.keyword` is untouched.
- **`parentIds` needs manage rights on each parent** (not in the plan):
  linking bumps the parent's version and writes its timeline, which
  `relations/connect` already guards with `assertCanManage` on the parent. A
  cataloguer cannot hang a draft under a RECORD. The same check
  (`assertCanManageParents`) now serves `connect`, so an unknown parent is
  `PARENT_NOT_FOUND` there too (it was a `404 Item not found` from the access
  check, before the service ever ran), and anonymous gets 401 first.
- **Relation revisions are written in the relation's transaction** (`record`
  with `tx`), no longer `recordDetached` after the fact: the edge is now
  committed together with the re-check, so the timeline can be too.
- **`disconnect` re-checks the children as well.** The plan said so; worth
  noting that it can fail: an issue whose `collectionType` was cleared while
  its serial parent hid it cannot leave the serial until it has one again.
- **`message`**: "N of M items are not ready to publish" when every failing
  item is a RECORD, "N of M items cannot be saved" otherwise (singular "1 of 1
  item is / item cannot be saved").
- **Import warnings for drafts too**: `target: DRAFT` imports are checked
  against the draft rules and listed the same way ("Imported as a draft, but
  would not pass validation: …"). COBISS records always carry a title and a
  material type, so this rarely fires.
- **B11 heuristics** (215/a is free text): pages = the largest arabic number
  (bracketed unnumbered pages only when there is nothing else; a leading
  volume count `2 sv.` / `2 knj.` gives nothing); minutes from `95 min`,
  `1 h 35 min`, `2 sata`; sheets from a number before a map / graphics word
  (`zemljovid`, `karta`, `plan`, `list`, `plakat`, `fotografija`, …). A unit
  that does not fit the material type leaves `extent` empty.

### Tests

- Jest (`npx jest`): 265 pass, 1 skipped (the frontend-copy identity, until
  `frontend/src/utils/schemaRules.ts` exists). New: `conformance.json` has 5
  `buildContext`, 25 record-table and 18 check cases (draft and record);
  `metadata-validator.service.spec.ts` (state, messages, given parents,
  `assertStoredValid`); self-check cases for `default`; 22 `parseExtent` cases
  in `cobiss-parser.spec.ts`.
- API suite (`backend/test/api-test-suite.sh`): every fixture carries
  `DRAFTABLE` (a material type); section 19 rewritten — 19e validation on save
  (draft/record, PATCH, both transition directions, a record damaged through
  SQL for the visibility-only case), 19g `parentIds` / `PARENT_NOT_FOUND` /
  relation re-checks / parent rights, 19i accent folding (search, suggest,
  live index settings). **689 pass, 0 fail** on dev (4 skipped: pgsync-lag
  warnings in 7b, unrelated). Repeat runs against a `nest start --watch`
  process that had stopped reloading failed 11 tests in §18/§19i with a 500;
  after restarting it, **691 pass, 1 fail** — the fail is §14 "Viewed item
  appears in top items", crowded out of the top 10 by items earlier suite runs
  deleted ([usage metrics outlive their items](usage-metrics-orphans.md), a
  known open issue, not this work).

### Deploy notes

**Rewritten 2026-09-25.** All data is test data, so no release ordering: the web
editor and the archive app may be unable to publish some types until they are
on v2, and that's accepted. (Was: web first; confirm the archive app's
`targetState` — it sends both.) Rollout (B8–B12 are on dev since 2026-09-25;
the dev indices were already rebuilt with B12's analyzer, the dev items were
not wiped):

1. Wipe the items (drafts, records, relations, files, revisions, tasks) and the
   OpenSearch indices; recreate the indices with B12's analyzer and the
   `metadata.issue.date` = `keyword` mapping, following
   [opensearch-reindex.md](../../infrastructure/opensearch-reindex.md).
2. Import **a few examples**, not everything: e.g. a book, a map, a video or
   sound recording, a Serial collection with two issues, a Collection with a
   book and a map inside. Enough to try every rule by hand.
3. The archive app moves its processed batches back to "scanned" and uploads
   again once it runs v2.
4. The Montenegrin captions marked `NEW` should be checked by the library.

---

## Phases

Each phase ships on its own and leaves v1 untouched.

### B1 — v2 skeleton: types, labels, vocabularies, route (M) — DONE

- `schema/v2/schema-v2.types.ts` — `SchemaV2`, `FieldV2`, `Rule`, `Condition`,
  `ContextKey`, `Vocabulary`, `Label` exactly as in the contract.
- `schema/v2/vocabularies.ts` — registry `name → { values, storeAs default }`
  built from the `getAll*Codes()` functions; `INLINE_VOCABULARY_MAX = 50`
  decides `values` vs `search`. Add a `collectionType` vocabulary (0/1/3/4 with
  labels) and an `extentUnit` one (`pages`, `minutes`, `sheets`, …).
- `schema/v2/labels.ts` — `{ en, cnr }` for every field and group. Start from
  the web frontend's `src/i18n/*/index.ts` (`admin.edit.fields.*`) where a label
  already exists; the rest are new and need a Montenegrin check.
- `schema/v2/record-fields.ts` — the v2 field list: every v1 field (same
  `key`s), plus `type`/`multiple`/`values.storeAs` made explicit. `input` is
  **computed** by the builder from type + values + suggest (table in the
  contract), never hand-written.
- `GET /schema/v2/record` on the existing `SchemaController`: same ETag
  mechanism, but `Cache-Control: no-cache`. No `level` param — `levels` become
  rules on `isChild`.
- **Self-check** (runs in a jest spec *and* once at module init, throwing on
  failure so a bad schema cannot boot):
  - every field key (recursively) is accepted by `METADATA_VALIDATORS` — the
    schema may never advertise a field the API silently drops;
  - every `rule.when.ref` is a declared context key;
  - every `values.vocabulary` exists;
  - every `suggest.path` names a field present in `SUGGEST_FIELDS`;
  - `(type, multiple, storeAs)` agrees with the validator's shape.

v1 keeps its own `buildRecordFields()` unchanged. Deriving v1 from v2 is
tempting but would risk the frozen contract for nothing — v1 is deleted in B7.

### B2 — rule evaluator + conformance fixture (S) — DONE

- `schema/rules/evaluate.ts` — pure functions `matches(cond, ctx)`,
  `evaluateField(field, ctx)`, `evaluateAll(schema, ctx)`, `buildContext(metadata,
  parents, itemState)`, `isEmpty(value)`. No Nest, no Prisma, no imports outside
  the file — it is **copied verbatim** to the web frontend
  (`frontend/src/utils/schemaRules.ts`).
- `schema/rules/conformance.json` — ~30 cases: book / video / map / collection /
  child of serial / missing material type / array `parentCollectionType` /
  later-rule-wins / hidden-is-never-required.
- `schema/rules/evaluate.spec.ts` — runs the fixture; plus one test that the
  frontend copy is byte-identical to this file (skipped if `../frontend` is
  absent), so the two cannot drift.

### B3 — new metadata fields (S) — DONE (`issue.date` declared `keyword`)

In `DomainRecord` / `DOMAIN_RECORD_SHAPE` and in the v2 field list:

| Field | Validator | Notes |
|---|---|---|
| `summaryNote` | `str` | COMARC 330/a; the former bug above. The web editor needs its Summary field back (removed in `cd8e5bd`) |
| `extent` | new `quantity`: `{ value: int ≥ 0, unit: string }` | unit checked against `extentUnit` codes |
| `issue` | `sanitizeObj({ volume: str, number: str, date: partialDate })` | `partialDate` = `YYYY`, `YYYY-MM` or `YYYY-MM-DD` |
| `keywords` | `arrOf(str)` | COMARC 610/a; also parse 610 in `cobiss-parser.ts` |

OpenSearch picks the new keys up by dynamic mapping. **Check** what dynamic date
detection does to `issue.date` on the first indexed document; if it becomes a
`date` field, a later `"1905"` must still parse. Safer: declare
`metadata.issue.date` as `keyword` in the pgsync mapping — that needs the
[reindex procedure](../../infrastructure/opensearch-reindex.md).

### B4 — suggest fixes (S) — DONE (without the optional `asciifolding`)

- Add allowlist entries for every `suggest` in the v2 field list:
  `placeOfManufacture`, `manufacturerName`, `corporateBody`, `keywords`,
  `dimensions`, `physicalDescription` (`publisher`, `place`, `seriesTitle`,
  `edition`, `author` exist).
- **Array fields return non-matching siblings** (a document with notes
  `["Foo", "Bar"]` matched by `q=Fo` also contributes the bucket `Bar`). Fix:
  request `limit × 5` buckets and keep only keys whose normalised form starts
  with (then contains) the normalised `q`; trim to `limit`.
- Normalise in that filter with NFD + strip combining marks + lowercase, so the
  post-filter is accent-insensitive.
- Accent-insensitive **matching** in OpenSearch itself (`Niksic` → `Nikšić`)
  needs an `asciifolding` sub-field in the pgsync mapping + reindex. Optional;
  do it together with the `issue.date` mapping if that is done.

### B5 — vocabulary search (S) — DONE

`GET /search/vocabularies/:name?q=&limit=5` in `SearchController` (declare it
above `:id`, like `suggest`). In-memory index built once from the vocabulary
registry; match `code`, `en`, `cnr` normalised as above; prefix matches first,
then substring; response `{ field: name, suggestions: [{ value }] }`. Unknown
name → 404. Public, like `/schema`.

### B6 — publish validation (M) — DONE (not deployed; see Deploy notes)

- `schema/publish-validator.service.ts` (exported from `SchemaModule`):
  `validate(items: { id, metadata }[]): Promise<ValidationResult[]>` —
  builds each item's context (one batched query for all parents'
  `collectionType` via `item_relations` → `drafts`/`records`), runs
  `evaluateAll`, walks the metadata collecting `missing` (visible + required +
  empty) and `violations` (`constraints`).
- Call it in `ItemsService.transition()` when `targetState === RECORD`, **inside
  the transaction, before any row moves**; any failure → `BadRequestException({
  statusCode: 400, code: 'PUBLISH_VALIDATION_FAILED', message, items })`.
- Call it in `ItemsService.create()` when `targetState === RECORD`.
- Not called: draft create/update, PATCH of a record, the import worker (it
  bypasses `ItemsService` anyway — keep it that way and report would-fail items
  in the job's `progress.errors` as warnings instead). **Superseded by B9
  (built 2026-09-25):** only the import worker stays unchecked, and the service
  is now `MetadataValidatorService`.
- `GET /items/:id/validation?target=RECORD` → `200 { ok, missing, violations }`;
  gated like reading the item (`assertCanView`, 404 for hidden).
- The task workflow's "complete REVIEW_PUBLISH" goes through `transition()`, so
  it gets this for free — confirmed when task workflow v2 was built
  (2026-09-25; §18 of the API suite completes a review of an incomplete draft).

### B7 — retire v1 (XS, later) — OPEN, waits for the archive app

After the archive app confirms it runs on v2: delete `buildRecordFields()`,
`FieldDescriptor`, `RecordSchemaQueryDto`, the v1 route and its tests; update
the reference.

### B8 — `targetState`: draft and record rules (S) — DONE (2026-09-25)

- `v2/record-fields.ts`: context key `targetState` (`DRAFT | RECORD`, source
  `item`); `itemState` description "where the item is now". Helper
  `FOR_RECORD: Condition = { ref: 'targetState', eq: 'RECORD' }`.
- Rule table (contract "Initial rule set"):
  - `extent`: the required rule becomes `all [collectionType = 0, recordType ∈ a b g i j, FOR_RECORD]`.
  - `cartographicMathematicalData`: the `e f` rule keeps `visible`/`label`/`help`;
    a separate `all [e f, FOR_RECORD] → required`. `HIDE_UNDER_SERIAL` stays last.
  - `issue.number`, `issue.date`: base `required: false`, rule `FOR_RECORD → required`.
  - Unchanged, and now also enforced on drafts (B9): `title`, `materialType`,
    `collectionType`, `corporateBodies[].name`, `electronicLocation[].url`.
  - `numberingAndDates`: drop `issueIdentifying`.
- `default` on a field: `FieldSpec`/`FieldV2` + contract; `collectionType`
  gets `default: 0`. Self-check: a `default` is a valid value of its field
  (a vocabulary code for an enum).
- `rules/evaluate.ts`: `TargetState` type; `buildContext(metadata, parents,
  itemState, targetState)`. Callers pass it (B9).
- `conformance.json`: `buildContext` with `targetState`; `record` cases for a
  book / map / serial issue evaluated as DRAFT and as RECORD; `check` cases:
  draft without material type → missing; draft book without `extent` → ok;
  record book without `extent` → missing; draft issue without `issue.number` →
  ok. Every existing case gets `targetState: RECORD` (what B6 checked).

### B9 — check every write (M) — DONE (2026-09-25)

- Rename `PublishValidatorService` → `MetadataValidatorService`
  (`metadata-validator.service.ts`); `assertValid(items, db)` where each item
  carries its `targetState`. Error `code` becomes `METADATA_VALIDATION_FAILED`,
  each failing item carries `state` (the rules it failed); `message` "…not
  ready to publish" when all failing items are RECORDs, "…cannot be saved"
  otherwise.
- `ItemsService.create()`: check for both targets (DRAFT too). The title check
  in `REQUIRED_METADATA_VALIDATORS` goes — `title` is `required` in the schema.
  The shape check (`METADATA_VALIDATORS`, plain 400) runs first, as now.
- `ItemsService.update()`: when `metadata` is in the payload, check the stored
  metadata with the patch applied (nulls removed), against the item's current
  state, parents from `item_relations`, inside the transaction. A
  visibility-only PATCH is not checked.
- `ItemsService.transition()`: check against the target for **both**
  directions (RECORD → DRAFT uses the draft rules).
- `RelationsService.connect()` / `disconnect()`: inside one transaction, write
  the relation change, then check every child in its current state with its
  parents *after* the change; any failure → roll back, 400. Not re-checked:
  children when a parent's metadata changes or the parent is deleted (contract
  "Validation on save").
- `GET /items/:id/validation?target=DRAFT|RECORD` (DTO accepts both).
- Import worker unchanged: warnings for items that fail their target's rules.
- Docs when built: `reference.md` (endpoint + error shape), the backend and
  shared task-workflow docs (they name `PUBLISH_VALIDATION_FAILED`),
  `shared/metadata-fields.md` — **updated 2026-09-25**.

### B10 — `parentIds` on `POST /items` (S) — DONE (2026-09-25)

- `CreateItemDto.parentIds?: string[]` (`IsArray`, `IsString({ each })`,
  deduplicated).
- `create()`: load the parents' metadata — an unknown id → `400 { code:
  "PARENT_NOT_FOUND", message: "Parent not found: …", parentIds: [missing] }`,
  nothing created — run the B9 check with them, then create the item, the relations
  and the revisions (`CREATE` on the item, `RELATION_ADDED` on each parent) in
  one transaction. `RelationsService` gets a variant that takes the transaction
  client; no cycle check needed for a brand-new item.
- Response: the item as now, plus `parents: RelationWriteResult[]` (each
  parent's new `version` and children counts — what `connect` returns), so the
  archive app does not re-read parents through the lagging search index.
- `RelationsService.connect()`: its "Parent not found" (`relations.service.ts`,
  plain 400 today) throws the same `PARENT_NOT_FOUND` shape — the archive app
  still links re-uploaded items with `connect` and shows one message for both.
- Docs when built: `reference.md` (`parentIds`, the `parents` response,
  `PARENT_NOT_FOUND`) — **updated 2026-09-25**.

### B11 — `extent` from COBISS 215 (S) — DONE (2026-09-25)

Because editing a RECORD is checked (B9), an imported book without `extent`
could not be edited until someone typed it in. In `cobiss-parser.ts`, next to
`physicalDescription` (215/a): best-effort regex, e.g. `"253 str."` / `"XII,
253 str."` → `{ value: 253, unit: "pages" }`, `"1 video disk (95 min)"` → 95
`minutes`, `"1 zemljovid"` → 1 `sheets`. Only when the unit matches what the
material type's rule expects; otherwise leave `extent` empty (the import lists
the item as a warning). The COBISS preview uses the same parser, so the
archive app's "Get data" fills `extent` too. Cases in `cobiss-parser.spec.ts`.

### B12 — accent-insensitive OpenSearch matching (S) — DONE (2026-09-25)

The `asciifolding` sub-field skipped in B4 (`Niksic` → `Nikšić`), in
`infrastructure/docker/pgsync/schema.json`, used by suggest and search. Needs a
reindex — done as part of the rollout wipe (Deploy notes). **As built:** a
folding `default` analyzer instead of a sub-field (see Deviations); dev
reindexed 2026-09-25.

---

## Tests — `backend/test/api-test-suite.sh`

New section **"Schema v2"** (keep the v1 section as is until B7):

- `GET /schema/v2/record` 200 for anonymous and every persona; `ETag` present,
  `If-None-Match` → 304, `Cache-Control` contains `no-cache`.
- Shape: `schemaVersion == 2`; `vocabularies.materialType.values` present;
  `vocabularies.language` has `search` and no `values`; every field has `label.en`
  and `label.cnr`; `extent` has a rule with unit `pages`.
- `GET /search/vocabularies/language?q=crn` contains code `cnr`; `limit=2` →
  ≤ 2; unknown vocabulary → 404; anonymous 200.
- Suggest: a draft with `notes: ["TESTSUGG-Alpha", "TESTSUGG-Beta"]`,
  `q=TESTSUGG-Al` returns Alpha and **not** Beta.
- `summaryNote` round-trips through `POST` + `GET` (regression for the bug).
- Publish validation: draft with `materialType am` and no `extent` →
  `POST /items/transition` 400, `code == PUBLISH_VALIDATION_FAILED`,
  `items[0].missing[*].path` contains `extent`; item still a draft. Add `extent`
  → 201. Bulk of one valid + one invalid → 400 and **neither** moved.
  `POST /items` with `targetState: RECORD` and missing fields → 400.
  `PATCH` of an existing record that lacks `extent` → 200 (not validated).
  Child of a `collectionType: 4` parent without `issue.number` → 400.
- `GET /items/:id/validation?target=RECORD`: 200 with `ok:false` and the missing
  list; reader on a hidden draft → 404.

**B8–B12 (2026-09-25) — done**, section 19 changed accordingly (the B6 cases
expecting `PUBLISH_VALIDATION_FAILED`, and "PATCH of a record not validated",
flipped):

- Draft create without `materialType` → 400 `METADATA_VALIDATION_FAILED`,
  `items[0].state == DRAFT`; draft book without `extent` → 201.
- `PATCH` of a RECORD that removes `extent` → 400, item unchanged; `PATCH` of a
  draft removing `materialType` → 400; visibility-only `PATCH` of an incomplete
  record → 200.
- Transition RECORD → DRAFT of an item without `materialType` → 400.
- `POST /items` with `parentIds: [serial]`, `targetState: RECORD`, no
  `issue.number` → 400, nothing created, no relation; with `issue` filled →
  201, relation exists, response `parents[0].version` bumped. Map issue under a
  serial as RECORD with `issue` filled but no scale → 201 (scale is hidden
  under a serial). Unknown
  parent id → 400 `PARENT_NOT_FOUND` with that id in `parentIds`, nothing
  created; `relations/connect` with an unknown parent → the same code.
- `relations/connect` of a complete book RECORD under a serial (no `issue`) →
  400, no relation; the same book as a DRAFT → 201. `disconnect` that would
  leave a child invalid → 400, nothing unlinked.
- `parentIds` rights: anonymous 401, reader 403, cataloguer under a RECORD
  parent 403; duplicates linked once; not an array → 400.
- Accent folding: `Niksic…` finds `Nikšić…` in search, `Durdevica…` finds
  `Đurđevića…` in suggest; `schema.json` and the live indices carry the
  analyzer.
- `GET /items/:id/validation?target=DRAFT` → 200.
- Schema: `collectionType.default == 0`; `numberingAndDates.issueIdentifying ==
  false`; `targetState` among the context keys.

Jest: `evaluate.spec.ts` (fixture + frontend copy identical), schema self-check
spec, B11 parser cases.

---

## Impact on the other side

| Change | Web frontend | Archive app | Infrastructure |
|---|---|---|---|
| `summaryNote` accepted (done) | add the Summary field back to the editor and the record page (removed in `cd8e5bd`) | — | — |
| v2 endpoint | adopts it ([plan](../../frontend/plans/metadata-schema-v2.md)) | migrates at its own pace; **v1 frozen** | — |
| Publish validation (B6; code renamed by B9) | must render `METADATA_VALIDATION_FAILED` in the editor, the items-list bulk publish and the task "Complete" dialog | affected: it creates items as `RECORD` too (confirmed 2026-09-25) — accepted, test data only | — |
| New fields | rendered by the schema-driven form; **until then the web cannot enter `extent`, so it cannot publish books** | must support `quantity` | `metadata.issue.date` = `keyword`: one `PUT _mapping` on production, no reindex |
| Import `progress.warnings` | import page could list them (renders only `errors` today) | — | — |
| Suggest post-filter / new fields | better hints, no API change | same | — |
| `Cache-Control: no-cache` on v2 | revalidates each load (304) | same | — |
| B8 `targetState` + draft/record rules, `default` | `useSchemaForm` takes `targetState`; Save blocked per state; copy `evaluate.ts` again | copies `evaluate.ts`; Draft/Record choice feeds `targetState`; processing gate per state; main/child switch removed | — |
| B9 every write checked, `METADATA_VALIDATION_FAILED` | one `ValidationErrorDialog` for every save, transition and relation change. **Until F1–F5 land, the current editor cannot save a draft without a material type** (400, shown as a generic error) | handles the new code, incl. `state` | — |
| B10 `parentIds` on create, `PARENT_NOT_FOUND` | only if a "create as child" flow is added | creates new items with the batch's parents and stores `parents[].version`; re-uploads still use connect; `PARENT_NOT_FOUND` stops the batch | — |
| B11 `extent` from 215 | imported books arrive with `extent` | "Get data" fills `extent` | — |
| B12 `asciifolding` | `Niksic` finds `Nikšić` in search and hints | same | pgsync mapping + reindex (with the rollout wipe) |

## Estimate

B1 M · B2 S · B3 S · B4 S · B5 S · B6 M · B7 XS. B1–B2–B6 is the critical
path; B3–B5 can go in any order after B1.
B8 S · B9 M · B10 S · B11 S · B12 S — B8 → B9 → B10; B11, B12 independent.

## Key files

- `backend/src/modules/schema/*` (new `v2/`, `rules/`, `metadata-validator.service.ts` — was `publish-validator.service.ts`)
- `backend/src/modules/import/cobiss/cobiss-util/cobiss.types.ts`, `cobiss-parser.ts`, `cobiss-code-map.ts`
- `backend/src/modules/items/items.service.ts`, `items.controller.ts`, `dto/create-item.dto.ts`, `dto/validation-query.dto.ts`
- `backend/src/modules/relations/relations.service.ts`, `relations.controller.ts` (B9, B10)
- `backend/src/core/auth/resource-access.service.ts` (`assertCanManageParents`), `backend/src/shared/errors/parent-not-found.ts` (B10)
- `backend/src/modules/search/search.controller.ts`, `search.service.ts`, `suggest-fields.ts`
- `backend/test/api-test-suite.sh`
- `infrastructure/docker/pgsync/schema.json` (B12)
