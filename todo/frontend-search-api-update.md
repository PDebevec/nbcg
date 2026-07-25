# Frontend: Update Search API to Match Backend Changes

## Status: TODO

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

- [ ] Update `SearchParams` interface:
  - Remove `series` property
  - Remove `year` property
  - Add `yearFrom?: string` and `yearTo?: string`
  - Add `fields?: string`
  - Update `publisher`, `language`, `materialType` JSDoc to note comma-separated multi-select
- [ ] Add `SuggestParams` interface: `{ field: string; q?: string; limit?: number; type?: 'all' | 'records' | 'drafts' }`
- [ ] Add `SuggestResult` and `SuggestItem` response interfaces
- [ ] Add `suggestValues(params: SuggestParams): Promise<SuggestResult>` API function (GET /search/suggest)

### 2. `frontend/src/pages/CatalogPage.vue` — Main Catalog Search

This is the primary search consumer with the most filters.

- [ ] **Language filter**: Replace hardcoded language options with a call to `suggestValues({ field: 'language' })`. Allow true multi-select and send as comma-separated string.
- [ ] **MaterialType filter**: Replace hardcoded material type options with a call to `suggestValues({ field: 'materialType' })`. Allow multi-select (backend now supports comma-separated).
- [ ] **Year/Era filter**: Era chips exist in UI but values are **not sent to API**. Wire up to `yearFrom` / `yearTo`:
  - Pre-1800 → `yearTo=1799`
  - 19th century → `yearFrom=1800&yearTo=1899`
  - 1900–1950 → `yearFrom=1900&yearTo=1950`
  - 1950–2000 → `yearFrom=1950&yearTo=2000`
  - Post-2000 → `yearFrom=2001`
- [ ] **Sorting**: `sortBy` options include `year-asc` and `year-desc` in UI — verify these map correctly to the backend `sort` param (currently backend only supports `relevance` | `newest`; if more sort options needed, that's a separate backend task)
- [ ] **`fields` param**: Use `fields` to request only the fields needed for list display to reduce payload size

### 3. `frontend/src/pages/IndexPage.vue` — Homepage

- [ ] Replace hardcoded material type collection buttons with options from `suggestValues({ field: 'materialType' })`, or keep hardcoded if only specific collections should appear
- [ ] Consider using `fields` for the "newest items" cards to reduce payload

### 4. `frontend/src/pages/AdvancedSearchPage.vue` — Advanced Search Form

- [ ] **Year fields**: Form already has `yearFrom` and `yearTo` number inputs but they are **not sent to CatalogPage** via router query. Wire them up as `yearFrom` / `yearTo` query params.
- [ ] Remove any reference to `series` if present.
- [ ] Add publisher autocomplete using `suggestValues({ field: 'publisher', q: userInput })`
- [ ] Add language/materialType dropdowns using `suggestValues` instead of hardcoded values

### 5. `frontend/src/pages/admin/AdminItemEditPage.vue` — Item Create/Edit

- [ ] Use `suggestValues({ field: 'author', q: userInput })` for author autocomplete on add/edit
- [ ] Use `suggestValues({ field: 'publisher', q: userInput })` for publisher autocomplete
- [ ] Use `suggestValues({ field: 'language' })` and `suggestValues({ field: 'materialType' })` to populate enum dropdowns instead of hardcoded values
- [ ] Use `suggestValues({ field: 'country' })` for country dropdown if applicable

### 6. `frontend/src/pages/admin/AdminItemsPage.vue` — Admin Items List

- [ ] No breaking changes expected (only uses `q`, `type`, `page`, `limit`). Consider using `fields` to lighten admin table payload.

### 7. `frontend/src/pages/RecordDetailPage.vue` — Record Detail

- [ ] Uses `getItem(id)` — no search param changes needed. Display logic unchanged.

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
