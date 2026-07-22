import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VisibilityStatus } from '../../../generated/prisma/enums';
import { OpenSearchService } from '../../core/opensearch/opensearch.service';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal, VisibilityFilter } from '../../core/auth/principal.type';
import type { SearchQueryDto } from './dto/search-query.dto';

export interface MatchedFile {
  /** file_attachments.id of the PDF whose extracted text matched */
  id: string;
  filename: string;
  /** Snippets of matched full text within this file */
  highlights: string[];
}

export interface SearchHit {
  id: string;
  index: string;
  score: number;
  source: Record<string, unknown>;
  /** Per-attachment matches, present only when the query used `fullText` */
  matchedFiles?: MatchedFile[];
  /** All full-text snippets flattened (kept for backward compatibility) */
  highlights?: string[];
}

// extractedText can be megabytes per attachment — never return it to clients
const SOURCE_EXCLUDES = ['file_attachments.extractedText'];

/** inner_hits name for the fullText nested query */
const MATCHED_FILES = 'matched_files';

export interface SearchResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hits: SearchHit[];
}

// Flat (non-nested) fields only — file_attachments.filename lives inside the
// nested mapping and must be queried through a nested clause.
const SEARCH_FIELDS = [
  'metadata.title^3',
  'metadata.subtitle^2',
  'metadata.firstResponsibility^2',
  'metadata.authors.familyName^2',
  'metadata.authors.firstName',
  'metadata.parallelTitle',
  'metadata.seriesTitle',
  'metadata.notes',
];

