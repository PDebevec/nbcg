# Backend: Search API Refinement

## Status: TODO

## Summary

Refine the `/search` endpoint to support configurable response shapes (don't return everything every time), add sorting, and finalize which metadata fields should be exposed as search/filter parameters in the GUI.

## Current State

The backend already supports these search params: `q`, `fullText`, `title`, `author`, `publisher`, `series`, `year`, `language`, `materialType`, `isbn`, `issn`, `cobissId`, `type`, `page`, `limit`.

The frontend currently only uses: `q`, `title`, `materialType`, `language`, `type`, `page`, `limit`.

The response always returns the full `source` document (all metadata, file_attachments, parent_relations) minus `extractedText`.

## Changes Needed

### 1. Configurable Response Shape (presets + fields param)

Add two mechanisms to control what `/search` returns:

**A) Response mode presets:**
- `mode=list` — returns only the fields needed for table/grid display (TBD — ask user during implementation what they actually need in a result row)
- `mode=detail` — returns everything (current behavior, default for `GET /search/:id`)
- Default for `GET /search` list endpoint: `list`

**B) Fields parameter:**
- `fields=title,authors,year,...` — fine-grained field selection, overrides preset
- Implemented via OpenSearch `_source.includes` so we only fetch what's needed
- Dot notation for nested: `metadata.title`, `metadata.authors.familyName`

### 2. Sorting

Add sorting parameters:

- `sortBy` — one of: `relevance`, `title`, `year`, `createdAt`, `updatedAt`
- `sortOrder` — `asc` or `desc` (default: `desc` for relevance/dates, `asc` for title)
- Default: `relevance` (current behavior — sort by `_score`)
- When `sortBy != relevance` and no text query is present, use a simple `sort` clause
- When `sortBy != relevance` and a text query IS present, use `sort` as primary + `_score` as tiebreaker

### 3. Finalize Search/Filter Parameters

**Ask the user during implementation:**
- Review all existing metadata fields and decide which ones should be filterable in the GUI
- Consider which fields need dedicated filter params vs. being covered by the `q` full-text search
- Possible additions to evaluate: `country`, `bibliographicLevel`, `recordType`, `corporateBodies`, `notes`, `visibilityStatus`
- For coded fields (language, materialType, etc.), decide if the GUI needs faceted counts

## Tasks

- [ ] **Ask user**: Which fields are needed in list-mode response? (show them what's currently returned, let them pick)
- [ ] **Ask user**: Which additional metadata fields should become search/filter params?
- [ ] Add `mode` query param to DTO (`list` | `detail`, default `list` for search, `detail` for getById)
- [ ] Add `fields` query param to DTO (optional comma-separated string)
- [ ] Implement `_source.includes` filtering in OpenSearch query builder based on mode/fields
- [ ] Define the `list` preset field set (based on user input)
- [ ] Add `sortBy` and `sortOrder` query params to DTO with validation
- [ ] Implement sorting in OpenSearch query builder
- [ ] Add any new filter params decided with user
- [ ] Update frontend search API types to match new response shapes
- [ ] Test with existing frontend to ensure backwards compatibility

## Key Files

- `backend/src/modules/search/dto/search-query.dto.ts` — request DTO
- `backend/src/modules/search/search.service.ts` — query builder + response mapping
- `backend/src/modules/search/search.controller.ts` — endpoint definitions
- `frontend/src/api/search.ts` — frontend API types
- `frontend/src/pages/CatalogPage.vue` — main consumer
