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

const principal = { sub: 'test-user', scopes: [] } as unknown as Principal;

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

  it('builds per-word AND with fuzzy for q', async () => {
    const body = await searchWith({ q: 'hello world' });
    const userQuery = body.query.bool.must[0];
    // q wraps in bool.must[0].bool.must (the per-word array)
    const qClause = userQuery.bool.must[0];
    const perWord = qClause.bool.must;
    expect(perWord).toHaveLength(2);
    for (const wordClause of perWord) {
      expect(wordClause.bool.should).toHaveLength(2);
      expect(wordClause.bool.should[0].multi_match.fuzziness).toBe('AUTO');
      expect(wordClause.bool.should[0].multi_match.prefix_length).toBe(1);
      expect(wordClause.bool.should[1].nested.path).toBe('file_attachments');
    }
  });

  // ── Title ──

  it('builds fuzzy match with operator AND for title', async () => {
    const body = await searchWith({ title: 'test title' });
    const userQuery = body.query.bool.must[0];
    const titleClause = userQuery.bool.must[0];
    expect(titleClause.match['metadata.title']).toMatchObject({
      query: 'test title',
      operator: 'and',
      fuzziness: 'AUTO',
      prefix_length: 1,
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
    expect(langFilter.terms['metadata.language.en']).toEqual(['Slovenian', 'English']);
  });

  // ── Material type (multi-select) ──

  it('builds terms filter for comma-separated material types', async () => {
    const body = await searchWith({ materialType: 'Book,Journal' });
    const userQuery = body.query.bool.must[0];
    const mtFilter = userQuery.bool.filter[0];
    expect(mtFilter.terms['metadata.materialType.en']).toEqual(['Book', 'Journal']);
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
    expect(body._source.excludes).toBeUndefined();
  });

  it('deduplicates id in fields', async () => {
    const body = await searchWith({ fields: 'id,metadata.title' });
    expect(body._source.includes).toEqual(['id', 'metadata.title']);
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
