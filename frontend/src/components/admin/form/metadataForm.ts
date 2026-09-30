import type { MetadataPayload } from 'src/api/admin';
import type {
  Author,
  CorporateBody,
  DomainRecord,
  Issue,
  Publication,
  ResolvedCode,
  Responsibility,
  TextualMaterialCodes,
} from 'src/api/search';

// ---------------------------------------------------------------------------
// Editable form model over DomainRecord. Every field has a defined default so
// the template can bind to it directly; empty values are turned back into
// "absent" (create) or `null` (update, which clears the stored value) when
// the payload is built.
// ---------------------------------------------------------------------------

export const RESPONSIBILITIES: Responsibility[] = ['primary', 'alternative', 'secondary'];

export interface AuthorForm {
  familyName: string;
  firstName: string;
  prefix: string;
  romanNumerals: string;
  dates: string;
  role: ResolvedCode | null;
  responsibility: Responsibility | null;
}

export interface CorporateBodyForm {
  name: string;
  responsibility: Responsibility | null;
}

export interface TextualCodesForm {
  illustrationCodes: ResolvedCode[];
  contentTypeCodes: ResolvedCode[];
  conferencePublication: boolean;
  festschrift: boolean;
  indexIndicator: boolean;
  literaryForm: ResolvedCode | null;
  biographyCode: ResolvedCode | null;
}

export interface PublicationForm {
  place: string;
  publisher: string;
  year: string;
  placeOfManufacture: string;
  manufacturerName: string;
}

export interface IssueForm {
  volume: string;
  number: string;
  date: string;
}

export interface MetadataForm {
  // Identification
  title: string;
  /** 0 = not a collection, 1 primary collection, 3 collection, 4 serial collection. */
  collectionType: number;
  subtitle: string;
  titleMediumDesignation: string;
  titleByAnotherAuthor: string;
  parallelTitle: string[];
  titleInOtherScript: string[];
  materialType: ResolvedCode | null;
  recordType: ResolvedCode | null;
  bibliographicLevel: ResolvedCode | null;
  documentTypology: string;
  // Responsibility
  firstResponsibility: string;
  subsequentResponsibility: string[];
  authors: AuthorForm[];
  corporateBodies: CorporateBodyForm[];
  // Publication
  publication: PublicationForm;
  edition: string;
  publicationDate1: string;
  publicationDate2: string;
  // One issue of a serial collection (shown when a parent is a serial collection)
  issue: IssueForm;
  // Physical description
  physicalDescription: string;
  /** The number of the numeric extent; its unit follows the material type (schema rule), so it is not stored here. */
  extentValue: number | null;
  otherPhysicalDetails: string;
  dimensions: string;
  // Series
  seriesTitle: string;
  seriesSubtitle: string;
  seriesResponsibility: string;
  seriesIssn: string;
  seriesVolume: string;
  // Identifiers
  cobissId: string;
  isbn: string[];
  issn: string[];
  ismn: string[];
  // Languages and countries
  language: ResolvedCode[];
  originalLanguage: ResolvedCode[];
  translationLanguages: ResolvedCode[];
  country: ResolvedCode[];
  // Subject, notes and links
  keywords: string[];
  summaryNote: string;
  notes: string[];
  /** Plain URLs; wrapped into `{ url }` objects for the server. */
  electronicLocation: string[];
  // Advanced
  textualMaterialCodes: TextualCodesForm;
  cartographicMathematicalData: string;
  numberingAndDates: string;
  musicEditionStatement: string;
}

export function emptyAuthor(): AuthorForm {
  return {
    familyName: '',
    firstName: '',
    prefix: '',
    romanNumerals: '',
    dates: '',
    role: null,
    responsibility: null,
  };
}

export function emptyCorporateBody(): CorporateBodyForm {
  return { name: '', responsibility: null };
}

