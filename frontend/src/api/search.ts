import { api } from 'src/boot/axios';

// ---------------------------------------------------------------------------
// Primitive types (mirrors backend cobiss-code-map.ts)
// ---------------------------------------------------------------------------

export interface ResolvedCode {
  code: string;
  en: string;
  cnr: string;
}

// ---------------------------------------------------------------------------
// DomainRecord — mirrors backend cobiss.types.ts (active / RED fields only)
// ---------------------------------------------------------------------------

export interface DomainRecord {
  cobissId?: string;

  // 0XX — Identification
  recordType?: ResolvedCode;
  bibliographicLevel?: ResolvedCode;
  materialType?: ResolvedCode;
  documentTypology?: string;
  isbn?: string[];
  issn?: string[];
  ismn?: string[];

  // 1XX — Coded information
  publicationDate1?: string;
  publicationDate2?: string;
  language?: ResolvedCode[];
  originalLanguage?: ResolvedCode[];
  translationLanguages?: ResolvedCode[];
  country?: ResolvedCode[];
  textualMaterialCodes?: {
    illustrationCodes?: ResolvedCode[];
    contentTypeCodes?: ResolvedCode[];
    conferencePublication?: boolean;
    festschrift?: boolean;
    indexIndicator?: boolean;
    literaryForm?: ResolvedCode;
    biographyCode?: ResolvedCode;
  };

  // 2XX — Descriptive information
  title?: string;
  subtitle?: string;
  parallelTitle?: string;
  firstResponsibility?: string;
  subsequentResponsibility?: string;
  edition?: string;
  publication?: {
    place?: string;
    publisher?: string;
    year?: string;
    country?: string;
  };
  physicalDescription?: {
    extent?: string;
    otherPhysicalDetails?: string;
    dimensions?: string;
  };

  // 3XX — Notes
  notes?: string[];
  summaryNote?: string;
  targetAudienceNote?: string;

  // 4XX — Linking fields
  seriesTitle?: string;
  seriesIssn?: string;
  seriesVolume?: string;

  // 5XX — Related titles / links
  uniformTitle?: string;
  originalTitle?: string;

  // 6XX — Subject analysis
  udc?: string[];
  subjects?: string[];
  geographicSubjects?: string[];
  keywords?: string[];

  // 7XX — Intellectual responsibility
  authors?: Array<{
    familyName?: string;
    firstName?: string;
    role?: ResolvedCode;
    cobissAuthorId?: string;
  }>;
  corporateAuthors?: Array<{
    name?: string;
    role?: ResolvedCode;
  }>;

  // 8XX — International use fields
  unimarc?: string;
}

// ---------------------------------------------------------------------------
// BaseMetadata — mirrors backend metadata.types.ts
// ---------------------------------------------------------------------------

export interface BaseMetadata {
  title: string;
  collectionType: number;
  childrenInDrafts: number;
  childrenInRecords: number;
  jeGlavnoGradivo: boolean;
}

// ---------------------------------------------------------------------------
// Full record metadata type
// ---------------------------------------------------------------------------

export type CobissMetadata = BaseMetadata & DomainRecord & { _source: 'cobiss' };
export type RecordMetadata = CobissMetadata;

// ---------------------------------------------------------------------------
// OpenSearch document shape (what pgsync indexes)
// ---------------------------------------------------------------------------

export type TextExtractionStatus = 'NOT_EXTRACTED' | 'EXTRACTED' | 'GARBAGE' | 'NO_TEXT';

export interface FileAttachment {
  id: string;
  fileType: 'IMAGE' | 'PDF' | 'UNKNOWN';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  textExtractionStatus: TextExtractionStatus;
  createdAt: string;
}

/** One row per parent of this item (pgsync labels the item_relations node `parent_relations`). */
export interface ParentRelation {
  parentId: string;
  parentType: 'DRAFT' | 'RECORD';
}

