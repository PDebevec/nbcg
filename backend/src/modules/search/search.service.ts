import { Injectable } from '@nestjs/common';
import type { RecordMetadata } from '../../core/types/metadata.types';
import { OpenSearchService } from '../../core/opensearch/opensearch.service';

export type SearchType = 'all' | 'records' | 'drafts';

export interface SearchHit {
  id: string;
  index: string;
  score: number;
  source: Record<string, unknown>;
}

type MetaKey = keyof RecordMetadata;

function mf(field: MetaKey, boost?: number): string {
  return boost ? `metadata.${field}^${boost}` : `metadata.${field}`;
}

const SEARCH_FIELDS = [
  mf('title', 3),
  mf('subtitle', 2),
  mf('firstResponsibility', 2),
  'metadata.authors.familyName^2',
  'metadata.authors.firstName',
  mf('parallelTitle'),
  mf('seriesTitle'),
  mf('notes'),
];

@Injectable()
export class SearchService {
  constructor(private readonly opensearch: OpenSearchService) {}

  async search(q: string, type: SearchType = 'all', limit = 20): Promise<SearchHit[]> {
    if (!q.trim()) return [];

    const indices: string[] = [];
    if (type === 'all' || type === 'records') indices.push('records');
    if (type === 'all' || type === 'drafts') indices.push('drafts');

    const body = {
      size: limit,
      query: {
        multi_match: {
          query: q,
          fields: SEARCH_FIELDS,
          type: 'cross_fields',
          lenient: true,
        },
      },
    };

    const result = await this.opensearch.search(indices, body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits: any[] = result?.hits?.hits ?? [];

    return hits.map((hit) => ({
      id: hit._id,
      index: hit._index,
      score: hit._score,
      source: hit._source,
    }));
  }
}
