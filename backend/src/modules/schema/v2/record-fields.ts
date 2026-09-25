import type { Condition, Constraints, Rule } from '../rules/evaluate';
import { RULE_LABELS } from './labels';
import type { ContextKey, FieldType, StoreAs, Unit } from './schema-v2.types';
import { vocabularyValue } from './vocabularies';

// The v2 record field list. Hand-written data only: labels come from
// `labels.ts`, `input` and `order` are computed by `build-schema.ts`, and the
// self-check verifies every key and shape against what the API accepts.
//
// Rules follow the contract's "Initial rule set" (docs/shared/plans/
// metadata-schema-v2.md), still to be confirmed with the library. Material-type
// categories are keyed on `recordType`: a b text, c d music, e f maps,
// g video, i j sound, k graphics, l electronic, m multimedia, r 3-D objects.

/** What a rule may look at. `buildContext()` in `../rules/evaluate.ts` computes exactly these. */
export const CONTEXT_KEYS: ContextKey[] = [
  { key: 'materialType', type: 'string', source: 'item', path: 'materialType.code',
    description: '2-char COBISS code, e.g. am = book, em = printed map' },
  { key: 'recordType', type: 'string', source: 'item', path: 'recordType.code',
    fallback: 'materialType.code[0]' },
  { key: 'bibliographicLevel', type: 'string', source: 'item', path: 'bibliographicLevel.code',
    fallback: 'materialType.code[1]' },
  { key: 'collectionType', type: 'number', source: 'item', path: 'collectionType', default: 0 },
  { key: 'isChild', type: 'boolean', source: 'parent',
    description: 'the item has at least one parent' },
  { key: 'parentCollectionType', type: 'number[]', source: 'parent', path: 'collectionType',
    description: 'collectionType of every parent; [] when there is none' },
  { key: 'itemState', type: 'string', source: 'item',
    description: 'NEW | DRAFT | RECORD — where the item is now (NEW = not created yet)' },
  { key: 'targetState', type: 'string', source: 'item',
    description: 'DRAFT | RECORD — the state it is being saved as' },
];

/** Sections, in display order. Labels in `labels.ts`. */
export const GROUP_KEYS = [
  'basic', 'issue', 'identification', 'title', 'responsibility', 'edition', 'publication',
  'physical', 'series', 'dates', 'language', 'textualMaterial', 'subject', 'notes', 'electronic',
] as const;

export type GroupKey = (typeof GROUP_KEYS)[number];

export interface FieldSpec {
  key: string;
  type: FieldType;
  multiple?: boolean;
  /** Top-level fields only; `objectShape` children inherit their parent's group. */
  group?: GroupKey;
  /** `enum` only. `storeAs` defaults to the vocabulary's own. */
  vocabulary?: string;
  storeAs?: StoreAs;
  /** A `/search/suggest` field name (must be in SUGGEST_FIELDS). */
  suggest?: string;
  required?: boolean;
  visible?: boolean;
  readOnly?: boolean;
  unit?: Unit;
  constraints?: Constraints;
  rules?: Rule[];
  objectShape?: FieldSpec[];
  parentInheritable?: boolean;
  issueIdentifying?: boolean;
  /** The value a new item starts with — a stored value (a code for a `storeAs: code` enum). */
  default?: string | number | boolean;
}

// ─── rule helpers ───────────────────────────────────────────────────────────

const recordTypeIn = (...codes: string[]): Condition => ({ ref: 'recordType', in: codes });

/** The item is an issue of a serial collection. */
const UNDER_SERIAL: Condition = { ref: 'parentCollectionType', eq: 4 };

/**
 * The save goes to RECORD. The publish fields are required only then; a draft
 * needs only what the base `required` flags ask for (title, material type, …).
 */
const FOR_RECORD: Condition = { ref: 'targetState', eq: 'RECORD' };

/**
 * v1's `levels: ['main']`. An issue of a serial takes these from its parent;
 * children of other collections keep them. Always the LAST rule of a field, so
 * it wins over the material-type rules.
 */
const HIDE_UNDER_SERIAL: Rule = { when: UNDER_SERIAL, set: { visible: false } };

const unit = (code: string): Unit => {
  const v = vocabularyValue('extentUnit', code);
  return { code: String(v.code), en: v.en, cnr: v.cnr };
};

// ─── the list ───────────────────────────────────────────────────────────────