export interface IndexedRecord {
  id: string;
  visibilityStatus: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  metadata: RecordMetadata;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  updatedByUserId: string;
  /** Display-name snapshot. Absent unless the caller holds drafts:manage or records:manage. */
  createdByName?: string;
  updatedByName?: string;
  file_attachments: FileAttachment[];
  parent_relations: ParentRelation[];
}

// ---------------------------------------------------------------------------
// Search API request / response — mirrors backend search.controller.ts
// ---------------------------------------------------------------------------

export interface SearchParams {
  q?: string;
  type?: 'all' | 'records' | 'drafts';
  page?: number;
  limit?: number;
  title?: string;
  author?: string;
  /** Full-text search inside extracted PDF text */
  fullText?: string;
  /** Comma-separated multi-select; each value matched as exact phrase */
  publisher?: string;
  /** Publication year range start ("YYYY") */
  yearFrom?: string;
  /** Publication year range end ("YYYY") */
  yearTo?: string;
  /** Comma-separated multi-select of language names (metadata.language.en) */
  language?: string;
  /** Comma-separated multi-select of material type names (metadata.materialType.en) */
  materialType?: string;
  isbn?: string;
  issn?: string;
  cobissId?: string;
  /** Exact filter on createdByUserId (the picker resolves a person to their UUID and sends that) */
  createdBy?: string;
  /**
   * Comma-separated field names for _source.includes; `id` is always returned.
   * Allowlisted server-side — unknown names are dropped silently, and attribution
   * fields are only returned to principals holding drafts:manage / records:manage.
   */
  fields?: string;
  sort?: 'relevance' | 'newest';
}

export interface SearchHit {
  id: string;
  index: string;
  score: number;
  source: IndexedRecord;
}

export interface SearchResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hits: SearchHit[];
}

// ---------------------------------------------------------------------------
// Suggest API (GET /search/suggest) — universal autocomplete / dropdown values
// ---------------------------------------------------------------------------

/** Fields whose suggestions are plain strings (typeahead text inputs) */
export type SuggestStringField =
  | 'title'
  | 'subtitle'
  | 'seriesTitle'
  | 'publisher'
  | 'place'
  | 'firstResponsibility'
  | 'edition'
  | 'notes';

/** Fields whose suggestions are ResolvedCode objects (enum dropdowns) */
export type SuggestCodeField =
  | 'language'
  | 'originalLanguage'
  | 'materialType'
  | 'country'
  | 'recordType'
  | 'bibliographicLevel';

export type SuggestField = SuggestStringField | SuggestCodeField | 'author';

export interface AuthorSuggestion {
  familyName?: string;
  firstName?: string;
  prefix?: string;
  dates?: string;
  role?: ResolvedCode;
}

export interface SuggestItem<V = string | ResolvedCode | AuthorSuggestion> {
  value: V;
  count: number;
}

export interface SuggestResult<V = string | ResolvedCode | AuthorSuggestion> {
  field: string;
  suggestions: SuggestItem<V>[];
}

export interface SuggestParams {
  field: SuggestField;
  /** Partial text for typeahead filtering; omit to get top values by frequency */
  q?: string;
  /** 1–50, default 10 */
  limit?: number;
  type?: 'all' | 'records' | 'drafts';
}

// ---------------------------------------------------------------------------
// Typed API calls
// ---------------------------------------------------------------------------

export async function searchItems(params: SearchParams): Promise<SearchResult> {
  const { data } = await api.get<SearchResult>('/search', { params });
  return data;
}

export async function suggestValues(
  params: SuggestParams & { field: SuggestStringField },
): Promise<SuggestResult<string>>;
export async function suggestValues(
  params: SuggestParams & { field: SuggestCodeField },
): Promise<SuggestResult<ResolvedCode>>;
export async function suggestValues(
  params: SuggestParams & { field: 'author' },
): Promise<SuggestResult<AuthorSuggestion>>;
export async function suggestValues(params: SuggestParams): Promise<SuggestResult> {
  const { data } = await api.get<SuggestResult>('/search/suggest', { params });
  return data;
}

export async function getItem(id: string): Promise<SearchHit> {
  const { data } = await api.get<SearchHit>(`/search/${id}`);
  return data;
}
