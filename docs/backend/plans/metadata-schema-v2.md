# Backend: metadata schema v2

## Status: B1–B6 DONE (2026-09-24) · B7 waits for the archive app

**Not yet deployed to production.** B6 (publish validation) must ship together
with the web editor's `extent`/`issue` inputs and error dialog — see
[Deploy notes](#deploy-notes). Everything below "Phases" is the original plan,
each phase marked with what was actually done.

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
| How do v1's `levels: ['main']` become rules? Hiding for every child would take authors, ISBN etc. from a book inside a fond. | **Hidden only under a serial** (`parentCollectionType ∋ 4`) — as the last rule of each of those 10 fields, so it wins. Children of other collections keep them. |

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
| `publish-validator.service.ts` | B6: `validate`, `check` (no DB), `assertPublishable` |

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
  `default`; `POST /items` still defaults it to 0.

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

### Deploy notes

1. **Web first (or together).** Publishing now needs `extent` for books and
   the other `a b g i j` types, but the web form has no field for it yet
   ([web plan ⚠](../../frontend/plans/metadata-schema-v2.md#-already-affects-the-current-web-app)).
2. **Archive app:** confirm which `targetState` it sends — if it creates
   `RECORD`s, it gets `400 PUBLISH_VALIDATION_FAILED` for incomplete metadata
   from this release on, even on v1.
3. **OpenSearch, once, before the first `issue` is saved:**
   `PUT records,drafts/_mapping` for `metadata.issue.date` = `keyword` — the
   command is in [opensearch-reindex.md](../../infrastructure/opensearch-reindex.md#adding-a-mapping-for-a-field-that-does-not-exist-yet--no-reindex).
   No reindex.
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
  in the job's `progress.errors` as warnings instead).
- `GET /items/:id/validation?target=RECORD` → `200 { ok, missing, violations }`;
  gated like reading the item (`assertCanView`, 404 for hidden).
- The task workflow's "complete REVIEW_PUBLISH" goes through `transition()`, so
  it gets this for free.

### B7 — retire v1 (XS, later) — OPEN, waits for the archive app

After the archive app confirms it runs on v2: delete `buildRecordFields()`,
`FieldDescriptor`, `RecordSchemaQueryDto`, the v1 route and its tests; update
the reference.

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

Jest: `evaluate.spec.ts` (fixture + frontend copy identical), schema self-check spec.

---

## Impact on the other side

| Change | Web frontend | Archive app | Infrastructure |
|---|---|---|---|
| `summaryNote` accepted (done) | add the Summary field back to the editor and the record page (removed in `cd8e5bd`) | — | — |
| v2 endpoint | adopts it ([plan](../../frontend/plans/metadata-schema-v2.md)) | migrates at its own pace; **v1 frozen** | — |
| Publish validation | must render `PUBLISH_VALIDATION_FAILED` in the editor, the items-list bulk publish and the task "Complete" dialog | **affected immediately if it creates items as `RECORD`** — confirm before release | — |
| New fields | rendered by the schema-driven form; **until then the web cannot enter `extent`, so it cannot publish books** | must support `quantity` | `metadata.issue.date` = `keyword`: one `PUT _mapping` on production, no reindex |
| Import `progress.warnings` | import page could list them (renders only `errors` today) | — | — |
| Suggest post-filter / new fields | better hints, no API change | same | — |
| `Cache-Control: no-cache` on v2 | revalidates each load (304) | same | — |

## Estimate

B1 M · B2 S · B3 S · B4 S · B5 S · B6 M · B7 XS. B1–B2–B6 is the critical
path; B3–B5 can go in any order after B1.

## Key files

- `backend/src/modules/schema/*` (new `v2/`, `rules/`, `publish-validator.service.ts`)
- `backend/src/modules/import/cobiss/cobiss-util/cobiss.types.ts`, `cobiss-parser.ts`, `cobiss-code-map.ts`
- `backend/src/modules/items/items.service.ts`, `items.controller.ts`
- `backend/src/modules/search/search.controller.ts`, `search.service.ts`, `suggest-fields.ts`
- `backend/test/api-test-suite.sh`
- `infrastructure/docker/pgsync/schema.json` (only if the optional mapping is done)
