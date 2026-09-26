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
// DomainRecord — mirrors backend cobiss.types.ts exactly (the RED / active
// COMARC fields). The server's DOMAIN_RECORD_SHAPE whitelist drops any key
// that is not listed here, so a field added on one side must be added on the
// other. Comments give the COMARC tag/subfield the value comes from.
// ---------------------------------------------------------------------------

export type Responsibility = 'primary' | 'alternative' | 'secondary';

export interface Author {
  familyName?: string; // 700-702/a
  firstName?: string; // 700-702/b
  prefix?: string; // 700-702/c
  romanNumerals?: string; // 700-702/d
  dates?: string; // 700-702/f
  role?: ResolvedCode; // 700-702/4 relator code
  responsibility?: Responsibility; // 700 / 701 / 702
}

export interface CorporateBody {
  name: string; // 710-712/a
  responsibility?: Responsibility; // 710 / 711 / 712
}

export interface ElectronicLocation {
  url: string; // 856/u
}

export interface TextualMaterialCodes {
  illustrationCodes?: ResolvedCode[]; // 105/a
  contentTypeCodes?: ResolvedCode[]; // 105/b
  conferencePublication?: boolean; // 105/c
  festschrift?: boolean; // 105/d
  indexIndicator?: boolean; // 105/e
  literaryForm?: ResolvedCode; // 105/f
  biographyCode?: ResolvedCode; // 105/g
}

export interface Publication {
  place?: string; // 210/a
  publisher?: string; // 210/c
  year?: string; // 210/d
  placeOfManufacture?: string; // 210/e
  manufacturerName?: string; // 210/g
}

export interface DomainRecord {
  cobissId?: string;

  // 0XX — Identification
  recordType?: ResolvedCode; // 001/b
  bibliographicLevel?: ResolvedCode; // 001/c
  materialType?: ResolvedCode; // 001/b+c
  documentTypology?: string; // 001/t
  isbn?: string[]; // 010/a
  issn?: string[]; // 011/a
  ismn?: string[]; // 013/a

  // 1XX — Coded information
  publicationDate1?: string; // 100/c
  publicationDate2?: string; // 100/d
  language?: ResolvedCode[]; // 101/a
  originalLanguage?: ResolvedCode[]; // 101/c
  translationLanguages?: ResolvedCode[]; // 101/d
  country?: ResolvedCode[]; // 102/a
  textualMaterialCodes?: TextualMaterialCodes; // 105

  // 2XX — Descriptive information
  title?: string; // 200/a
  titleMediumDesignation?: string; // 200/b
  titleByAnotherAuthor?: string; // 200/c
  parallelTitle?: string[]; // 200/d
  subtitle?: string; // 200/e
  firstResponsibility?: string; // 200/f
  subsequentResponsibility?: string[]; // 200/g
  edition?: string; // 205/a
  cartographicMathematicalData?: string; // 206/a
  numberingAndDates?: string; // 207/a
  musicEditionStatement?: string; // 208/a
  publication?: Publication; // 210
  physicalDescription?: string; // 215/a
  otherPhysicalDetails?: string; // 215/c
  dimensions?: string; // 215/d
  seriesTitle?: string; // 225/a
  seriesSubtitle?: string; // 225/e
  seriesResponsibility?: string; // 225/f
  seriesIssn?: string; // 225/x
  seriesVolume?: string; // 225/v

  // 3XX — Notes
  notes?: string[]; // 300/a

  // 5XX — Related titles
  titleInOtherScript?: string[]; // 518/a

  // 7XX — Intellectual responsibility
  authors?: Author[]; // 700-702
  corporateBodies?: CorporateBody[]; // 710-712

  // 8XX — International use
  electronicLocation?: ElectronicLocation[]; // 856
}

// ---------------------------------------------------------------------------
// BaseMetadata — mirrors backend metadata.types.ts
// ---------------------------------------------------------------------------

export interface BaseMetadata {
  title: string;
  collectionType: number;
  childrenInDrafts: number;
  childrenInRecords: number;
}

// ---------------------------------------------------------------------------
// Full record metadata type
// ---------------------------------------------------------------------------

/** `_source` is set by the server: 'cobiss' for imports, 'nbcg' for items created by hand. */
export type CobissMetadata = BaseMetadata & DomainRecord & { _source: 'cobiss' | 'nbcg' };
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
