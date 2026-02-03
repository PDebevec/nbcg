import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { DomainRecord } from './cobiss.types.js';

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
 */

/**
 * Helper to get first occurrence of a subfield from the first field instance
 * Use this for: non-repeatable subfields in non-repeatable fields
 */
function first(raw: Record<string, any[]>, tag: string, code: string): string | undefined {
  return raw[tag]?.[0]?.subfields?.[code]?.[0];
}

/**
 * Helper to get all occurrences of a subfield from all field instances
 * Use this for: repeatable subfields OR when the field itself can repeat
 */
function all(raw: Record<string, any[]>, tag: string, code: string): string[] {
  return raw[tag]?.flatMap((f) => f.subfields[code] ?? []) ?? [];
}

/**
 * Helper to get all occurrences from the first field instance only
 * Use this for: repeatable subfields within a non-repeatable field
 */
function allFromFirst(raw: Record<string, any[]>, tag: string, code: string): string[] {
  return raw[tag]?.[0]?.subfields?.[code] ?? [];
}

/**
 * Helper to parse year from string (handles formats like "1999", "c1999", "1999-2000", etc.)
 */
function parseYear(yearStr?: string): number | undefined {
  if (!yearStr) return undefined;
  const match = yearStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Convert COMARC XML to semantic JSON
 */
export function recordXmlToJson(xml: string): DomainRecord {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const recordNode = doc.getElementsByTagName('record')[0];
  if (!recordNode) {
    throw new Error('Invalid COMARC record XML');
  }

  const datafields = Array.from(recordNode.getElementsByTagName('datafield'));

  // Parse all datafields into a structured format
  const raw: Record<string, any[]> = {};

  for (const field of datafields) {
    const tag = field.getAttribute('tag');
    if (!tag) continue;

    const entry = {
      ind1: field.getAttribute('ind1') ?? ' ',
      ind2: field.getAttribute('ind2') ?? ' ',
      subfields: {} as Record<string, string[]>,
    };

    const subfields = Array.from(field.getElementsByTagName('subfield'));
    for (const sf of subfields) {
      const code = sf.getAttribute('code');
      if (!code) continue;

      entry.subfields[code] ??= [];
      entry.subfields[code].push(sf.textContent?.trim() ?? '');
    }

    raw[tag] ??= [];
    raw[tag].push(entry);
  }

  // Build the semantic record
  const record: DomainRecord = {
    // ===== IDENTIFICATION BLOCK (0XX) =====
    externalId: first(raw, '001', 'x'),
    
    isbn: all(raw, '010', 'a'),
    isbnQualifications: all(raw, '010', 'b'),
    
    issn: all(raw, '011', 'a'),
    issnKeyTitle: first(raw, '011', 'e'),
    
    fingerprint: all(raw, '013', 'a'),
    
    isrc: all(raw, '016', 'a'),
    isrcQualifications: all(raw, '016', 'b'),
    
    otherIdentifiers: raw['017']?.map(f => ({
      identifier: f.subfields['a']?.[0] ?? '',
      type: f.subfields['b']?.[0],
    })).filter(x => x.identifier) ?? [],
    
    nationalBibNumber: all(raw, '020', 'a'),
    countryCode: all(raw, '020', 'b'),
    
    publisherNumber: raw['071']?.map(f => ({
      number: f.subfields['a']?.[0] ?? '',
      publisher: f.subfields['b']?.[0],
      type: f.ind1,
    })).filter(x => x.number) ?? [],

    // ===== CODED INFORMATION BLOCK (1XX) =====
    language: all(raw, '101', 'a'),
    originalLanguage: all(raw, '101', 'c'),
    translationLanguages: all(raw, '101', 'd'),
    tableOfContentsLanguages: all(raw, '101', 'f'),
    subtitleLanguages: all(raw, '101', 'g'),
    
    country: all(raw, '102', 'a'),
    locality: all(raw, '102', 'b'),
    
    textualMaterialCodes: raw['105']?.[0] ? {
      illustrationCodes: first(raw, '105', 'a'),
      formOfContent: first(raw, '105', 'b'),
      conferencePublication: first(raw, '105', 'c'),
      festschrift: first(raw, '105', 'd'),
      indexIndicator: first(raw, '105', 'e'),
      literaryFormCode: first(raw, '105', 'f'),
      biographyCode: first(raw, '105', 'g'),
    } : undefined,

    // ===== DESCRIPTIVE INFORMATION BLOCK (2XX) =====
    title: first(raw, '200', 'a'),
    titleMediumDesignation: first(raw, '200', 'b'),
    titleByAnotherAuthor: first(raw, '200', 'c'),
    parallelTitle: allFromFirst(raw, '200', 'd'),           // Repeatable within field
    subtitle: first(raw, '200', 'e'),
    parallelSubtitle: allFromFirst(raw, '200', 'f'),         // Repeatable within field
    firstResponsibility: first(raw, '200', 'g'),
    subsequentResponsibility: allFromFirst(raw, '200', 'h'), // Repeatable within field

    edition: first(raw, '205', 'a'),
    editionResponsibility: first(raw, '205', 'f'),
    parallelEdition: first(raw, '205', 'd'),

    publication: {
      place: first(raw, '210', 'a'),
      publisher: first(raw, '210', 'c'),
      year: parseYear(first(raw, '210', 'd')),
      placeOfManufacture: first(raw, '210', 'e'),
      manufacturerName: first(raw, '210', 'g'),
      manufacturerDate: first(raw, '210', 'h'),
    },

    physicalDescription: [
      first(raw, '215', 'a'),
      first(raw, '215', 'd'),
    ]
      .filter(Boolean)
      .join(', '),
    otherPhysicalDetails: first(raw, '215', 'c'),
    dimensions: first(raw, '215', 'd'),
    accompanyingMaterial: first(raw, '215', 'e'),

    seriesTitle: first(raw, '225', 'a'),
    seriesSubtitle: first(raw, '225', 'e'),
    seriesResponsibility: first(raw, '225', 'f'),
    seriesIssn: first(raw, '225', 'x'),
    seriesVolume: first(raw, '225', 'v'),

    // ===== NOTES BLOCK (3XX) =====
    notes: all(raw, '300', 'a'),
    notesOnIdentifiers: all(raw, '301', 'a'),
    notesOnTitle: all(raw, '304', 'a'),
    notesOnEdition: all(raw, '305', 'a'),
    notesOnPublication: all(raw, '306', 'a'),
    notesOnLinkingFields: all(raw, '311', 'a'),
    notesOnIntellectualResp: all(raw, '314', 'a'),
    notesOnLanguage: all(raw, '316', 'a'),
    notesOnPhysicalDesc: all(raw, '317', 'a'),
    notesOnContents: all(raw, '327', 'a'),
    notesOnContinuation: all(raw, '320', 'a'),
    notesOnBinding: all(raw, '321', 'a'),
    notesOnFrequency: all(raw, '326', 'a'),
    
    abstract: first(raw, '330', 'a'),
    notesOnUsers: first(raw, '333', 'a'),
    notesOnAwards: all(raw, '334', 'a'),
    notesOnElectronicResource: first(raw, '336', 'a'),
    systemRequirements: first(raw, '337', 'a'),
    financingNotes: all(raw, '338', 'a'),

    // ===== LINKING ENTRY BLOCK (4XX) =====
    series: raw['410']?.map(f => ({
      title: f.subfields['t']?.[0] ?? '',
      issn: f.subfields['x']?.[0],
      volume: f.subfields['v']?.[0],
    })).filter(x => x.title) ?? [],
    
    supplementTo: raw['421']?.map(f => ({
      title: f.subfields['t']?.[0] ?? '',
      issn: f.subfields['x']?.[0],
    })).filter(x => x.title) ?? [],
    
    issuedWith: raw['422']?.map(f => ({
      title: f.subfields['t']?.[0] ?? '',
    })).filter(x => x.title) ?? [],

    // ===== RELATED TITLES BLOCK (5XX) =====
    uniformTitle: first(raw, '500', 'a'),
    uniformTitleQualifiers: first(raw, '500', 'h'),
    titleLatex: first(raw, '539', 'a'),

    // ===== SUBJECT ANALYSIS BLOCK (6XX) =====
    personalNameSubjects: raw['600']?.map(f => ({
      familyName: f.subfields['a']?.[0] ?? '',
      firstName: f.subfields['b']?.[0],
      dates: f.subfields['f']?.[0],
      numeration: f.subfields['d']?.[0],
      qualifier: f.subfields['c']?.[0],
    })).filter(x => x.familyName) ?? [],

    corporateBodySubjects: raw['601']?.map(f => ({
      name: f.subfields['a']?.[0] ?? '',
      subdivision: f.subfields['b'] ?? [],
      location: f.subfields['e']?.[0],
      dates: f.subfields['f']?.[0],
    })).filter(x => x.name) ?? [],

    familyNameSubjects: raw['602']?.map(f => ({
      familyName: f.subfields['a']?.[0] ?? '',
      dates: f.subfields['f']?.[0],
    })).filter(x => x.familyName) ?? [],

    uniformTitleSubjects: raw['605']?.map(f => ({
      title: f.subfields['a']?.[0] ?? '',
    })).filter(x => x.title) ?? [],

    subjects: all(raw, '606', 'a'),
    subjectSubdivisions: raw['606']?.map(f => [
      ...(f.subfields['x'] ?? []),
      ...(f.subfields['y'] ?? []),
      ...(f.subfields['z'] ?? []),
    ]).filter(arr => arr.length > 0) ?? [],

    geographicalSubjects: raw['607']?.map(f => ({
      name: f.subfields['a']?.[0] ?? '',
      subdivision: [
        ...(f.subfields['x'] ?? []),
        ...(f.subfields['y'] ?? []),
        ...(f.subfields['z'] ?? []),
      ],
    })).filter(x => x.name) ?? [],

    formGenreSubjects: raw['608']?.map(f => ({
      term: f.subfields['a']?.[0] ?? '',
    })).filter(x => x.term) ?? [],

    uncontrolledKeywords: raw['610']?.map(f => ({
      term: f.subfields['a']?.[0] ?? '',
    })).filter(x => x.term) ?? [],

    // ===== CLASSIFICATION BLOCK (67X) =====
    classifications: all(raw, '675', 'a'),
    udcAccessCodes: all(raw, '675', 'c'),
    udcShortCodes: all(raw, '675', 'v'),
    
    deweyClassification: all(raw, '676', 'a'),
    lcClassification: all(raw, '680', 'a'),
    
    otherClassifications: raw['686']?.map(f => ({
      code: f.subfields['a']?.[0] ?? '',
      system: f.subfields['2']?.[0],
    })).filter(x => x.code) ?? [],

    // ===== INTELLECTUAL RESPONSIBILITY BLOCK (7XX) =====
    authors: [
      // 700 - Primary responsibility
      ...(raw['700']?.map((f) => ({
        familyName: f.subfields['a']?.[0],
        firstName: f.subfields['b']?.[0],
        fullName: [f.subfields['b']?.[0], f.subfields['a']?.[0]]
          .filter(Boolean)
          .join(' '),
        prefix: f.subfields['c']?.[0],
        romanNumerals: f.subfields['d']?.[0],
        dates: f.subfields['f']?.[0],
        role: f.subfields['4']?.[0] ?? 'author',
        responsibility: 'primary' as const,
      })) ?? []),
      // 701 - Alternative responsibility
      ...(raw['701']?.map((f) => ({
        familyName: f.subfields['a']?.[0],
        firstName: f.subfields['b']?.[0],
        fullName: [f.subfields['b']?.[0], f.subfields['a']?.[0]]
          .filter(Boolean)
          .join(' '),
        prefix: f.subfields['c']?.[0],
        romanNumerals: f.subfields['d']?.[0],
        dates: f.subfields['f']?.[0],
        role: f.subfields['4']?.[0] ?? 'author',
        responsibility: 'alternative' as const,
      })) ?? []),
      // 702 - Secondary responsibility
      ...(raw['702']?.map((f) => ({
        familyName: f.subfields['a']?.[0],
        firstName: f.subfields['b']?.[0],
        fullName: [f.subfields['b']?.[0], f.subfields['a']?.[0]]
          .filter(Boolean)
          .join(' '),
        prefix: f.subfields['c']?.[0],
        romanNumerals: f.subfields['d']?.[0],
        dates: f.subfields['f']?.[0],
        role: f.subfields['4']?.[0] ?? 'contributor',
        responsibility: 'secondary' as const,
      })) ?? []),
    ],

    corporateBodies: [
      // 710 - Primary responsibility
      ...(raw['710']?.map((f) => ({
        name: f.subfields['a']?.[0] ?? '',
        subdivision: f.subfields['b'] ?? [],
        location: f.subfields['e']?.[0],
        dates: f.subfields['f']?.[0],
        role: f.subfields['4']?.[0],
        responsibility: 'primary' as const,
      })) ?? []),
      // 711 - Alternative responsibility
      ...(raw['711']?.map((f) => ({
        name: f.subfields['a']?.[0] ?? '',
        subdivision: f.subfields['b'] ?? [],
        location: f.subfields['e']?.[0],
        dates: f.subfields['f']?.[0],
        role: f.subfields['4']?.[0],
        responsibility: 'alternative' as const,
      })) ?? []),
      // 712 - Secondary responsibility
      ...(raw['712']?.map((f) => ({
        name: f.subfields['a']?.[0] ?? '',
        subdivision: f.subfields['b'] ?? [],
        location: f.subfields['e']?.[0],
        dates: f.subfields['f']?.[0],
        role: f.subfields['4']?.[0],
        responsibility: 'secondary' as const,
      })) ?? []),
    ].filter(x => x.name),

    // ===== INTERNATIONAL USE BLOCK (8XX) =====
    electronicLocation: raw['856']?.map(f => ({
      url: f.subfields['u']?.[0] ?? '',
      accessMethod: f.subfields['2']?.[0],
      linkText: f.subfields['y']?.[0],
      publicNote: f.subfields['z']?.[0],
    })).filter(x => x.url) ?? [],
  };

  return pruneEmpty(record);
}

function pruneEmpty<T>(value: T): T {
  if (Array.isArray(value)) {
    const cleaned = value
      .map(pruneEmpty)
      .filter(
        (v) =>
          v !== undefined &&
          !(Array.isArray(v) && v.length === 0) &&
          !(typeof v === 'object' && v !== null && Object.keys(v).length === 0)
      );

    return cleaned.length > 0 ? (cleaned as T) : (undefined as T);
  }

  if (typeof value === 'object' && value !== null) {
    const result: any = {};

    for (const [key, val] of Object.entries(value)) {
      const cleaned = pruneEmpty(val);
      if (
        cleaned !== undefined &&
        !(Array.isArray(cleaned) && cleaned.length === 0) &&
        !(typeof cleaned === 'object' &&
          cleaned !== null &&
          Object.keys(cleaned).length === 0)
      ) {
        result[key] = cleaned;
      }
    }

    return Object.keys(result).length > 0 ? result : (undefined as T);
  }

  return value;
}