export function emptyForm(): MetadataForm {
  return {
    title: '',
    collectionType: 0,
    subtitle: '',
    titleMediumDesignation: '',
    titleByAnotherAuthor: '',
    parallelTitle: [],
    titleInOtherScript: [],
    materialType: null,
    recordType: null,
    bibliographicLevel: null,
    documentTypology: '',
    firstResponsibility: '',
    subsequentResponsibility: [],
    authors: [],
    corporateBodies: [],
    publication: {
      place: '',
      publisher: '',
      year: '',
      placeOfManufacture: '',
      manufacturerName: '',
    },
    edition: '',
    publicationDate1: '',
    publicationDate2: '',
    issue: { volume: '', number: '', date: '' },
    physicalDescription: '',
    extentValue: null,
    otherPhysicalDetails: '',
    dimensions: '',
    seriesTitle: '',
    seriesSubtitle: '',
    seriesResponsibility: '',
    seriesIssn: '',
    seriesVolume: '',
    cobissId: '',
    isbn: [],
    issn: [],
    ismn: [],
    language: [],
    originalLanguage: [],
    translationLanguages: [],
    country: [],
    keywords: [],
    summaryNote: '',
    notes: [],
    electronicLocation: [],
    textualMaterialCodes: {
      illustrationCodes: [],
      contentTypeCodes: [],
      conferencePublication: false,
      festschrift: false,
      indexIndicator: false,
      literaryForm: null,
      biographyCode: null,
    },
    cartographicMathematicalData: '',
    numberingAndDates: '',
    musicEditionStatement: '',
  };
}

// ---------------------------------------------------------------------------
// metadata → form
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const code = (v: unknown): ResolvedCode | null =>
  v && typeof v === 'object' && typeof (v as ResolvedCode).code === 'string'
    ? (v as ResolvedCode)
    : null;
const codeList = (v: unknown): ResolvedCode[] =>
  Array.isArray(v) ? v.map(code).filter((c): c is ResolvedCode => c !== null) : [];
const responsibility = (v: unknown): Responsibility | null =>
  RESPONSIBILITIES.includes(v as Responsibility) ? (v as Responsibility) : null;

export function metadataToForm(metadata: Record<string, unknown>): MetadataForm {
  const m = metadata as Partial<DomainRecord>;
  const form = emptyForm();

  form.title = str(m.title);
  form.collectionType = typeof metadata.collectionType === 'number' ? metadata.collectionType : 0;
  form.subtitle = str(m.subtitle);
  form.titleMediumDesignation = str(m.titleMediumDesignation);
  form.titleByAnotherAuthor = str(m.titleByAnotherAuthor);
  form.parallelTitle = strList(m.parallelTitle);
  form.titleInOtherScript = strList(m.titleInOtherScript);
  form.materialType = code(m.materialType);
  form.recordType = code(m.recordType);
  form.bibliographicLevel = code(m.bibliographicLevel);
  form.documentTypology = str(m.documentTypology);

  form.firstResponsibility = str(m.firstResponsibility);
  form.subsequentResponsibility = strList(m.subsequentResponsibility);
  form.authors = (Array.isArray(m.authors) ? m.authors : []).map((a) => ({
    familyName: str(a?.familyName),
    firstName: str(a?.firstName),
    prefix: str(a?.prefix),
    romanNumerals: str(a?.romanNumerals),
    dates: str(a?.dates),
    role: code(a?.role),
    responsibility: responsibility(a?.responsibility),
  }));
  form.corporateBodies = (Array.isArray(m.corporateBodies) ? m.corporateBodies : []).map((c) => ({
    name: str(c?.name),
    responsibility: responsibility(c?.responsibility),
  }));

  const pub: Publication = m.publication ?? {};
  form.publication = {
    place: str(pub.place),
    publisher: str(pub.publisher),
    year: str(pub.year),
    placeOfManufacture: str(pub.placeOfManufacture),
    manufacturerName: str(pub.manufacturerName),
  };
  form.edition = str(m.edition);
  form.publicationDate1 = str(m.publicationDate1);
  form.publicationDate2 = str(m.publicationDate2);

  const issue: Issue = m.issue ?? {};
  form.issue = { volume: str(issue.volume), number: str(issue.number), date: str(issue.date) };

  form.physicalDescription = str(m.physicalDescription);
  form.extentValue = typeof m.extent?.value === 'number' ? m.extent.value : null;
  form.otherPhysicalDetails = str(m.otherPhysicalDetails);
  form.dimensions = str(m.dimensions);

  form.seriesTitle = str(m.seriesTitle);
  form.seriesSubtitle = str(m.seriesSubtitle);
  form.seriesResponsibility = str(m.seriesResponsibility);
  form.seriesIssn = str(m.seriesIssn);
  form.seriesVolume = str(m.seriesVolume);

  form.cobissId = str(m.cobissId);
  form.isbn = strList(m.isbn);
  form.issn = strList(m.issn);
  form.ismn = strList(m.ismn);

  form.language = codeList(m.language);
  form.originalLanguage = codeList(m.originalLanguage);
  form.translationLanguages = codeList(m.translationLanguages);
  form.country = codeList(m.country);

  form.keywords = strList(m.keywords);
  form.summaryNote = str(m.summaryNote);
  form.notes = strList(m.notes);
  form.electronicLocation = (Array.isArray(m.electronicLocation) ? m.electronicLocation : [])
    .map((e) => str(e?.url))
    .filter(Boolean);

  const tmc: TextualMaterialCodes = m.textualMaterialCodes ?? {};
  form.textualMaterialCodes = {
    illustrationCodes: codeList(tmc.illustrationCodes),
    contentTypeCodes: codeList(tmc.contentTypeCodes),
    conferencePublication: tmc.conferencePublication === true,
    festschrift: tmc.festschrift === true,
    indexIndicator: tmc.indexIndicator === true,
    literaryForm: code(tmc.literaryForm),
    biographyCode: code(tmc.biographyCode),
  };
  form.cartographicMathematicalData = str(m.cartographicMathematicalData);
  form.numberingAndDates = str(m.numberingAndDates);
  form.musicEditionStatement = str(m.musicEditionStatement);

  return form;
}

