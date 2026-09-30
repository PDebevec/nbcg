import type { SuggestStringField } from 'src/api/search';
import type { MetadataForm } from './metadataForm';

// ---------------------------------------------------------------------------
// The editor's field table: which section a field sits in, in which order, and
// which input it gets. Hand-written on purpose — the layout is the design's,
// not the schema's. The metadata schema (v2) only decides, per item, whether a
// field is visible / required and what it is called (src/composables/
// useSchemaForm.ts); a field the schema hides for this material type moves to
// "Other fields" and stays fillable.
//
// Paths are the schema's dotted paths (`publication.year`, `issue.number`,
// `textualMaterialCodes.literaryForm`), which for almost every field is also
// the path into the form model. `materialType` is not here: it has its own
// band above the sections.
// ---------------------------------------------------------------------------

export type SectionKey =
  | 'issue'
  | 'identification'
  | 'responsibility'
  | 'publication'
  | 'physical'
  | 'series'
  | 'identifiers'
  | 'languages'
  | 'notes'
  | 'coded';

export interface SectionDef {
  key: SectionKey;
  /** In display order. */
  fields: string[];
}

export const SECTIONS: SectionDef[] = [
  { key: 'issue', fields: ['issue.volume', 'issue.number', 'issue.date'] },
  {
    key: 'identification',
    fields: [
      'title',
      'collectionType',
      'subtitle',
      'titleMediumDesignation',
      'parallelTitle',
      'titleInOtherScript',
      'titleByAnotherAuthor',
      'documentTypology',
      'recordType',
      'bibliographicLevel',
    ],
  },
  {
    key: 'responsibility',
    fields: ['firstResponsibility', 'subsequentResponsibility', 'authors', 'corporateBodies'],
  },
  {
    key: 'publication',
    fields: [
      'publication.publisher',
      'publication.place',
      'publication.year',
      'edition',
      'publicationDate1',
      'publicationDate2',
      'cartographicMathematicalData',
      'numberingAndDates',
      'musicEditionStatement',
      'publication.placeOfManufacture',
      'publication.manufacturerName',
    ],
  },
  {
    key: 'physical',
    fields: ['physicalDescription', 'extent', 'otherPhysicalDetails', 'dimensions'],
  },
  {
    key: 'series',
    fields: ['seriesTitle', 'seriesSubtitle', 'seriesResponsibility', 'seriesIssn', 'seriesVolume'],
  },
  { key: 'identifiers', fields: ['cobissId', 'isbn', 'issn', 'ismn'] },
  {
    key: 'languages',
    fields: ['language', 'country', 'originalLanguage', 'translationLanguages'],
  },
  { key: 'notes', fields: ['summaryNote', 'notes', 'keywords', 'electronicLocation'] },
  {
    key: 'coded',
    fields: [
      'textualMaterialCodes.illustrationCodes',
      'textualMaterialCodes.contentTypeCodes',
      'textualMaterialCodes.literaryForm',
      'textualMaterialCodes.biographyCode',
      'textualMaterialCodes.conferencePublication',
      'textualMaterialCodes.festschrift',
      'textualMaterialCodes.indexIndicator',
    ],
  },
];

export const ALL_FIELDS: string[] = SECTIONS.flatMap((section) => section.fields);

export function sectionOf(path: string): SectionKey | undefined {
  return SECTIONS.find((section) => section.fields.includes(path))?.key;
}

// ── Inputs ─────────────────────────────────────────────────────────────────

export type Widget =
  | { kind: 'text'; placeholder?: string; mono?: boolean }
  /** Free text with typeahead over values already in the catalogue. */
  | { kind: 'suggest'; field: SuggestStringField }
  /** Short repeatable strings, typed and turned into chips. */
  | { kind: 'chips' }
  /** One code from a vocabulary the schema inlines. */
  | { kind: 'code'; vocabulary: string }
  /** Several codes from a vocabulary the schema inlines. */
  | { kind: 'codes'; vocabulary: string }
  /** Codes from a vocabulary too long to inline — searched as the user types. */
  | { kind: 'vocabulary'; vocabulary: string; multiple: boolean }
  | { kind: 'collectionType' }
  /** The numeric extent: a number with the unit the material type implies. */
  | { kind: 'extent' }
  | { kind: 'textarea' }
  /** Longer repeatable strings, one input per line. */
  | { kind: 'lines'; textarea?: boolean; url?: boolean }
  | { kind: 'authors' }
  | { kind: 'corporateBodies' }
  | { kind: 'checkbox' };

