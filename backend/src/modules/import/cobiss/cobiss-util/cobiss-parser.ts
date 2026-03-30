import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { DomainRecord } from './cobiss.types';
import { resolveLanguage, resolveCountry, resolveRecordType, resolveBibliographicLevel, resolveMaterialType, resolveIllustrationCode, resolveContentType, resolveLiteraryForm, resolveBiographyCode, resolveRelatorCode } from './cobiss-code-map';

export function extractFirstRecordXml(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const recordsNode = doc.getElementsByTagName('records')[0];
  if (!recordsNode) return null;

  const recordNode = recordsNode.getElementsByTagName('record')[0];
  if (!recordNode) return null;

  const serializer = new XMLSerializer();
  const recordXml = serializer.serializeToString(recordNode);

  return `<?xml version="1.0" encoding="utf-8"?>\n${recordXml}`;
}

/**
 * Comprehensive COMARC XML → semantic JSON converter
 * Based on COMARC/B Format for Bibliographic Data
 * https://home.izum.si/izum/e_manuals_html/COMARC_B/eng/
 *
 * Only fields marked RED in the COMARC/B spec are mapped.
 */

// ---------------------------------------------------------------------------
// Raw field helpers
// ---------------------------------------------------------------------------

type RawField = {
  ind1: string;
  ind2: string;
  subfields: Record<string, string[]>;
};

type RawRecord = Record<string, RawField[]>;

/**
 * First value of a subfield from the first occurrence of a field.
 * Use for: non-repeatable subfield in a non-repeatable field.
 */
function first(raw: RawRecord, tag: string, code: string): string | undefined {
  return raw[tag]?.[0]?.subfields?.[code]?.[0];
}

/**
 * All values of a subfield across every occurrence of a field.
 * Use for: repeatable fields where each occurrence contributes one value
 * (e.g. 010/a – each 010 field carries one ISBN).
 */
function all(raw: RawRecord, tag: string, code: string): string[] {
  return raw[tag]?.flatMap((f) => f.subfields[code] ?? []) ?? [];
}

/**
 * All values of a subfield from the first occurrence of a field only.
 * Use for: repeatable subfields within a non-repeatable field
 * (e.g. 200/d – multiple parallel titles inside a single title field).
 */
function allFromFirst(raw: RawRecord, tag: string, code: string): string[] {
  return raw[tag]?.[0]?.subfields?.[code] ?? [];
}

/**
 * Parse a 4-digit year out of strings like "1999", "c1999", "1999-2000".
 */