function buildQuery(dto: SearchQueryDto): Record<string, unknown> {
  const must: unknown[] = [];
  const filter: unknown[] = [];

  if (dto.q?.trim()) {
    must.push({
      bool: {
        should: [
          {
            multi_match: {
              query: dto.q,
              fields: SEARCH_FIELDS,
              type: 'best_fields',
              fuzziness: 'AUTO',
              lenient: true,
            },
          },
          {
            nested: {
              path: 'file_attachments',
              query: {
                match: {
                  'file_attachments.filename': { query: dto.q, fuzziness: 'AUTO' },
                },
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (dto.title) {
    must.push({ match_phrase_prefix: { 'metadata.title': dto.title } });
  }

  if (dto.author) {
    must.push({
      multi_match: {
        query: dto.author,
        fields: ['metadata.authors.familyName^2', 'metadata.authors.firstName'],
        fuzziness: 'AUTO',
      },
    });
  }

  if (dto.publisher) {
    must.push({
      match: {
        'metadata.publication.publisher': { query: dto.publisher, fuzziness: 'AUTO' },
      },
    });
  }

  if (dto.series) {
    must.push({ match_phrase_prefix: { 'metadata.seriesTitle': dto.series } });
  }

  if (dto.year) {
    // Format is validated by the DTO (@Matches: YYYY or YYYY-YYYY)
    const rangeParts = dto.year.split('-');
    if (rangeParts.length === 2) {
      if (rangeParts[0] > rangeParts[1]) {
        throw new BadRequestException('year range start must not be greater than end');
      }
      filter.push({
        range: {
          'metadata.publication.year': { gte: rangeParts[0], lte: rangeParts[1] },
        },
      });
    } else {
      filter.push({ term: { 'metadata.publication.year': dto.year } });
    }
  }

  if (dto.language) {
    filter.push({ term: { 'metadata.language.en': dto.language } });
  }

  if (dto.materialType) {
    filter.push({ term: { 'metadata.materialType.en': dto.materialType } });
  }

  if (dto.isbn) {
    filter.push({ term: { 'metadata.isbn': dto.isbn.replace(/-/g, '') } });
  }

  if (dto.issn) {
    filter.push({ term: { 'metadata.issn': dto.issn.replace(/-/g, '') } });
  }

  if (dto.cobissId) {
    filter.push({ term: { 'metadata.cobissId': dto.cobissId } });
  }

  if (dto.fullText?.trim()) {
    must.push({
      nested: {
        path: 'file_attachments',
        query: {
          match: {
            'file_attachments.extractedText': {
              query: dto.fullText,
              operator: 'and',
            },
          },
        },
        inner_hits: {
          name: MATCHED_FILES,
          // Only identify the matched attachment — never ship its text
          _source: { includes: ['file_attachments.id', 'file_attachments.filename'] },
          highlight: {
            fields: {
              'file_attachments.extractedText': {
                fragment_size: 150,
                number_of_fragments: 3,
              },
            },
          },
        },
      },
    });
  }

  if (must.length === 0 && filter.length === 0) {
    return { match_all: {} };
  }

  return { bool: { ...(must.length ? { must } : {}), ...(filter.length ? { filter } : {}) } };
}

/** Map a raw OpenSearch hit to a SearchHit, lifting per-attachment matches out of inner_hits. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapHit(hit: any): SearchHit {
  const innerHits: any[] = hit.inner_hits?.[MATCHED_FILES]?.hits?.hits ?? [];
  const matchedFiles: MatchedFile[] = innerHits.map((inner) => ({
    id: inner._source?.id,
    filename: inner._source?.filename,
    highlights: inner.highlight
      ? (Object.values(inner.highlight) as string[][]).flat()
      : [],
  }));

  return {
    id: hit._id,
    index: hit._index,
    score: hit._score,
    source: hit._source,
    ...(matchedFiles.length
      ? { matchedFiles, highlights: matchedFiles.flatMap((f) => f.highlights) }
      : {}),
  };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly opensearch: OpenSearchService,
    private readonly access: ResourceAccessService,
  ) {}

  async search(dto: SearchQueryDto, principal: Principal): Promise<SearchResult> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const from = (page - 1) * limit;

    if (from + limit >= 10000) {
      throw new BadRequestException('Page out of range: OpenSearch limit is from + size < 10000');
    }

    const filter = this.access.visibilityFilter(principal);
    const requestedType = dto.type ?? 'all';
    const { indices, visibilityClause } = this.buildVisibilityQuery(requestedType, filter);

    if (indices.length === 0) {
      return { total: 0, page, limit, pages: 0, hits: [] };
    }

    const userQuery = buildQuery(dto);
    const query = {
      bool: {
        must: [userQuery],
        filter: [visibilityClause],
      },
    };

    const body = {
      from,
      size: limit,
      query,
      track_total_hits: true,
      _source: { excludes: SOURCE_EXCLUDES },
      ...(dto.sort === 'newest' ? { sort: [{ createdAt: 'desc' as const }] } : {}),
    };

    const result = await this.opensearch.search(indices, body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = result;
    const total: number = raw?.hits?.total?.value ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits: any[] = raw?.hits?.hits ?? [];

    return {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hits: hits.map(mapHit),
    };
  }

  async getChildren(id: string, dto: SearchQueryDto, principal: Principal): Promise<SearchResult> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const from = (page - 1) * limit;

    if (from + limit >= 10000) {
      throw new BadRequestException('Page out of range: OpenSearch limit is from + size < 10000');
    }

    const filter = this.access.visibilityFilter(principal);
    const requestedType = dto.type ?? 'all';
    const { indices, visibilityClause } = this.buildVisibilityQuery(requestedType, filter);

    if (indices.length === 0) {
      return { total: 0, page, limit, pages: 0, hits: [] };
    }

    const innerQuery = buildQuery(dto);
    const query = {
      bool: {
        must: [innerQuery],
        filter: [
          { term: { 'parent_relations.parentId': id } },
          visibilityClause,
        ],
      },
    };

    const body = {
      from,
      size: limit,
      query,
      track_total_hits: true,
      _source: { excludes: SOURCE_EXCLUDES },
    };
    const result = await this.opensearch.search(indices, body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = result;
    const total: number = raw?.hits?.total?.value ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits: any[] = raw?.hits?.hits ?? [];

    return {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hits: hits.map(mapHit),
    };
  }

  async getById(id: string, principal: Principal): Promise<SearchHit> {
    const result = await this.opensearch.getById(id);
    if (!result) {
      throw new NotFoundException(`Item with id "${id}" not found`);
    }

    // Check visibility — return 404 (not 403) if the principal can't see this item
    const filter = this.access.visibilityFilter(principal);
    const allowedStatuses: VisibilityStatus[] =
      result.index === 'records' ? filter.records : filter.drafts;
    const itemVisibility = (result.source as Record<string, unknown>).visibilityStatus as string;

    if (!allowedStatuses.includes(itemVisibility as VisibilityStatus)) {
      throw new NotFoundException(`Item with id "${id}" not found`);
    }

    return { id, index: result.index, score: 1, source: result.source };
  }

  /**
   * Build an OpenSearch visibility clause that restricts results to only the
   * indices and visibility tiers the principal is allowed to see.
   */
  private buildVisibilityQuery(
    requestedType: 'all' | 'records' | 'drafts',
    filter: VisibilityFilter,
  ): { indices: string[]; visibilityClause: Record<string, unknown> } {
    const should: unknown[] = [];
    const indices: string[] = [];

    const wantsRecords = requestedType === 'all' || requestedType === 'records';
    const wantsDrafts = requestedType === 'all' || requestedType === 'drafts';

    if (wantsRecords && filter.records.length > 0) {
      indices.push('records');
      should.push({
        bool: {
          must: [
            { term: { _index: 'records' } },
            { terms: { visibilityStatus: filter.records } },
          ],
        },
      });
    }

    if (wantsDrafts && filter.drafts.length > 0) {
      indices.push('drafts');
      should.push({
        bool: {
          must: [
            { term: { _index: 'drafts' } },
            { terms: { visibilityStatus: filter.drafts } },
          ],
        },
      });
    }

    return {
      indices,
      visibilityClause: {
        bool: { should, minimum_should_match: 1 },
      },
    };
  }
}
