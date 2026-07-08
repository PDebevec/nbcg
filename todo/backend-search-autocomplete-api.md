# Backend: Search Autocomplete / Filter Options API

## Status: TODO

## Summary

Create API endpoints that the frontend can call to get autocomplete suggestions and available filter options. This enables dropdown/typeahead UIs where users can select from existing values rather than typing free text.

## Use Cases

- User starts typing an author name in a filter field — backend returns matching authors from existing records
- User wants to filter by language/materialType/country — backend returns all distinct values that exist in the index
- User types a partial title — backend returns matching titles they can click to select
- User types a partial publisher name — backend returns matching publishers

## Design

### Autocomplete Endpoint (typeahead for text fields)

`GET /search/autocomplete`

- `field` — which field to autocomplete (e.g. `author`, `title`, `publisher`, `series`)
- `q` — the partial text the user has typed so far
- `limit` — max suggestions to return (default 10)
- Returns a list of matching values from existing indexed data

Implementation options to evaluate during development (ask user):
- OpenSearch `completion` suggester (requires mapping changes)
- OpenSearch `search_as_you_type` field type
- Simple `prefix` or `match_phrase_prefix` query + aggregation to extract distinct values
- For authors: aggregate on `metadata.authors.familyName` + `metadata.authors.firstName`

### Distinct Values Endpoint (for coded/enum fields)

`GET /search/facets`

- `field` — which field to get values for (e.g. `language`, `materialType`, `country`, `bibliographicLevel`)
- Optionally scoped by current search context (so counts reflect active filters)
- Returns list of `{ value, label, count }` — all distinct values with document counts

Implementation: OpenSearch `terms` aggregation on the relevant keyword fields.

## Tasks

- [ ] **Ask user**: Which fields need autocomplete (typeahead) vs. which need faceted distinct values?
- [ ] **Ask user**: Should autocomplete search across both records and drafts indices or just records?
- [ ] **Ask user**: Best autocomplete strategy for each field (prefix match, completion suggester, etc.)
- [ ] Design and implement autocomplete endpoint for text fields (authors, titles, publishers, series)
- [ ] Design and implement facets/distinct-values endpoint for coded fields (language, materialType, etc.)
- [ ] Handle edge cases: empty query returns popular/frequent values, deduplication, sorting by frequency
- [ ] Add appropriate caching if needed (coded field values change rarely)
- [ ] **When complete**: Create a frontend todo task in `/todo` for building the autocomplete/filter dropdown UI components that consume these endpoints

## Key Files

- `backend/src/modules/search/search.controller.ts` — add new endpoints
- `backend/src/modules/search/search.service.ts` — implement OpenSearch queries
- `backend/src/modules/search/dto/` — new DTOs for autocomplete/facet requests
- `infrastructure/docker/pgsync/schema.json` — may need mapping changes if using completion suggester
