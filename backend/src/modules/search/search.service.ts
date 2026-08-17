import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VisibilityStatus } from '../../../generated/prisma/enums';
import { OpenSearchService } from '../../core/opensearch/opensearch.service';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal, VisibilityFilter } from '../../core/auth/principal.type';
import type { SearchQueryDto } from './dto/search-query.dto';
import type { SuggestQueryDto } from './dto/suggest-query.dto';
import { SUGGEST_FIELDS } from './suggest-fields';
import type { SuggestFieldConfig } from './suggest-fields';

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

/**
 * Snapshot attribution names, indexed as `keyword` so the engine can sort and
 * aggregate on them. Staff-only: a reader or an anonymous visitor must not learn
 * who created or edited an item.
 */
const ATTRIBUTION_FIELDS = ['createdByName', 'updatedByName'];

/**
 * `drafts:manage` OR `records:manage` is the bar for seeing attribution. It
 * admits cataloguer, editor and admin; it excludes `reader` (who holds only
 * `records:view:*`) and anonymous, and it needs no new realm scope.
 */
function canSeeAttribution(principal: Principal): boolean {
  return principal.scopes.has('drafts:manage') || principal.scopes.has('records:manage');
}

/**
 * Top-level `_source` fields a client may name in `?fields=`.
 *
 * An allowlist, not a denylist, and required rather than cosmetic: without it a
 * client-supplied projection is handed straight to OpenSearch as `includes`, so
 * `?fields=createdByName` becomes a direct request for the one field the
 * attribution rule above exists to withhold. Anything not listed is dropped
 * silently — a projection is a hint about response shape, not an assertion that
 * the field exists, so an unknown name is not worth a 400.
 */
const PROJECTABLE_FIELDS = new Set([
  'id',
  'visibilityStatus',
  'version',
  'createdAt',
  'updatedAt',
  'createdByUserId',
  'updatedByUserId',
  ...ATTRIBUTION_FIELDS,
]);

/** Fields whose sub-paths are projectable too — `metadata.title`, `file_attachments.filename`. */
const PROJECTABLE_PREFIXES = ['metadata', 'file_attachments', 'parent_relations'];

function isProjectable(field: string): boolean {
  return PROJECTABLE_FIELDS.has(field) || PROJECTABLE_PREFIXES.includes(field.split('.')[0]);
}

/** inner_hits name for the fullText nested query */
const MATCHED_FILES = 'matched_files';

export interface SearchResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hits: SearchHit[];
}

/**
 * Fields searched by the general `q` param, with boosting.
 * file_attachments.filename is nested and handled separately.
 */
const GENERAL_SEARCH_FIELDS = [
  'metadata.title^3',
  'metadata.subtitle^2',
  'metadata.firstResponsibility^2',
  'metadata.authors.familyName^2',
  'metadata.authors.firstName',
  'metadata.parallelTitle',
  'metadata.seriesTitle',
  'metadata.notes',
];