// ---------------------------------------------------------------------------
// form → metadata
// ---------------------------------------------------------------------------

/** Marker for "this field is empty" before the mode decides what that becomes. */
const EMPTY = Symbol('empty');
/** A field's outgoing value, or the EMPTY marker. */
type Value = unknown;

const s = (v: string): Value => (v.trim() ? v.trim() : EMPTY);
const list = (v: string[]): Value => {
  const cleaned = v.map((x) => x.trim()).filter(Boolean);
  return cleaned.length ? cleaned : EMPTY;
};
const codes = (v: ResolvedCode[]): Value => (v.length ? v.map(cleanCode) : EMPTY);
const one = (v: ResolvedCode | null): Value => (v ? cleanCode(v) : EMPTY);

/** Strip anything a picker may have attached beyond { code, en, cnr }. */
function cleanCode(c: ResolvedCode): ResolvedCode {
  return { code: c.code, en: c.en, cnr: c.cnr };
}

function author(a: AuthorForm): Author | null {
  const out: Author = {};
  if (a.familyName.trim()) out.familyName = a.familyName.trim();
  if (a.firstName.trim()) out.firstName = a.firstName.trim();
  if (a.prefix.trim()) out.prefix = a.prefix.trim();
  if (a.romanNumerals.trim()) out.romanNumerals = a.romanNumerals.trim();
  if (a.dates.trim()) out.dates = a.dates.trim();
  if (a.role) out.role = cleanCode(a.role);
  if (a.responsibility) out.responsibility = a.responsibility;
  // A row without a name is an accidental blank, not an author.
  return out.familyName || out.firstName ? out : null;
}

function corporateBody(c: CorporateBodyForm): CorporateBody | null {
  if (!c.name.trim()) return null;
  const out: CorporateBody = { name: c.name.trim() };
  if (c.responsibility) out.responsibility = c.responsibility;
  return out;
}

function publication(p: PublicationForm): Value {
  const out: Publication = {};
  if (p.place.trim()) out.place = p.place.trim();
  if (p.publisher.trim()) out.publisher = p.publisher.trim();
  if (p.year.trim()) out.year = p.year.trim();
  if (p.placeOfManufacture.trim()) out.placeOfManufacture = p.placeOfManufacture.trim();
  if (p.manufacturerName.trim()) out.manufacturerName = p.manufacturerName.trim();
  return Object.keys(out).length ? out : EMPTY;
}

function issueOf(i: IssueForm): Value {
  const out: Issue = {};
  if (i.volume.trim()) out.volume = i.volume.trim();
  if (i.number.trim()) out.number = i.number.trim();
  if (i.date.trim()) out.date = i.date.trim();
  return Object.keys(out).length ? out : EMPTY;
}

/**
 * The numeric extent as stored: `{ value, unit }`. The unit is the one the
 * schema evaluates for the material type (pages, sheets, minutes); when the
 * type has none (the field is folded away) the stored unit is kept. Without
 * any unit there is nothing valid to send.
 */
function extentOf(value: number | null, unit: string | null | undefined, stored: unknown): Value {
  if (value === null || Number.isNaN(value)) return EMPTY;
  const storedUnit = (stored as { unit?: unknown } | null | undefined)?.unit;
  const resolved = unit ?? (typeof storedUnit === 'string' ? storedUnit : null);
  return resolved ? { value, unit: resolved } : EMPTY;
}