export const RECORD_FIELD_SPECS: FieldSpec[] = [
  // ── basic ──
  { key: 'title', type: 'string', group: 'basic', required: true, parentInheritable: true },
  {
    key: 'collectionType', type: 'enum', vocabulary: 'collectionType', group: 'basic', required: true,
    default: 0,
    // An issue is not a collection.
    rules: [HIDE_UNDER_SERIAL],
  },

  // ── issue (children of a serial collection) ──
  {
    key: 'issue', type: 'object', group: 'issue', visible: false, issueIdentifying: true,
    rules: [{ when: UNDER_SERIAL, set: { visible: true } }],
    objectShape: [
      { key: 'volume', type: 'string', issueIdentifying: true },
      { key: 'number', type: 'string', issueIdentifying: true, rules: [{ when: FOR_RECORD, set: { required: true } }] },
      {
        key: 'date', type: 'date', issueIdentifying: true,
        constraints: { pattern: '^\\d{4}(-\\d{2}(-\\d{2})?)?$', patternHint: RULE_LABELS.partialDate },
        rules: [{ when: FOR_RECORD, set: { required: true } }],
      },
    ],
  },

  // ── identification (0XX) ──
  {
    key: 'cobissId', type: 'string', group: 'identification',
    // Baked into the item id at creation; PATCH rejects a change.
    rules: [{ when: { not: { ref: 'itemState', eq: 'NEW' } }, set: { readOnly: true, help: RULE_LABELS.cobissIdLocked } }],
  },
  { key: 'recordType', type: 'enum', vocabulary: 'recordType', group: 'identification', parentInheritable: true },
  { key: 'bibliographicLevel', type: 'enum', vocabulary: 'bibliographicLevel', group: 'identification', parentInheritable: true },
  // Drives every other rule, hence required for drafts too.
  { key: 'materialType', type: 'enum', vocabulary: 'materialType', group: 'identification', required: true, parentInheritable: true },
  { key: 'documentTypology', type: 'string', group: 'identification' },
  {
    key: 'isbn', type: 'string', multiple: true, group: 'identification',
    rules: [{ when: { any: [{ ref: 'bibliographicLevel', eq: 's' }, UNDER_SERIAL] }, set: { visible: false } }],
  },
  {
    key: 'issn', type: 'string', multiple: true, group: 'identification', visible: false, parentInheritable: true,
    rules: [{
      when: { any: [{ ref: 'bibliographicLevel', in: ['s', 'i'] }, { ref: 'collectionType', eq: 4 }, UNDER_SERIAL] },
      set: { visible: true },
    }],
  },
  {
    key: 'ismn', type: 'string', multiple: true, group: 'identification', visible: false,
    rules: [{ when: recordTypeIn('c', 'd'), set: { visible: true } }, HIDE_UNDER_SERIAL],
  },

  // ── title (200) ──
  { key: 'subtitle', type: 'string', group: 'title', parentInheritable: true },
  { key: 'parallelTitle', type: 'string', multiple: true, group: 'title', parentInheritable: true },
  { key: 'titleInOtherScript', type: 'string', multiple: true, group: 'title', parentInheritable: true },
  { key: 'titleByAnotherAuthor', type: 'string', group: 'title', rules: [HIDE_UNDER_SERIAL] },
  { key: 'titleMediumDesignation', type: 'string', group: 'title', parentInheritable: true },

  // ── responsibility (200 f/g, 7XX) ──
  { key: 'firstResponsibility', type: 'string', group: 'responsibility', parentInheritable: true },
  { key: 'subsequentResponsibility', type: 'string', multiple: true, group: 'responsibility', parentInheritable: true },
  {
    key: 'authors', type: 'object', multiple: true, group: 'responsibility', suggest: 'author',
    parentInheritable: true, rules: [HIDE_UNDER_SERIAL],
    objectShape: [
      { key: 'familyName', type: 'string' },
      { key: 'firstName', type: 'string' },
      { key: 'prefix', type: 'string' },
      { key: 'romanNumerals', type: 'string' },
      { key: 'dates', type: 'string' },
      { key: 'role', type: 'enum', vocabulary: 'relator' },
      { key: 'responsibility', type: 'enum', vocabulary: 'responsibility' },
    ],
  },
  {
    key: 'corporateBodies', type: 'object', multiple: true, group: 'responsibility',
    parentInheritable: true, rules: [HIDE_UNDER_SERIAL],
    objectShape: [
      { key: 'name', type: 'string', required: true, suggest: 'corporateBody' },
      { key: 'responsibility', type: 'enum', vocabulary: 'responsibility' },
    ],
  },

  // ── edition and material-specific data (205–208) ──
  { key: 'edition', type: 'string', group: 'edition', suggest: 'edition', rules: [HIDE_UNDER_SERIAL] },
  {
    key: 'cartographicMathematicalData', type: 'string', group: 'edition', visible: false,
    rules: [
      { when: recordTypeIn('e', 'f'), set: { visible: true, label: RULE_LABELS.scale, help: RULE_LABELS.scaleHelp } },
      { when: { all: [recordTypeIn('e', 'f'), FOR_RECORD] }, set: { required: true } },
      HIDE_UNDER_SERIAL,
    ],
  },
  {
    // The serial's own numbering ("God. 1, br. 1 (1944)-"); an issue uses `issue`.
    key: 'numberingAndDates', type: 'string', group: 'edition', visible: false,
    rules: [{
      when: { any: [{ ref: 'bibliographicLevel', in: ['s', 'i'] }, { ref: 'collectionType', eq: 4 }] },
      set: { visible: true },
    }],
  },
  {
    key: 'musicEditionStatement', type: 'string', group: 'edition', visible: false,
    rules: [{ when: recordTypeIn('c', 'd', 'j'), set: { visible: true } }, HIDE_UNDER_SERIAL],
  },

  // ── publication (210) ──
  {
    key: 'publication', type: 'object', group: 'publication', parentInheritable: true,
    objectShape: [
      { key: 'place', type: 'string', suggest: 'place', parentInheritable: true },
      { key: 'publisher', type: 'string', suggest: 'publisher', parentInheritable: true },
      { key: 'year', type: 'string', issueIdentifying: true },
      { key: 'placeOfManufacture', type: 'string', suggest: 'placeOfManufacture' },
      { key: 'manufacturerName', type: 'string', suggest: 'manufacturerName' },
    ],
  },

  // ── physical description (215) ──
  { key: 'physicalDescription', type: 'string', group: 'physical', suggest: 'physicalDescription' },
  {
    // The same number for every type; only the unit and caption change.
    // Required only to publish, and never on a collection: the extent lives on
    // its children.
    key: 'extent', type: 'quantity', group: 'physical', visible: false, constraints: { min: 0 },
    rules: [
      { when: recordTypeIn('a', 'b', 'c', 'd'), set: { visible: true, unit: unit('pages'), label: RULE_LABELS.extentPages } },
      { when: recordTypeIn('g', 'i', 'j'), set: { visible: true, unit: unit('minutes'), label: RULE_LABELS.extentMinutes } },
      { when: recordTypeIn('e', 'f', 'k'), set: { visible: true, unit: unit('sheets'), label: RULE_LABELS.extentSheets } },
      {
        when: { all: [{ ref: 'collectionType', eq: 0 }, recordTypeIn('a', 'b', 'g', 'i', 'j'), FOR_RECORD] },
        set: { required: true },
      },
    ],
  },
  { key: 'otherPhysicalDetails', type: 'string', group: 'physical' },
  { key: 'dimensions', type: 'string', group: 'physical', suggest: 'dimensions', parentInheritable: true },

  // ── series (225) ──
  { key: 'seriesTitle', type: 'string', group: 'series', suggest: 'seriesTitle', parentInheritable: true },
  { key: 'seriesSubtitle', type: 'string', group: 'series', parentInheritable: true },
  { key: 'seriesResponsibility', type: 'string', group: 'series', parentInheritable: true },
  { key: 'seriesIssn', type: 'string', group: 'series', parentInheritable: true },
  { key: 'seriesVolume', type: 'string', group: 'series', issueIdentifying: true },

  // ── coded dates (100) ── COBISS writes e.g. "19uu", so these stay strings.
  { key: 'publicationDate1', type: 'string', group: 'dates' },
  { key: 'publicationDate2', type: 'string', group: 'dates' },

  // ── languages and countries (101, 102) ──
  { key: 'language', type: 'enum', multiple: true, vocabulary: 'language', group: 'language', parentInheritable: true },
  { key: 'originalLanguage', type: 'enum', multiple: true, vocabulary: 'language', group: 'language', parentInheritable: true },
  { key: 'translationLanguages', type: 'enum', multiple: true, vocabulary: 'language', group: 'language', parentInheritable: true },
  { key: 'country', type: 'enum', multiple: true, vocabulary: 'country', group: 'language', parentInheritable: true },

  // ── coded data for textual material (105) ──
  {
    key: 'textualMaterialCodes', type: 'object', group: 'textualMaterial', visible: false,
    rules: [{ when: recordTypeIn('a', 'b'), set: { visible: true } }, HIDE_UNDER_SERIAL],
    objectShape: [
      { key: 'illustrationCodes', type: 'enum', multiple: true, vocabulary: 'illustration' },
      { key: 'contentTypeCodes', type: 'enum', multiple: true, vocabulary: 'contentType' },
      { key: 'conferencePublication', type: 'boolean' },
      { key: 'festschrift', type: 'boolean' },
      { key: 'indexIndicator', type: 'boolean' },
      { key: 'literaryForm', type: 'enum', vocabulary: 'literaryForm' },
      { key: 'biographyCode', type: 'enum', vocabulary: 'biography' },
    ],
  },

  // ── subject (610) ──
  { key: 'keywords', type: 'string', multiple: true, group: 'subject', suggest: 'keywords' },

  // ── notes (300, 330) ──
  { key: 'summaryNote', type: 'text', group: 'notes' },
  { key: 'notes', type: 'text', multiple: true, group: 'notes' },

  // ── online locations (856) ──
  {
    key: 'electronicLocation', type: 'object', multiple: true, group: 'electronic',
    objectShape: [{ key: 'url', type: 'string', required: true }],
  },
];
