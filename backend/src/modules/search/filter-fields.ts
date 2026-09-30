import { BadRequestException } from '@nestjs/common';

/**
 * Allowlist of the exact filters on `GET /search` and `GET /search/:id/children`.
 *
 * An entry names the query param it reads, how the raw string is parsed
 * (`value`) and which index field it matches, and how (`kind`). Filters narrow
 * the hits and never change the score. To add:
 *   - a filter: an entry here plus its param on `SearchQueryDto`. The global
 *     ValidationPipe strips undeclared params without an error, so a missing
 *     one would be ignored silently (filter-fields.spec.ts fails instead);
 *   - a value format: a `FilterValue` and its parser in `VALUES`;
 *   - a kind of match: a member of `FilterField` and its case in
 *     `filterClause` (the compiler flags a kind without one).
 *
 * The `path` must be indexed the way its kind needs. Strings under `metadata`
 * are mapped dynamically as `text` (split into words) plus `.keyword` (the
 * whole value), numbers as `long`. `term` and `terms` need a whole-value field,
 * `phrase` a text field, `range` a numeric field or one whose tokens sort like
 * the values. The `.normalized` and `.years` sub-fields are declared in
 * `infrastructure/docker/pgsync/schema.json`; changing them needs a reindex.
 */

/** How a raw param becomes the value sent to OpenSearch. One that does not parse is a 400. */
export type FilterValue = 'string' | 'integer' | 'year';

interface FilterBase {
  /** The index field, e.g. `metadata.collectionType`. */
  path: string;
  /** Defaults to `string`. */
  value?: FilterValue;
}

/** `?param=a,b` — the field equals any of the values. */
interface TermsFilter extends FilterBase {
  kind: 'terms';
}

/** `?param=a` — the field equals the value. One value: a comma is part of it. */
interface TermFilter extends FilterBase {
  kind: 'term';
}

/** `?param=a,b` — the text field contains any of the values as a phrase. */
interface PhraseFilter extends FilterBase {
  kind: 'phrase';
}

/** `?<from>=a&<to>=b` — the field lies between the two, both ends included; either may be left out. */
interface RangeFilter extends FilterBase {
  kind: 'range';
  params: { from: string; to: string };
}

export type FilterField = TermsFilter | TermFilter | PhraseFilter | RangeFilter;

/** Keyed by query param. A `range` is keyed by its name and reads the two params in `params`. */
export const FILTER_FIELDS: Record<string, FilterField> = {
  // 0 = not a collection, so `1,3,4` is any collection (vocabulary `collectionType`)
  collectionType: { kind: 'terms',  path: 'metadata.collectionType', value: 'integer' },
  // English labels, not codes: the web's filter lists send the label
  language:       { kind: 'terms',  path: 'metadata.language.en.keyword' },
  materialType:   { kind: 'terms',  path: 'metadata.materialType.en.keyword' },
  publisher:      { kind: 'phrase', path: 'metadata.publication.publisher' },
  // `.years` holds only the 4-digit years of the value: "1884-1885" → 1884, 1885; "s. a." → none
  year: {
    kind: 'range',
    path: 'metadata.publication.year.years',
    value: 'year',
    params: { from: 'yearFrom', to: 'yearTo' },
  },
  // `.normalized` drops dashes and spaces and lowercases, so any spelling of the number matches
  isbn:           { kind: 'term',   path: 'metadata.isbn.normalized' },
  issn:           { kind: 'term',   path: 'metadata.issn.normalized' },
  cobissId:       { kind: 'term',   path: 'metadata.cobissId.keyword' },
  // A user id, not a name: the name snapshot is frozen on purpose, so a name would miss renamed users
  createdBy:      { kind: 'term',   path: 'createdByUserId' },
};

/** Every query param a filter reads. */
export function filterParams(): string[] {
  return Object.entries(FILTER_FIELDS).flatMap(([name, field]) =>
    field.kind === 'range' ? [field.params.from, field.params.to] : [name],
  );
}

type Clause = Record<string, unknown>;
type Parsed = string | number;

/**
 * One clause per filter the query gives a value, in registry order. `query` is
 * the parsed `SearchQueryDto`. Throws 400 for a value that does not parse, or
 * a range whose start is after its end.
 */
export function buildFilterClauses(query: object): Clause[] {
  const params = query as Record<string, unknown>;
  return Object.entries(FILTER_FIELDS)
    .map(([name, field]) => filterClause(name, field, params))
    .filter((clause): clause is Clause => clause !== undefined);
}

function filterClause(name: string, field: FilterField, params: Record<string, unknown>): Clause | undefined {
  switch (field.kind) {
    case 'terms': {
      const values = parseList(name, field, params[name]);
      return values.length ? { terms: { [field.path]: values } } : undefined;
    }
    case 'term': {
      const value = parseOne(name, field, params[name]);
      return value === undefined ? undefined : { term: { [field.path]: value } };
    }
    case 'phrase': {
      const values = parseList(name, field, params[name]);
      if (!values.length) return undefined;
      return {
        bool: {
          should: values.map((v) => ({ match_phrase: { [field.path]: v } })),
          minimum_should_match: 1,
        },
      };
    }
    case 'range': {
      const { from, to } = field.params;
      const gte = parseOne(from, field, params[from]);
      const lte = parseOne(to, field, params[to]);
      if (gte === undefined && lte === undefined) return undefined;
      if (gte !== undefined && lte !== undefined && isAfter(gte, lte)) {
        throw new BadRequestException(`${from} must not be greater than ${to}`);
      }
      return {
        range: {
          [field.path]: { ...(gte !== undefined ? { gte } : {}), ...(lte !== undefined ? { lte } : {}) },
        },
      };
    }
    default: {
      const unhandled: never = field;
      throw new Error(`No clause for filter ${JSON.stringify(unhandled)}`);
    }
  }
}

const VALUES: Record<FilterValue, { expected: string; parse: (raw: string) => Parsed | undefined }> = {
  string:  { expected: 'text', parse: (raw) => raw },
  integer: { expected: 'a whole number', parse: (raw) => (/^-?\d+$/.test(raw) ? Number(raw) : undefined) },
  // Stays a string: `.years` holds 4-digit tokens, which compare as text the way years compare as numbers
  year:    { expected: 'a 4-digit year (YYYY)', parse: (raw) => (/^\d{4}$/.test(raw) ? raw : undefined) },
};

/** A missing or blank param is no filter. */
function parseOne(param: string, field: FilterField, raw: unknown): Parsed | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text ? parseValue(param, field, text) : undefined;
}

/** Comma-separated values; blanks between commas are skipped. */
function parseList(param: string, field: FilterField, raw: unknown): Parsed[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => parseValue(param, field, v));
}

function parseValue(param: string, field: FilterField, text: string): Parsed {
  const { expected, parse } = VALUES[field.value ?? 'string'];
  const value = parse(text);
  if (value === undefined) throw new BadRequestException(`Invalid ${param} "${text}": expected ${expected}`);
  return value;
}

/** Both ends come from one parser, so they are both numbers or both strings. */
function isAfter(a: Parsed, b: Parsed): boolean {
  return typeof a === 'number' && typeof b === 'number' ? a > b : String(a) > String(b);
}
