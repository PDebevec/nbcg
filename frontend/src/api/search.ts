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

export interface FileAttachment {
  id: string;
  fileType: 'IMAGE' | 'PDF' | 'UNKNOWN';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  textExtracted: boolean;
  createdAt: string;
}

export interface ItemRelationChild {
  childId: string;
  childType: 'DRAFT' | 'RECORD';
}

export interface IndexedRecord {
  id: string;
  visibilityStatus: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  metadata: RecordMetadata;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  updatedByUserId: string;
  file_attachments: FileAttachment[];
  item_relations: ItemRelationChild[];
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
  publisher?: string;
  series?: string;
  /** "1990" or "1990-2000" */
  year?: string;
  language?: string;
  materialType?: string;
  isbn?: string;
  issn?: string;
  cobissId?: string;
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
// Typed API call
// ---------------------------------------------------------------------------

export async function searchItems(params: SearchParams): Promise<SearchResult> {
  const { data } = await api.get<SearchResult>('/search', { params });
  return data;
}

export async function getItem(id: string): Promise<SearchHit> {
  const { data } = await api.get<SearchHit>(`/search/${id}`);
  return data;
}
