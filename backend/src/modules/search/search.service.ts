import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VisibilityStatus } from '../../../generated/prisma/enums';
import { OpenSearchService } from '../../core/opensearch/opensearch.service';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal, VisibilityFilter } from '../../core/auth/principal.type';
import type { SearchQueryDto } from './dto/search-query.dto';

export interface SearchHit {
  id: string;
  index: string;
  score: number;
  source: Record<string, unknown>;
}

export interface SearchResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hits: SearchHit[];
}

const SEARCH_FIELDS = [
  'metadata.title^3',
  'metadata.subtitle^2',
  'metadata.firstResponsibility^2',
  'metadata.authors.familyName^2',
  'metadata.authors.firstName',
  'metadata.parallelTitle',
  'metadata.seriesTitle',
  'metadata.notes',
  'file_attachments.filename',
];

function buildQuery(dto: SearchQueryDto): Record<string, unknown> {
  const must: unknown[] = [];
  const filter: unknown[] = [];

  if (dto.q?.trim()) {
    must.push({
      multi_match: {
        query: dto.q,
        fields: SEARCH_FIELDS,
        type: 'best_fields',
        fuzziness: 'AUTO',
        lenient: true,
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
    const rangeParts = dto.year.split('-');
    if (rangeParts.length === 2 && rangeParts[0] && rangeParts[1]) {
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

  if (must.length === 0 && filter.length === 0) {
    return { match_all: {} };
  }

  return { bool: { ...(must.length ? { must } : {}), ...(filter.length ? { filter } : {}) } };
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

    const body = { from, size: limit, query, track_total_hits: true };

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
      hits: hits.map((hit) => ({
        id: hit._id,
        index: hit._index,
        score: hit._score,
        source: hit._source,
      })),
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

    const body = { from, size: limit, query, track_total_hits: true };
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
      hits: hits.map((hit) => ({
        id: hit._id,
        index: hit._index,
        score: hit._score,
        source: hit._source,
      })),
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