export const WIDGETS: Record<string, Widget> = {
  'issue.volume': { kind: 'text' },
  'issue.number': { kind: 'text' },
  'issue.date': { kind: 'text', placeholder: '1929-03' },

  title: { kind: 'text' },
  collectionType: { kind: 'collectionType' },
  subtitle: { kind: 'text' },
  titleMediumDesignation: { kind: 'text' },
  parallelTitle: { kind: 'chips' },
  titleInOtherScript: { kind: 'chips' },
  titleByAnotherAuthor: { kind: 'text' },
  documentTypology: { kind: 'text' },
  recordType: { kind: 'code', vocabulary: 'recordType' },
  bibliographicLevel: { kind: 'code', vocabulary: 'bibliographicLevel' },

  firstResponsibility: { kind: 'suggest', field: 'firstResponsibility' },
  subsequentResponsibility: { kind: 'chips' },
  authors: { kind: 'authors' },
  corporateBodies: { kind: 'corporateBodies' },

  'publication.publisher': { kind: 'suggest', field: 'publisher' },
  'publication.place': { kind: 'suggest', field: 'place' },
  'publication.year': { kind: 'text' },
  edition: { kind: 'suggest', field: 'edition' },
  publicationDate1: { kind: 'text' },
  publicationDate2: { kind: 'text' },
  cartographicMathematicalData: { kind: 'text' },
  numberingAndDates: { kind: 'text' },
  musicEditionStatement: { kind: 'text' },
  'publication.placeOfManufacture': { kind: 'suggest', field: 'placeOfManufacture' },
  'publication.manufacturerName': { kind: 'suggest', field: 'manufacturerName' },

  physicalDescription: { kind: 'suggest', field: 'physicalDescription' },
  extent: { kind: 'extent' },
  otherPhysicalDetails: { kind: 'text' },
  dimensions: { kind: 'suggest', field: 'dimensions' },

  seriesTitle: { kind: 'suggest', field: 'seriesTitle' },
  seriesSubtitle: { kind: 'text' },
  seriesResponsibility: { kind: 'text' },
  seriesIssn: { kind: 'text' },
  seriesVolume: { kind: 'text' },

  cobissId: { kind: 'text', mono: true },
  isbn: { kind: 'chips' },
  issn: { kind: 'chips' },
  ismn: { kind: 'chips' },

  language: { kind: 'vocabulary', vocabulary: 'language', multiple: true },
  country: { kind: 'codes', vocabulary: 'country' },
  originalLanguage: { kind: 'vocabulary', vocabulary: 'language', multiple: true },
  translationLanguages: { kind: 'vocabulary', vocabulary: 'language', multiple: true },

  summaryNote: { kind: 'textarea' },
  notes: { kind: 'lines', textarea: true },
  keywords: { kind: 'chips' },
  electronicLocation: { kind: 'lines', url: true },

  'textualMaterialCodes.illustrationCodes': { kind: 'codes', vocabulary: 'illustration' },
  'textualMaterialCodes.contentTypeCodes': {
    kind: 'vocabulary',
    vocabulary: 'contentType',
    multiple: true,
  },
  'textualMaterialCodes.literaryForm': { kind: 'code', vocabulary: 'literaryForm' },
  'textualMaterialCodes.biographyCode': { kind: 'code', vocabulary: 'biography' },
  'textualMaterialCodes.conferencePublication': { kind: 'checkbox' },
  'textualMaterialCodes.festschrift': { kind: 'checkbox' },
  'textualMaterialCodes.indexIndicator': { kind: 'checkbox' },
};

// ── Reading and writing the form model by path ─────────────────────────────

/** `extent` is the one path that is not the model's own: the form keeps just the number. */
function modelPath(path: string): string[] {
  return path === 'extent' ? ['extentValue'] : path.split('.');
}

export function getField(form: MetadataForm, path: string): unknown {
  let value: unknown = form;
  for (const key of modelPath(path)) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function setField(form: MetadataForm, path: string, next: unknown): void {
  const keys = modelPath(path);
  let target = form as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]!] = next;
}

/** Whether a field holds something — what the "filled / total" counts and the auto-open of "Other fields" go by. */
export function isFilled(form: MetadataForm, path: string): boolean {
  const value = getField(form, path);
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    // "Not a collection" is the default, not an answer.
    return path === 'collectionType' ? value !== 0 : !Number.isNaN(value);
  }
  if (Array.isArray(value)) {
    if (path === 'authors') {
      return (value as MetadataForm['authors']).some((a) => a.familyName.trim() || a.firstName.trim());
    }
    if (path === 'corporateBodies') {
      return (value as MetadataForm['corporateBodies']).some((c) => c.name.trim());
    }
    return value.some((v) => (typeof v === 'string' ? v.trim() !== '' : v !== null));
  }
  return true;
}