/** Split a comma-separated query param into trimmed non-empty values. */
function parseMultiValue(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

// ─── Query builder ───────────────────────────────────────────────────────────

function buildQuery(dto: SearchQueryDto): Record<string, unknown> {
  const must: unknown[] = [];
  const filter: unknown[] = [];

  // ── q: general search ──
  // All words required (AND). Each word must match in at least one of the
  // boosted fields or in a file attachment filename. Uses fuzziness AUTO with
  // prefix_length 1 for typo tolerance without excessive expansion.
  if (dto.q?.trim()) {
    const words = dto.q.trim().split(/\s+/).filter(Boolean);
    const perWord = words.map((word, i) => {
      const should: unknown[] = [
        {
          multi_match: {
            query: word,
            fields: GENERAL_SEARCH_FIELDS,
            fuzziness: 'AUTO',
            prefix_length: 1,
          },
        },
        {
          nested: {
            path: 'file_attachments',
            query: {
              match: {
                'file_attachments.filename': {
                  query: word,
                  fuzziness: 'AUTO',
                  prefix_length: 1,
                },
              },
            },
          },
        },
      ];

      if (i === words.length - 1) {
        should.push({
          multi_match: {
            query: word,
            type: 'bool_prefix',
            fields: GENERAL_SEARCH_FIELDS,
          },
        });
      }

      return { bool: { should, minimum_should_match: 1 } };
    });
    must.push({ bool: { must: perWord } });
  }

  if (dto.title?.trim()) {
    must.push({
      bool: {
        should: [
          {
            match: {
              'metadata.title': {
                query: dto.title,
                operator: 'and',
                fuzziness: 'AUTO',
                prefix_length: 1,
              },
            },
          },
          {
            match_bool_prefix: {
              'metadata.title': {
                query: dto.title,
                operator: 'and',
                fuzziness: 'AUTO',
                prefix_length: 1,
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  }

  // ── author: fuzzy per-word AND across name fields ──
  if (dto.author?.trim()) {
    must.push({
      multi_match: {
        query: dto.author,
        fields: ['metadata.authors.familyName^2', 'metadata.authors.firstName'],
        operator: 'and',
        fuzziness: 'AUTO',
        prefix_length: 1,
      },
    });
  }

  // ── publisher: exact multi-select (comma-separated) ──
  const publishers = parseMultiValue(dto.publisher);
  if (publishers.length) {
    filter.push({
      bool: {
        should: publishers.map((p) => ({
          match_phrase: { 'metadata.publication.publisher': p },
        })),
        minimum_should_match: 1,
      },
    });
  }

  // ── language: exact multi-select ──
  const languages = parseMultiValue(dto.language);
  if (languages.length) {
    filter.push({ terms: { 'metadata.language.en.keyword': languages } });
  }

  // ── materialType: exact multi-select ──
  const materialTypes = parseMultiValue(dto.materialType);
  if (materialTypes.length) {
    filter.push({ terms: { 'metadata.materialType.en.keyword': materialTypes } });
  }

  // ── year range ──
  if (dto.yearFrom || dto.yearTo) {
    if (dto.yearFrom && dto.yearTo && dto.yearFrom > dto.yearTo) {
      throw new BadRequestException('yearFrom must not be greater than yearTo');
    }
    filter.push({
      range: {
        'metadata.publication.year': {
          ...(dto.yearFrom ? { gte: dto.yearFrom } : {}),
          ...(dto.yearTo ? { lte: dto.yearTo } : {}),
        },
      },
    });
  }

  // ── exact identifiers ──
  if (dto.isbn) {
    filter.push({ term: { 'metadata.isbn': dto.isbn.replace(/-/g, '') } });
  }

  if (dto.issn) {
    filter.push({ term: { 'metadata.issn': dto.issn.replace(/-/g, '') } });
  }

  if (dto.cobissId) {
    filter.push({ term: { 'metadata.cobissId': dto.cobissId } });
  }

  // ── createdBy: exact creator filter (keyword) ──
  if (dto.createdBy) {
    filter.push({ term: { createdByUserId: dto.createdBy } });
  }

  // ── fullText: nested search in extracted PDF text ──
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

/**
 * Build `_source` control based on the `fields` query param.
 *
 * `excludes` is applied on both branches, which the earlier includes-only branch
 * did not do: OpenSearch lets excludes win over includes, so this is what makes
 * the projection unable to re-request a withheld field — and it also stops
 * `?fields=file_attachments` from returning megabytes of extracted text.
 */
function buildSourceControl(fields: string | undefined, showAttribution: boolean): Record<string, unknown> {
  const excludes = showAttribution ? SOURCE_EXCLUDES : [...SOURCE_EXCLUDES, ...ATTRIBUTION_FIELDS];

  if (!fields?.trim()) {
    // Default: everything the principal may see
    return { excludes };
  }

  const requested = fields
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter(isProjectable);
  // Always include id; deduplicate
  const includes = [...new Set(['id', ...requested])];
  return { includes, excludes };
}

/**
 * Application-side backstop for the engine-side `_source` excludes above.
 *
 * Both exist deliberately. The excludes stop the field leaving OpenSearch; this
 * stops it leaving the process if any future query path builds its own body and
 * forgets them — `_source` used to be handed to the caller wholesale, which is
 * exactly the shape of mistake that is easy to reintroduce.
 */
function sanitizeSource(
  source: Record<string, unknown> | undefined,
  showAttribution: boolean,
): Record<string, unknown> {
  if (!source) return {};
  if (showAttribution) return source;

  const clean = { ...source };
  for (const field of ATTRIBUTION_FIELDS) delete clean[field];
  return clean;
}

/** Map a raw OpenSearch hit to a SearchHit, lifting per-attachment matches out of inner_hits. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapHit(hit: any, showAttribution: boolean): SearchHit {
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
    source: sanitizeSource(hit._source, showAttribution),
    ...(matchedFiles.length
      ? { matchedFiles, highlights: matchedFiles.flatMap((f) => f.highlights) }
      : {}),
  };
}

// ─── Suggest types & query builders ──────────────────────────────────────────

export interface SuggestItem {
  value: unknown;
  count: number;
}

export interface SuggestResult {
  field: string;
  suggestions: SuggestItem[];
}

function buildStringSuggestBody(
  config: SuggestFieldConfig,
  q: string | undefined,
  limit: number,
  visibilityClause: Record<string, unknown>,
): Record<string, unknown> {
  const must: unknown[] = [];
  if (q?.trim()) {
    must.push({ match_phrase_prefix: { [config.matchPath]: { query: q } } });
  }

  return {
    size: 0,
    query: {
      bool: {
        ...(must.length ? { must } : {}),
        filter: [visibilityClause],
      },
    },
    aggs: {
      suggestions: {
        terms: { field: config.keywordPath, size: limit, order: { _count: 'desc' } },
      },
    },
  };
}

function buildResolvedCodeSuggestBody(
  config: SuggestFieldConfig,
  q: string | undefined,
  limit: number,
  visibilityClause: Record<string, unknown>,
): Record<string, unknown> {
  const rc = config.resolvedCode!;
  const must: unknown[] = [];

  if (q?.trim()) {
    must.push({
      bool: {
        should: rc.matchPaths.map((path) => ({
          match_phrase_prefix: { [path]: { query: q } },
        })),
        minimum_should_match: 1,
      },
    });
  }

  return {
    size: 0,
    query: {
      bool: {
        ...(must.length ? { must } : {}),
        filter: [visibilityClause],
      },
    },
    aggs: {
      suggestions: {
        terms: { field: rc.codePath, size: limit, order: { _count: 'desc' } },
        aggs: {
          sample: {
            top_hits: { size: 1, _source: { includes: rc.sourceIncludes } },
          },
        },
      },
    },
  };
}

function buildAuthorSuggestBody(
  config: SuggestFieldConfig,
  q: string | undefined,
  limit: number,
  visibilityClause: Record<string, unknown>,
): Record<string, unknown> {
  const ac = config.author!;
  const must: unknown[] = [];

  if (q?.trim()) {
    must.push({
      multi_match: {
        query: q,
        fields: ac.searchFields,
        type: 'phrase_prefix',
      },
    });
  }

  return {
    size: 0,
    query: {
      bool: {
        ...(must.length ? { must } : {}),
        filter: [visibilityClause],
      },
    },
    aggs: {
      by_family: {
        terms: { field: ac.primaryAggField, size: limit, order: { _count: 'desc' } },
        aggs: {
          by_first: {
            terms: { field: ac.secondaryAggField, size: 1 },
            aggs: {
              sample: {
                top_hits: { size: 1, _source: { includes: ac.sourceIncludes } },
              },
            },
          },
        },
      },
    },
  };
}

// ─── Suggest result mappers ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStringSuggestResult(field: string, raw: any): SuggestResult {
  const buckets = raw?.aggregations?.suggestions?.buckets ?? [];
  return {
    field,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    suggestions: buckets.map((b: any) => ({ value: b.key, count: b.doc_count })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapResolvedCodeSuggestResult(field: string, config: SuggestFieldConfig, raw: any): SuggestResult {
  const buckets = raw?.aggregations?.suggestions?.buckets ?? [];
  const rc = config.resolvedCode!;
  // The sourceIncludes path is like "metadata.language" — extract the last segment
  const metaField = rc.sourceIncludes[0].replace('metadata.', '');

  return {
    field,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    suggestions: buckets.map((b: any) => {
      const hit = b.sample?.hits?.hits?.[0]?._source;
      const fieldValue = hit?.metadata?.[metaField];

      // For array ResolvedCode fields (e.g. language[]), find the element matching the bucket code
      let resolved: unknown = fieldValue;
      if (Array.isArray(fieldValue)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolved = fieldValue.find((el: any) => el?.code === b.key) ?? { code: b.key };
      }

      return { value: resolved, count: b.doc_count };
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAuthorSuggestResult(field: string, raw: any): SuggestResult {
  const familyBuckets = raw?.aggregations?.by_family?.buckets ?? [];
  const suggestions: SuggestItem[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const fb of familyBuckets) {
    const firstBuckets = fb.by_first?.buckets ?? [];
    if (firstBuckets.length === 0) {
      suggestions.push({ value: { familyName: fb.key }, count: fb.doc_count });
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const fnb of firstBuckets) {
      const hit = fnb.sample?.hits?.hits?.[0]?._source;
      const authors: any[] = hit?.metadata?.authors ?? [];
      // Find the matching author from the document's author array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matched = authors.find((a: any) => a.familyName === fb.key && a.firstName === fnb.key);

      if (matched) {
        const { responsibility, ...authorData } = matched;
        suggestions.push({ value: authorData, count: fb.doc_count });
      } else {
        suggestions.push({
          value: { familyName: fb.key, firstName: fnb.key },
          count: fb.doc_count,
        });
      }
    }
  }

  return { field, suggestions };
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

    const showAttribution = canSeeAttribution(principal);
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
      _source: buildSourceControl(dto.fields, showAttribution),
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
      hits: hits.map((hit) => mapHit(hit, showAttribution)),
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

    const showAttribution = canSeeAttribution(principal);
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
      _source: buildSourceControl(dto.fields, showAttribution),
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
      hits: hits.map((hit) => mapHit(hit, showAttribution)),
    };
  }

  async getById(id: string, principal: Principal): Promise<SearchHit> {
    const showAttribution = canSeeAttribution(principal);
    const result = await this.opensearch.getById(
      id,
      showAttribution ? SOURCE_EXCLUDES : [...SOURCE_EXCLUDES, ...ATTRIBUTION_FIELDS],
    );
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

    return {
      id,
      index: result.index,
      score: 1,
      source: sanitizeSource(result.source, showAttribution),
    };
  }

  // ─── Suggest ──────────────────────────────────────────────────────────────

  async suggest(dto: SuggestQueryDto, principal: Principal): Promise<SuggestResult> {
    const config = SUGGEST_FIELDS[dto.field];
    if (!config) {
      throw new BadRequestException(
        `Unknown field "${dto.field}". Supported: ${Object.keys(SUGGEST_FIELDS).join(', ')}`,
      );
    }

    const limit = dto.limit ?? 10;
    const visFilter = this.access.visibilityFilter(principal);
    const requestedType = dto.type ?? 'all';
    const { indices, visibilityClause } = this.buildVisibilityQuery(requestedType, visFilter);

    if (indices.length === 0) {
      return { field: dto.field, suggestions: [] };
    }

    let body: Record<string, unknown>;
    switch (config.type) {
      case 'string':
        body = buildStringSuggestBody(config, dto.q, limit, visibilityClause);
        break;
      case 'resolvedCode':
        body = buildResolvedCodeSuggestBody(config, dto.q, limit, visibilityClause);
        break;
      case 'author':
        body = buildAuthorSuggestBody(config, dto.q, limit, visibilityClause);
        break;
    }

    const result = await this.opensearch.search(indices, body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = result;

    switch (config.type) {
      case 'string':
        return mapStringSuggestResult(dto.field, raw);
      case 'resolvedCode':
        return mapResolvedCodeSuggestResult(dto.field, config, raw);
      case 'author':
        return mapAuthorSuggestResult(dto.field, raw);
    }
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
