# Frontend: Update Search API to Match Backend Changes

## Status: DONE

## Summary

The backend search API was refactored with new per-field strategies, multi-select filters, year range params, removed `series`, a new `fields` param, and a new `GET /search/suggest` autocomplete endpoint. The frontend needs to update its types, API client, and all components that use search.

## Backend Changes to Adapt To

### Search Endpoint Changes

| Change | Old | New |
|--------|-----|-----|
| `year` param | `year` (single value `"YYYY"` or range `"YYYY-YYYY"`) | `yearFrom` + `yearTo` (separate params, each `"YYYY"`) |
| `series` param | `series` (string) | **Removed** (series title still searched via `q`) |
| `publisher` param | Single string, fuzzy match | Comma-separated multi-select, `match_phrase` per value |
| `language` param | Single string, exact term | Comma-separated multi-select, `terms` filter |
| `materialType` param | Single string, exact term | Comma-separated multi-select, `terms` filter |
| `fields` param | N/A | New — comma-separated field names for `_source.includes`; always returns `id` |

### New: Suggest Endpoint (`GET /search/suggest`)

Universal autocomplete/dropdown endpoint. Params: `field`, `q` (optional), `limit` (default 10), `type` (default 'all').

**Supported fields:**

| Field | Response `value` type | Use case |
|-------|----------------------|----------|
| `title`, `subtitle`, `seriesTitle`, `publisher`, `place`, `firstResponsibility`, `edition`, `notes` | `string` | Typeahead text inputs |
| `language`, `originalLanguage`, `materialType`, `country`, `recordType`, `bibliographicLevel` | `{ code, en, cnr }` | Enum dropdowns — call without `q` for all options |
| `author` | `{ familyName, firstName, prefix?, dates?, role? }` | Author autocomplete |

**Response shape:**
```json
{
  "field": "language",
  "suggestions": [
    { "value": { "code": "sl", "en": "Slovenian", "cnr": "Slovenščina" }, "count": 350 },
    { "value": { "code": "en", "en": "English", "cnr": "Angleščina" }, "count": 120 }
  ]
}
```

## Files to Update

### 1. `frontend/src/api/search.ts` — Types & API Client

- [x] Update `SearchParams` interface:
  - Remove `series` property
  - Remove `year` property
  - Add `yearFrom?: string` and `yearTo?: string`
  - Add `fields?: string` (also added `fullText?: string` to mirror the backend DTO)
  - Update `publisher`, `language`, `materialType` JSDoc to note comma-separated multi-select
- [x] Add `SuggestParams` interface: `{ field: string; q?: string; limit?: number; type?: 'all' | 'records' | 'drafts' }`
- [x] Add `SuggestResult` and `SuggestItem` response interfaces (generic over value type; `AuthorSuggestion` added)
- [x] Add `suggestValues(params: SuggestParams): Promise<SuggestResult>` API function (GET /search/suggest) — overloaded so string/code/author fields return typed values. Locale-aware labels for `ResolvedCode` values live in `src/composables/useCodeLabel.ts` ('me' → cnr, otherwise en).

### 2. `frontend/src/pages/CatalogPage.vue` — Main Catalog Search

This is the primary search consumer with the most filters.

- [x] **Language filter**: Replace hardcoded language options with a call to `suggestValues({ field: 'language' })`. Allow true multi-select and send as comma-separated string.
- [x] **MaterialType filter**: Replace hardcoded material type options with a call to `suggestValues({ field: 'materialType' })`. Converted from radio to checkbox multi-select; sent comma-separated. Filter values are the `en` names (backend filters on `metadata.*.en`), labels follow the locale.
- [x] **Year/Era filter**: Era chips now set `yearFrom` / `yearTo` per the mapping below; a custom range arriving via router query (from advanced search) is honored without selecting a chip.
  - Pre-1800 → `yearTo=1799`
  - 19th century → `yearFrom=1800&yearTo=1899`
  - 1900–1950 → `yearFrom=1900&yearTo=1950`
  - 1950–2000 → `yearFrom=1950&yearTo=2000`
  - Post-2000 → `yearFrom=2001`
- [x] **Sorting**: UI options reduced to `relevance` | `newest` (the only values the backend supports) and the `sort` param is now actually sent. Year/title sorting would be a separate backend task.
- [x] **`fields` param**: List/grid requests now ask only for title, firstResponsibility, publicationDate1, materialType, language, publication.publisher and file attachment id/fileType.
- Also: CatalogPage now reads `language`, `publisher`, `yearFrom`, `yearTo` router query params (used by AdvancedSearchPage).

### 3. `frontend/src/pages/IndexPage.vue` — Homepage

- [x] Collection buttons **kept hardcoded** — they are a curated set with icons/translations, not a 1:1 material-type list (e.g. posters/photographs have no materialType).
- [x] "Newest items" request now uses `fields` to fetch only what the cards render.

### 4. `frontend/src/pages/AdvancedSearchPage.vue` — Advanced Search Form

- [x] **Year fields**: Now sent to CatalogPage as `yearFrom` / `yearTo` query params (padded to 4 digits, as the backend requires `YYYY`).
- [x] No `series` reference was present.
- [x] Publisher autocomplete via `suggestValues({ field: 'publisher', q })` (free text still allowed).
- [x] Language and materialType dropdowns populated from `suggestValues` (with an "All" option).

### 5. `frontend/src/pages/admin/AdminItemEditPage.vue` — Item Create/Edit

- [x] Author autocomplete on the "Author / responsibility" field via `suggestValues({ field: 'author', q })` — suggestions rendered as "FirstName FamilyName", free text still allowed.
- [x] Publisher autocomplete via `suggestValues({ field: 'publisher', q })`.
- [x] New form fields added: materialType (single select), languages (multi select) — options from `suggestValues`.
- [x] Country multi-select added, options from `suggestValues({ field: 'country' })`.

### 6. `frontend/src/pages/admin/AdminItemsPage.vue` — Admin Items List

- [x] No breaking changes; `fields` param added so the table fetches only the columns it renders.

### 7. `frontend/src/pages/RecordDetailPage.vue` — Record Detail

- [x] Uses `getItem(id)` — no search param changes needed. Display logic unchanged.

## Migration Notes

- The backend changes are **not backwards-compatible** for `year` and `series` params. `year=1990` will now return a 400 validation error. Frontend must switch to `yearFrom`/`yearTo` before deploying the backend change.
- `publisher`, `language`, `materialType` remain backwards-compatible for single values (e.g. `language=Slovenian` still works; `language=Slovenian,English` is now also supported).
- The `fields` param and `suggest` endpoint are purely additive — omitting them preserves current behavior.
- Suggest endpoint replaces hardcoded dropdown options with live data from the index — no more manually maintaining language/materialType lists.

## Key Files

- `frontend/src/api/search.ts` — SearchParams interface + API functions
- `frontend/src/pages/CatalogPage.vue` — main search consumer
- `frontend/src/pages/IndexPage.vue` — homepage search
- `frontend/src/pages/AdvancedSearchPage.vue` — advanced search form
- `frontend/src/pages/admin/AdminItemEditPage.vue` — item create/edit form
- `frontend/src/pages/admin/AdminItemsPage.vue` — admin items table
