import type { LocationQuery, LocationQueryRaw } from 'vue-router';

// The catalogue's state lives in the URL. These helpers read it from the route
// query and write it back, so links, back/forward and the advanced search all
// speak the same shape.

export interface CatalogQuery {
  /** Search text: `q` across the metadata, or `fullText` inside scanned text when `fullText` is on */
  q: string;
  fullText: boolean;
  title: string;
  author: string;
  publisher: string;
  /** English material-type labels (the filter matches `metadata.materialType.en`) */
  materialType: string[];
  language: string[];
  /** `` (any), `>0` (collections only) or `0` (single items only) */
  collectionType: string;
  yearFrom: string;
  yearTo: string;
  sort: 'relevance' | 'newest';
  page: number;
}

export const EMPTY_CATALOG_QUERY: CatalogQuery = {
  q: '',
  fullText: false,
  title: '',
  author: '',
  publisher: '',
  materialType: [],
  language: [],
  collectionType: '',
  yearFrom: '',
  yearTo: '',
  sort: 'relevance',
  page: 1,
};

function str(query: LocationQuery, key: string): string {
  const v = query[key];
  return typeof v === 'string' ? v : '';
}

function list(query: LocationQuery, key: string): string[] {
  return str(query, key)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseCatalogQuery(query: LocationQuery): CatalogQuery {
  const page = Number(str(query, 'page'));
  return {
    q: str(query, 'q'),
    fullText: str(query, 'fullText') === '1',
    title: str(query, 'title'),
    author: str(query, 'author'),
    publisher: str(query, 'publisher'),
    materialType: list(query, 'materialType'),
    language: list(query, 'language'),
    collectionType: str(query, 'collectionType'),
    yearFrom: str(query, 'yearFrom'),
    yearTo: str(query, 'yearTo'),
    sort: str(query, 'sort') === 'newest' ? 'newest' : 'relevance',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Route query with only the non-default values, so URLs stay short. */
export function toRouteQuery(q: CatalogQuery): LocationQueryRaw {
  const out: Record<string, string> = {};
  if (q.q) out.q = q.q;
  if (q.q && q.fullText) out.fullText = '1';
  if (q.title) out.title = q.title;
  if (q.author) out.author = q.author;
  if (q.publisher) out.publisher = q.publisher;
  if (q.materialType.length) out.materialType = q.materialType.join(',');
  if (q.language.length) out.language = q.language.join(',');
  if (q.collectionType) out.collectionType = q.collectionType;
  if (q.yearFrom) out.yearFrom = q.yearFrom;
  if (q.yearTo) out.yearTo = q.yearTo;
  if (q.sort === 'newest') out.sort = 'newest';
  if (q.page > 1) out.page = String(q.page);
  return out;
}

/** True when anything narrows the results (sort and page do not count). */
export function hasCatalogFilters(q: CatalogQuery): boolean {
  return Boolean(
    q.q ||
      q.title ||
      q.author ||
      q.publisher ||
      q.materialType.length ||
      q.language.length ||
      q.collectionType ||
      q.yearFrom ||
      q.yearTo,
  );
}
