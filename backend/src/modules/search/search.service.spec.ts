/**
 * Unit tests for the search query builder.
 *
 * We mock the Prisma-dependent modules to avoid the .js import resolution
 * issue, then test the query shapes sent to OpenSearch.
 */

// Mock the Prisma-dependent modules before any imports
jest.mock('../../../generated/prisma/enums', () => ({
  VisibilityStatus: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE', HIDDEN: 'HIDDEN' },
}));
jest.mock('../../core/opensearch/opensearch.service');
jest.mock('../../core/auth/resource-access.service');

import { BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service';
import type { SearchQueryDto } from './dto/search-query.dto';
import type { SuggestQueryDto } from './dto/suggest-query.dto';
import type { Principal } from '../../core/auth/principal.type';

// Capture the body sent to OpenSearch
let capturedBody: any = null;

const mockOpenSearch = {
  search: jest.fn((_indices: string[], body: any) => {
    capturedBody = body;
    return { hits: { total: { value: 0 }, hits: [] } };
  }),
  getById: jest.fn(),
};

const mockAccess = {
  visibilityFilter: jest.fn(() => ({
    records: ['PUBLIC', 'PRIVATE', 'HIDDEN'],
    drafts: ['PUBLIC', 'PRIVATE', 'HIDDEN'],
  })),
};

/**
 * `Principal.scopes` is a Set, not an array — the attribution rule calls
 * `.has()` on it. The previous fixture cast an array through `unknown`, which
 * compiled and then blew up the moment anything actually read the scopes.
 */
function principalWith(scopes: string[]): Principal {
  return {
    sub: 'test-user',
    username: 'test-user',
    displayName: 'Test User',
    scopes: new Set(scopes),
    isAnonymous: false,
  };
}

/** Below the attribution bar: no drafts:manage, no records:manage. */
const principal = principalWith(['records:view:public']);

/** Above it — cataloguer clears the bar on drafts:manage alone. */
const staffPrincipal = principalWith(['drafts:manage']);

describe('SearchService – query building', () => {
  let service: SearchService;

  beforeEach(() => {
    capturedBody = null;
    mockOpenSearch.search.mockClear();
    service = new SearchService(mockOpenSearch as any, mockAccess as any);
  });

  async function searchWith(dto: Partial<SearchQueryDto>) {
    await service.search(dto as SearchQueryDto, principal);
    return capturedBody;
  }

  // ── General search (q) ──

  it('builds per-word AND with fuzzy for q, last word also as prefix', async () => {
    const body = await searchWith({ q: 'hello world' });
    const userQuery = body.query.bool.must[0];
    // q wraps in bool.must[0].bool.must (the per-word array)
    const qClause = userQuery.bool.must[0];
    const perWord = qClause.bool.must;
    expect(perWord).toHaveLength(2);
    for (const wordClause of perWord) {
      expect(wordClause.bool.should[0].multi_match.fuzziness).toBe('AUTO');
      expect(wordClause.bool.should[0].multi_match.prefix_length).toBe(1);
      expect(wordClause.bool.should[1].nested.path).toBe('file_attachments');
    }
    // Only the word being typed (last) gets the extra bool_prefix clause
    expect(perWord[0].bool.should).toHaveLength(2);
    expect(perWord[1].bool.should).toHaveLength(3);
    expect(perWord[1].bool.should[2].multi_match.type).toBe('bool_prefix');
  });

  // ── Title ──

  it('builds fuzzy match + bool_prefix should for title', async () => {
    const body = await searchWith({ title: 'test title' });
    const userQuery = body.query.bool.must[0];
    const titleClause = userQuery.bool.must[0];
    expect(titleClause.bool.minimum_should_match).toBe(1);
    expect(titleClause.bool.should[0].match['metadata.title']).toMatchObject({
      query: 'test title',
      operator: 'and',
      fuzziness: 'AUTO',
      prefix_length: 1,
    });
    expect(titleClause.bool.should[1].match_bool_prefix['metadata.title']).toMatchObject({
      query: 'test title',
      operator: 'and',
    });
  });

  // ── Author ──

  it('builds multi_match with operator AND for author', async () => {
    const body = await searchWith({ author: 'john doe' });
    const userQuery = body.query.bool.must[0];
    const authorClause = userQuery.bool.must[0];
    expect(authorClause.multi_match).toMatchObject({
      query: 'john doe',
      operator: 'and',
      fuzziness: 'AUTO',
      fields: ['metadata.authors.familyName^2', 'metadata.authors.firstName'],
    });
  });

  // ── Publisher (multi-select exact) ──

  it('builds match_phrase should for comma-separated publishers', async () => {
    const body = await searchWith({ publisher: 'Acme Corp,Big Publisher' });
    const userQuery = body.query.bool.must[0];
    const pubFilter = userQuery.bool.filter[0];
    expect(pubFilter.bool.should).toHaveLength(2);
    expect(pubFilter.bool.should[0].match_phrase['metadata.publication.publisher']).toBe('Acme Corp');
    expect(pubFilter.bool.should[1].match_phrase['metadata.publication.publisher']).toBe('Big Publisher');
  });

  // ── Language (multi-select) ──

  it('builds terms filter for comma-separated languages', async () => {
    const body = await searchWith({ language: 'Slovenian,English' });
    const userQuery = body.query.bool.must[0];
    const langFilter = userQuery.bool.filter[0];
    expect(langFilter.terms['metadata.language.en.keyword']).toEqual(['Slovenian', 'English']);
  });

  // ── Material type (multi-select) ──

  it('builds terms filter for comma-separated material types', async () => {
    const body = await searchWith({ materialType: 'Book,Journal' });
    const userQuery = body.query.bool.must[0];
    const mtFilter = userQuery.bool.filter[0];
    expect(mtFilter.terms['metadata.materialType.en.keyword']).toEqual(['Book', 'Journal']);
  });

  // ── Year range ──

  it('builds range filter for yearFrom + yearTo', async () => {
    const body = await searchWith({ yearFrom: '1990', yearTo: '2000' });
    const userQuery = body.query.bool.must[0];
    const rangeFilter = userQuery.bool.filter[0];
    expect(rangeFilter.range['metadata.publication.year']).toEqual({ gte: '1990', lte: '2000' });
  });

  it('builds range filter for yearFrom only', async () => {
    const body = await searchWith({ yearFrom: '1990' });
    const userQuery = body.query.bool.must[0];
    const rangeFilter = userQuery.bool.filter[0];
    expect(rangeFilter.range['metadata.publication.year']).toEqual({ gte: '1990' });
  });

  it('builds range filter for yearTo only', async () => {
    const body = await searchWith({ yearTo: '2000' });
    const userQuery = body.query.bool.must[0];
    const rangeFilter = userQuery.bool.filter[0];
    expect(rangeFilter.range['metadata.publication.year']).toEqual({ lte: '2000' });
  });

  it('throws when yearFrom > yearTo', async () => {
    await expect(searchWith({ yearFrom: '2000', yearTo: '1990' })).rejects.toThrow(BadRequestException);
  });

  // ── Exact identifiers ──

  it('builds term filter for isbn with dashes removed', async () => {
    const body = await searchWith({ isbn: '978-3-16-148410-0' });
    const userQuery = body.query.bool.must[0];
    const isbnFilter = userQuery.bool.filter[0];
    expect(isbnFilter.term['metadata.isbn']).toBe('9783161484100');
  });

  it('builds term filter for cobissId', async () => {
    const body = await searchWith({ cobissId: '12345' });
    const userQuery = body.query.bool.must[0];
    const cobissFilter = userQuery.bool.filter[0];
    expect(cobissFilter.term['metadata.cobissId']).toBe('12345');
  });

  // ── Full text ──

  it('builds nested match with inner_hits for fullText', async () => {
    const body = await searchWith({ fullText: 'some search phrase' });
    const userQuery = body.query.bool.must[0];
    const ftClause = userQuery.bool.must[0];
    expect(ftClause.nested.path).toBe('file_attachments');
    expect(ftClause.nested.query.match['file_attachments.extractedText'].operator).toBe('and');
    expect(ftClause.nested.inner_hits).toBeDefined();
    expect(ftClause.nested.inner_hits.name).toBe('matched_files');
  });

  // ── Fields parameter ──

  it('uses _source.excludes when no fields param', async () => {
    const body = await searchWith({ q: 'test' });
    expect(body._source.excludes).toContain('file_attachments.extractedText');
  });

  it('uses _source.includes with id when fields param is provided', async () => {
    const body = await searchWith({ q: 'test', fields: 'metadata.title,metadata.authors' });
    expect(body._source.includes).toEqual(['id', 'metadata.title', 'metadata.authors']);
  });

  // This assertion used to be `excludes).toBeUndefined()`, which pinned the
  // includes-only projection in place: naming a parent object pulled its
  // excluded children out with it, so `?fields=file_attachments` returned
  // megabytes of extractedText. Excludes must ride along on both branches.
  it('keeps _source.excludes alongside includes so a projection cannot bypass them', async () => {
    const body = await searchWith({ q: 'test', fields: 'file_attachments' });
    expect(body._source.includes).toEqual(['id', 'file_attachments']);
    expect(body._source.excludes).toContain('file_attachments.extractedText');
  });

  it('deduplicates id in fields', async () => {
    const body = await searchWith({ fields: 'id,metadata.title' });
    expect(body._source.includes).toEqual(['id', 'metadata.title']);
  });

  // ── Attribution: staff-only, enforced on both the default and projected paths ──

  it('excludes attribution names for a principal below the staff bar', async () => {
    const body = await searchWith({ q: 'test' });
    expect(body._source.excludes).toEqual(
      expect.arrayContaining(['createdByName', 'updatedByName']),
    );
  });

  it('does not exclude attribution names for staff', async () => {
    await service.search({ q: 'test' } as SearchQueryDto, staffPrincipal);
    expect(capturedBody._source.excludes).not.toContain('createdByName');
    expect(capturedBody._source.excludes).toContain('file_attachments.extractedText');
  });

  it('still excludes attribution when the projection names it directly', async () => {
    const body = await searchWith({ fields: 'createdByName' });
    // Allowlisted, so it survives into `includes` — and is then removed by
    // `excludes`, which OpenSearch applies last. That is what makes the
    // projection unable to re-request a withheld field.
    expect(body._source.includes).toEqual(['id', 'createdByName']);
    expect(body._source.excludes).toContain('createdByName');
  });

  // ── Projection allowlist ──

  it('drops field names that are not projectable', async () => {
    const body = await searchWith({ fields: 'nonsense,__proto__,metadata.title' });
    expect(body._source.includes).toEqual(['id', 'metadata.title']);
  });

  it('allows sub-paths of projectable objects', async () => {
    const body = await searchWith({
      fields: 'metadata.authors.familyName,file_attachments.filename,parent_relations.parentId',
    });
    expect(body._source.includes).toEqual([
      'id',
      'metadata.authors.familyName',
      'file_attachments.filename',
      'parent_relations.parentId',
    ]);
  });

  it('falls back to id alone when every requested field is rejected', async () => {
    const body = await searchWith({ fields: 'nope,alsonope' });
    expect(body._source.includes).toEqual(['id']);
  });

  // ── Empty query ──

  it('returns match_all when no filters are provided', async () => {
    const body = await searchWith({});
    const userQuery = body.query.bool.must[0];
    expect(userQuery).toEqual({ match_all: {} });
  });

  // ── Sorting ──

  it('sorts by createdAt desc when sort=newest', async () => {
    const body = await searchWith({ sort: 'newest' });
    expect(body.sort).toEqual([{ createdAt: 'desc' }]);
  });

  it('does not add sort clause for relevance', async () => {
    const body = await searchWith({ sort: 'relevance' });
    expect(body.sort).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Attribution stripping on the way out
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The engine-side `excludes` above are the first line; this is the backstop for
 * them. Both exist because `_source` used to be handed to the caller wholesale,
 * and that is an easy mistake to reintroduce in a new query path.
 */
describe('SearchService – attribution stripping', () => {
  let service: SearchService;

  const hitWithAttribution = {
    _id: 'item-1',
    _index: 'records',
    _score: 1,
    _source: {
      id: 'item-1',
      visibilityStatus: 'PUBLIC',
      createdByUserId: 'sub-1',
      createdByName: 'Ana Perović',
      updatedByName: 'Ana Perović',
      metadata: { title: 'A record' },
    },
  };

  beforeEach(() => {
    mockOpenSearch.search.mockClear();
    // Return a hit whose _source carries the names, as if the excludes had been
    // forgotten — which is exactly the case this backstop exists for.
    mockOpenSearch.search.mockImplementation(() => ({
      hits: { total: { value: 1 }, hits: [hitWithAttribution] },
    }));
    service = new SearchService(mockOpenSearch as any, mockAccess as any);
  });

  afterAll(() => {
    mockOpenSearch.search.mockImplementation((_indices: string[], body: any) => {
      capturedBody = body;
      return { hits: { total: { value: 0 }, hits: [] } };
    });
  });

  it('removes attribution names from a hit for a principal below the bar', async () => {
    const result = await service.search({} as SearchQueryDto, principal);
    expect(result.hits[0].source).not.toHaveProperty('createdByName');
    expect(result.hits[0].source).not.toHaveProperty('updatedByName');
  });

  it('leaves the rest of the document intact', async () => {
    const result = await service.search({} as SearchQueryDto, principal);
    expect(result.hits[0].source).toMatchObject({
      id: 'item-1',
      createdByUserId: 'sub-1',
      metadata: { title: 'A record' },
    });
  });

  it('keeps attribution names for staff', async () => {
    const result = await service.search({} as SearchQueryDto, staffPrincipal);
    expect(result.hits[0].source.createdByName).toBe('Ana Perović');
  });

  it('does not mutate the document it was handed', async () => {
    await service.search({} as SearchQueryDto, principal);
    // A shallow copy, not a delete on the original — otherwise the first
    // low-privilege read would strip the name for everyone downstream.
    expect(hitWithAttribution._source.createdByName).toBe('Ana Perović');
  });

  it('strips attribution on a single-item read too', async () => {
    mockOpenSearch.getById.mockResolvedValue({
      index: 'records',
      source: { ...hitWithAttribution._source },
    });
    const hit = await service.getById('item-1', principal);
    expect(hit.source).not.toHaveProperty('createdByName');
    // And asks OpenSearch to withhold it in the first place.
    expect(mockOpenSearch.getById).toHaveBeenCalledWith(
      'item-1',
      expect.arrayContaining(['createdByName', 'updatedByName']),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suggest endpoint tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('SearchService – suggest', () => {
  let service: SearchService;

  beforeEach(() => {
    capturedBody = null;
    mockOpenSearch.search.mockClear();
    service = new SearchService(mockOpenSearch as any, mockAccess as any);
  });

  async function suggestWith(dto: Partial<SuggestQueryDto>) {
    // Mock different responses based on field type
    const defaults: SuggestQueryDto = { field: 'title', ...dto } as SuggestQueryDto;
    mockOpenSearch.search.mockImplementationOnce((_indices: string[], body: any) => {
      capturedBody = body;
      // Return empty aggregation structure
      return { hits: { total: { value: 0 }, hits: [] }, aggregations: { suggestions: { buckets: [] }, by_family: { buckets: [] } } };
    });
    await service.suggest(defaults, principal);
    return capturedBody;
  }

  it('throws on unknown field', async () => {
    mockOpenSearch.search.mockClear();
    await expect(
      service.suggest({ field: 'nonexistent' } as SuggestQueryDto, principal),
    ).rejects.toThrow(BadRequestException);
  });

  // ── String field ──

  it('builds string suggest with match_phrase_prefix when q provided', async () => {
    const body = await suggestWith({ field: 'publisher', q: 'podg' });
    expect(body.size).toBe(0);
    expect(body.query.bool.must[0].match_phrase_prefix['metadata.publication.publisher'].query).toBe('podg');
    expect(body.aggs.suggestions.terms.field).toBe('metadata.publication.publisher.keyword');
  });

  it('builds string suggest without must when q is absent', async () => {
    const body = await suggestWith({ field: 'title' });
    expect(body.size).toBe(0);
    expect(body.query.bool.must).toBeUndefined();
    expect(body.aggs.suggestions.terms.field).toBe('metadata.title.keyword');
  });

  it('respects limit param for string suggest', async () => {
    const body = await suggestWith({ field: 'publisher', limit: 25 });
    expect(body.aggs.suggestions.terms.size).toBe(25);
  });

  // ── ResolvedCode field ──

  it('builds resolvedCode suggest with match on en and cnr', async () => {
    const body = await suggestWith({ field: 'language', q: 'slov' });
    expect(body.size).toBe(0);
    const should = body.query.bool.must[0].bool.should;
    expect(should).toHaveLength(2);
    expect(should[0].match_phrase_prefix['metadata.language.en'].query).toBe('slov');
    expect(should[1].match_phrase_prefix['metadata.language.cnr'].query).toBe('slov');
    expect(body.aggs.suggestions.terms.field).toBe('metadata.language.code.keyword');
    expect(body.aggs.suggestions.aggs.sample.top_hits).toBeDefined();
  });

  it('builds resolvedCode suggest without must when q is absent', async () => {
    const body = await suggestWith({ field: 'materialType' });
    expect(body.query.bool.must).toBeUndefined();
    expect(body.aggs.suggestions.terms.field).toBe('metadata.materialType.code.keyword');
  });

  // ── Author field ──

  it('builds author suggest with multi_match phrase_prefix', async () => {
    const body = await suggestWith({ field: 'author', q: 'jan' });
    expect(body.size).toBe(0);
    expect(body.query.bool.must[0].multi_match.type).toBe('phrase_prefix');
    expect(body.query.bool.must[0].multi_match.fields).toEqual([
      'metadata.authors.familyName',
      'metadata.authors.firstName',
    ]);
    expect(body.aggs.by_family.terms.field).toBe('metadata.authors.familyName.keyword');
    expect(body.aggs.by_family.aggs.by_first.terms.field).toBe('metadata.authors.firstName.keyword');
  });

  it('builds author suggest without must when q is absent', async () => {
    const body = await suggestWith({ field: 'author' });
    expect(body.query.bool.must).toBeUndefined();
    expect(body.aggs.by_family).toBeDefined();
  });

  // ── Result mapping ──

  it('maps string suggest results', async () => {
    mockOpenSearch.search.mockImplementationOnce(() => ({
      hits: { total: { value: 0 }, hits: [] },
      aggregations: {
        suggestions: {
          buckets: [
            { key: 'Publisher A', doc_count: 10 },
            { key: 'Publisher B', doc_count: 5 },
          ],
        },
      },
    }));
    const result = await service.suggest({ field: 'publisher' } as SuggestQueryDto, principal);
    expect(result.field).toBe('publisher');
    expect(result.suggestions).toEqual([
      { value: 'Publisher A', count: 10 },
      { value: 'Publisher B', count: 5 },
    ]);
  });

  it('maps resolvedCode suggest results for array field', async () => {
    mockOpenSearch.search.mockImplementationOnce(() => ({
      hits: { total: { value: 0 }, hits: [] },
      aggregations: {
        suggestions: {
          buckets: [
            {
              key: 'sl',
              doc_count: 100,
              sample: {
                hits: {
                  hits: [{
                    _source: {
                      metadata: {
                        language: [
                          { code: 'sl', en: 'Slovenian', cnr: 'Slovenščina' },
                          { code: 'en', en: 'English', cnr: 'Angleščina' },
                        ],
                      },
                    },
                  }],
                },
              },
            },
          ],
        },
      },
    }));
    const result = await service.suggest({ field: 'language' } as SuggestQueryDto, principal);
    expect(result.suggestions[0].value).toEqual({ code: 'sl', en: 'Slovenian', cnr: 'Slovenščina' });
    expect(result.suggestions[0].count).toBe(100);
  });

  it('maps author suggest results', async () => {
    mockOpenSearch.search.mockImplementationOnce(() => ({
      hits: { total: { value: 0 }, hits: [] },
      aggregations: {
        by_family: {
          buckets: [
            {
              key: 'Novak',
              doc_count: 5,
              by_first: {
                buckets: [{
                  key: 'Janez',
                  doc_count: 5,
                  sample: {
                    hits: {
                      hits: [{
                        _source: {
                          metadata: {
                            authors: [
                              { familyName: 'Novak', firstName: 'Janez', responsibility: 'primary', role: { code: 'aut', en: 'Author', cnr: 'Avtor' } },
                            ],
                          },
                        },
                      }],
                    },
                  },
                }],
              },
            },
          ],
        },
      },
    }));
    const result = await service.suggest({ field: 'author' } as SuggestQueryDto, principal);
    expect(result.suggestions[0].value).toEqual({
      familyName: 'Novak',
      firstName: 'Janez',
      role: { code: 'aut', en: 'Author', cnr: 'Avtor' },
    });
    // responsibility should be stripped
    expect((result.suggestions[0].value as any).responsibility).toBeUndefined();
  });
});