function textualCodes(t: TextualCodesForm): Value {
  const out: TextualMaterialCodes = {};
  if (t.illustrationCodes.length) out.illustrationCodes = t.illustrationCodes.map(cleanCode);
  if (t.contentTypeCodes.length) out.contentTypeCodes = t.contentTypeCodes.map(cleanCode);
  // COBISS only ever records `true`; an unchecked box is simply absent.
  if (t.conferencePublication) out.conferencePublication = true;
  if (t.festschrift) out.festschrift = true;
  if (t.indexIndicator) out.indexIndicator = true;
  if (t.literaryForm) out.literaryForm = cleanCode(t.literaryForm);
  if (t.biographyCode) out.biographyCode = cleanCode(t.biographyCode);
  return Object.keys(out).length ? out : EMPTY;
}

/**
 * Build the metadata to send. `base` is the metadata as loaded, so keys the
 * form does not own (`collectionType`, `_source`, the children counters) pass
 * through unchanged; the server drops the ones it manages itself.
 *
 * - `update`: an emptied field becomes `null`, which the server treats as
 *   "unset" (PATCH merges key by key, so leaving it out would keep the old value).
 * - `create`: an emptied field is left out of the payload.
 */
export function formToMetadata(
  form: MetadataForm,
  base: Record<string, unknown>,
  mode: 'create' | 'update',
  /** Unit code of the numeric extent for the current material type (from the schema rules). */
  extentUnit?: string | null,
): MetadataPayload {
  const values: Record<keyof DomainRecord, Value> = {
    cobissId: s(form.cobissId),
    title: form.title.trim(),
    subtitle: s(form.subtitle),
    titleMediumDesignation: s(form.titleMediumDesignation),
    titleByAnotherAuthor: s(form.titleByAnotherAuthor),
    parallelTitle: list(form.parallelTitle),
    titleInOtherScript: list(form.titleInOtherScript),
    materialType: one(form.materialType),
    recordType: one(form.recordType),
    bibliographicLevel: one(form.bibliographicLevel),
    documentTypology: s(form.documentTypology),
    firstResponsibility: s(form.firstResponsibility),
    subsequentResponsibility: list(form.subsequentResponsibility),
    authors: (() => {
      const rows = form.authors.map(author).filter((a): a is Author => a !== null);
      return rows.length ? rows : EMPTY;
    })(),
    corporateBodies: (() => {
      const rows = form.corporateBodies
        .map(corporateBody)
        .filter((c): c is CorporateBody => c !== null);
      return rows.length ? rows : EMPTY;
    })(),
    publication: publication(form.publication),
    edition: s(form.edition),
    publicationDate1: s(form.publicationDate1),
    publicationDate2: s(form.publicationDate2),
    issue: issueOf(form.issue),
    physicalDescription: s(form.physicalDescription),
    extent: extentOf(form.extentValue, extentUnit, base.extent),
    otherPhysicalDetails: s(form.otherPhysicalDetails),
    dimensions: s(form.dimensions),
    seriesTitle: s(form.seriesTitle),
    seriesSubtitle: s(form.seriesSubtitle),
    seriesResponsibility: s(form.seriesResponsibility),
    seriesIssn: s(form.seriesIssn),
    seriesVolume: s(form.seriesVolume),
    isbn: list(form.isbn),
    issn: list(form.issn),
    ismn: list(form.ismn),
    language: codes(form.language),
    originalLanguage: codes(form.originalLanguage),
    translationLanguages: codes(form.translationLanguages),
    country: codes(form.country),
    keywords: list(form.keywords),
    summaryNote: s(form.summaryNote),
    notes: list(form.notes),
    electronicLocation: (() => {
      const urls = form.electronicLocation.map((u) => u.trim()).filter(Boolean);
      return urls.length ? urls.map((url) => ({ url })) : EMPTY;
    })(),
    textualMaterialCodes: textualCodes(form.textualMaterialCodes),
    cartographicMathematicalData: s(form.cartographicMathematicalData),
    numberingAndDates: s(form.numberingAndDates),
    musicEditionStatement: s(form.musicEditionStatement),
  };

  const out: Record<string, unknown> = { ...base, collectionType: form.collectionType };
  for (const [key, value] of Object.entries(values)) {
    if (value === EMPTY) {
      if (mode === 'update') out[key] = null;
      else delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out as MetadataPayload;
}

/** The payload with every `null` removed — what the JSON tab shows. */
export function metadataForDisplay(payload: MetadataPayload): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== null && v !== undefined),
  );
}