function parseYear(yearStr?: string): number | undefined {
  if (!yearStr) return undefined;
  const match = yearStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

/**
 * Convert a COMARC/B XML record string to a DomainRecord.
 */
export function recordXmlToJson(xml: string, cobissId?: string): DomainRecord {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const recordNode = doc.getElementsByTagName('record')[0];
  if (!recordNode) {
    throw new Error('Invalid COMARC record XML: no <record> element found');
  }

  // Build raw lookup: tag → array of { ind1, ind2, subfields }
  const raw: RawRecord = {};

  for (const field of Array.from(recordNode.getElementsByTagName('datafield'))) {
    const tag = field.getAttribute('tag');
    if (!tag) continue;

    const entry: RawField = {
      ind1: field.getAttribute('ind1') ?? ' ',
      ind2: field.getAttribute('ind2') ?? ' ',
      subfields: {},
    };

    for (const sf of Array.from(field.getElementsByTagName('subfield'))) {
      const code = sf.getAttribute('code');
      if (!code) continue;
      entry.subfields[code] ??= [];
      entry.subfields[code].push(sf.textContent?.trim() ?? '');
    }

    raw[tag] ??= [];
    raw[tag].push(entry);
  }

  // Parse controlfields (001, etc.) — positional string fields without subfield tags
  const field001 = raw['001']?.[0]?.subfields ?? {};

  // ---------------------------------------------------------------------------
  // Map raw fields → DomainRecord (red fields only)
  // ---------------------------------------------------------------------------

  const record: DomainRecord = {

    cobissId, 

    // ===== 0XX – IDENTIFICATION BLOCK =====

    recordType:         field001['b']?.[0] ? resolveRecordType(field001['b'][0])         : undefined,
    bibliographicLevel: field001['c']?.[0] ? resolveBibliographicLevel(field001['c'][0]) : undefined,
    materialType:       (field001['b']?.[0] && field001['c']?.[0])
      ? resolveMaterialType(field001['b'][0], field001['c'][0])
      : undefined,
    documentTypology:   field001['t']?.[0],

    // 010 – ISBN (field is repeatable; each carries one ISBN in /a)
    isbn: all(raw, '010', 'a'),

    // 011 – ISSN (field is repeatable; each carries one ISSN in /a)
    issn: all(raw, '011', 'a'),

    // 013 – ISMN (field is repeatable; each carries one ISMN in /a)
    ismn: all(raw, '013', 'a'),

    // ===== 1XX – CODED INFORMATION BLOCK =====

    // 100 – Date of publication, production, etc.
    publicationDate1:    first(raw, '100', 'c'),
    publicationDate2:    first(raw, '100', 'd'),

    // 101 – Language of the item (ISO 639-2/B codes → resolved to full names)
    language:             all(raw, '101', 'a').map(resolveLanguage),
    originalLanguage:     all(raw, '101', 'c').map(resolveLanguage),
    translationLanguages: all(raw, '101', 'd').map(resolveLanguage),

    // 102 – Country of publication (UNIMARC country codes → resolved to full names)
    country: all(raw, '102', 'a').map(resolveCountry),

    // 105 – Textual material codes (non-repeatable field, all subfields single-value)
    textualMaterialCodes: (() => {
      const f = raw['105']?.[0];
      if (!f) return undefined;
      return {
        illustrationCodes: f.subfields['a']?.map(resolveIllustrationCode),
        contentTypeCodes:  f.subfields['b']?.map(resolveContentType),
        conferencePublication: f.subfields['c']?.[0] === '1' ? true : undefined,
        festschrift:           f.subfields['d']?.[0] === '1' ? true : undefined,
        indexIndicator:        f.subfields['e']?.[0] === '1' ? true : undefined,
        literaryForm:  f.subfields['f']?.[0] ? resolveLiteraryForm(f.subfields['f'][0]) : undefined,
        biographyCode: f.subfields['g']?.[0] ? resolveBiographyCode(f.subfields['g'][0]) : undefined,
      };
    })(),

    // ===== 2XX – DESCRIPTIVE INFORMATION BLOCK =====

    // 200 – Title and statement of responsibility (non-repeatable field)
    //   /a  title proper
    //   /b  general material designation
    //   /c  title proper by another author
    //   /d  parallel title (repeatable subfield)
    //   /e  other title information / subtitle
    //   /f  first statement of responsibility
    //   /g  subsequent statement(s) of responsibility (repeatable subfield)
    title:                    first(raw, '200', 'a'),
    titleMediumDesignation:   first(raw, '200', 'b'),
    titleByAnotherAuthor:     first(raw, '200', 'c'),
    parallelTitle:            allFromFirst(raw, '200', 'd'),
    subtitle:                 first(raw, '200', 'e'),
    firstResponsibility:      first(raw, '200', 'f'),
    subsequentResponsibility: allFromFirst(raw, '200', 'g'),

    // 205 – Edition statement (non-repeatable field)
    edition: first(raw, '205', 'a'),

    // 206 – Cartographic material – mathematical data
    cartographicMathematicalData: first(raw, '206', 'a'),

    // 207 – Continuing sources – numbering
    numberingAndDates: first(raw, '207', 'a'),

    // 208 – Music edition statement
    musicEditionStatement: first(raw, '208', 'a'),

    // 210 – Publication, distribution, etc. (non-repeatable field)
    publication: raw['210']?.[0] ? {
      place:            first(raw, '210', 'a'),
      publisher:        first(raw, '210', 'c'),
      year:             first(raw, '210', 'd'),
      placeOfManufacture: first(raw, '210', 'e'),
      manufacturerName: first(raw, '210', 'g'),
    } : undefined,

    // 215 – Physical description (non-repeatable field)
    physicalDescription: first(raw, '215', 'a'),
    otherPhysicalDetails: first(raw, '215', 'c'),
    dimensions:          first(raw, '215', 'd'),

    // 225 – Series (non-repeatable field)
    seriesTitle:          first(raw, '225', 'a'),
    seriesSubtitle:       first(raw, '225', 'e'),
    seriesResponsibility: first(raw, '225', 'f'),
    seriesIssn:           first(raw, '225', 'x'),
    seriesVolume:         first(raw, '225', 'v'),

    // ===== 3XX – NOTES BLOCK =====

    // 300 – General notes (field is repeatable; collect all /a values)
    notes: all(raw, '300', 'a'),

    // ===== 5XX – NOTES BLOCK =====

    // 518 – Title in another script (field is repeatable; collect all /a values)
    titleInOtherScript: all(raw, '518', 'a'),

    // ===== 7XX – INTELLECTUAL RESPONSIBILITY BLOCK =====

    // 700 / 701 / 702 – Personal names (primary / alternative / secondary)
    authors: [
      ...(raw['700']?.map((f) => ({
        familyName:    f.subfields['a']?.[0],
        firstName:     f.subfields['b']?.[0],
        prefix:        f.subfields['c']?.[0],
        romanNumerals: f.subfields['d']?.[0],
        dates:         f.subfields['f']?.[0],
        role: f.subfields['4']?.[0] ? resolveRelatorCode(f.subfields['4'][0]) : undefined,
        responsibility: 'primary' as const,
      })) ?? []),
      ...(raw['701']?.map((f) => ({
        familyName:    f.subfields['a']?.[0],
        firstName:     f.subfields['b']?.[0],
        prefix:        f.subfields['c']?.[0],
        romanNumerals: f.subfields['d']?.[0],
        dates:         f.subfields['f']?.[0],
        role: f.subfields['4']?.[0] ? resolveRelatorCode(f.subfields['4'][0]) : undefined,
        responsibility: 'alternative' as const,
      })) ?? []),
      ...(raw['702']?.map((f) => ({
        familyName:    f.subfields['a']?.[0],
        firstName:     f.subfields['b']?.[0],
        prefix:        f.subfields['c']?.[0],
        romanNumerals: f.subfields['d']?.[0],
        dates:         f.subfields['f']?.[0],
        role: f.subfields['4']?.[0] ? resolveRelatorCode(f.subfields['4'][0]) : undefined,
        responsibility: 'secondary' as const,
      })) ?? []),
    ].filter((a) => a.familyName || a.firstName),

    // 710 – Corporate body primary responsibility
    corporateBodies: [
      ...(raw['710']?.map((f) => ({
        name:           f.subfields['a']?.[0] ?? '',
        responsibility: 'primary' as const,
      })) ?? []),
    ].filter((c) => c.name),

    // ===== 8XX – INTERNATIONAL USE BLOCK =====

    // 856 – Electronic location and access (field is repeatable)
    electronicLocation: raw['856']
      ?.map((f) => ({
        url: f.subfields['u']?.[0] ?? '',
      }))
      .filter((e) => e.url),
  };

  return pruneEmpty(record);
}

// ---------------------------------------------------------------------------
// Utility: remove undefined / empty arrays / empty objects recursively
// ---------------------------------------------------------------------------

function pruneEmpty<T>(value: T): T {
  if (Array.isArray(value)) {
    const cleaned = value
      .map(pruneEmpty)
      .filter(
        (v) =>
          v !== undefined &&
          v !== null &&
          !(Array.isArray(v) && v.length === 0) &&
          !(typeof v === 'object' && Object.keys(v as object).length === 0),
      );
    return (cleaned.length > 0 ? cleaned : undefined) as T;
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as object)) {
      const cleaned = pruneEmpty(val);
      if (
        cleaned !== undefined &&
        cleaned !== null &&
        !(Array.isArray(cleaned) && cleaned.length === 0) &&
        !(typeof cleaned === 'object' && Object.keys(cleaned as object).length === 0)
      ) {
        result[key] = cleaned;
      }
    }
    return (Object.keys(result).length > 0 ? result : undefined) as T;
  }

  return value;
}