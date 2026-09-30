import { api } from 'src/boot/axios';
import type { Constraints, Label, Rule, Unit } from 'src/utils/schemaRules';
import type { ResolvedCode } from './search';

// ---------------------------------------------------------------------------
// Metadata schema v2 — mirrors backend src/modules/schema/v2/schema-v2.types.ts.
// One schema for every material type and parent; the conditions are inside
// (`rules`), evaluated by src/utils/schemaRules.ts, a verbatim copy of the
// backend's evaluator. Contract: docs/shared/plans/metadata-schema-v2.md.
// ---------------------------------------------------------------------------

export type UiLanguage = 'en' | 'cnr';

export interface ContextKey {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'number[]';
  source: 'item' | 'parent';
  path?: string;
  fallback?: string;
  default?: string | number | boolean;
  description?: string;
}

/** One allowed value of a closed list. `code` is a number only for `collectionType`. */
export interface VocabularyValue {
  code: string | number;
  en: string;
  cnr: string;
}

/** Where a client looks values up. `path` is relative to the API base (`/api`). */
export interface SearchSpec {
  path: string;
  queryParam: string;
  minChars: number;
}

export interface SuggestSpec extends SearchSpec {
  /** `false` = hints only, the value stays free text. */
  strict: boolean;
}

/** `values` when `size ≤ inlineVocabularyMax`, otherwise `search`. */
export interface Vocabulary {
  size: number;
  values?: VocabularyValue[];
  search?: SearchSpec;
}

export type StoreAs = 'resolvedCode' | 'code';

export interface Group {
  key: string;
  order: number;
  label: Label;
}

export type FieldType =
  | 'string'
  | 'text'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'quantity'
  | 'object';

export type FieldInput =
  | 'text'
  | 'textarea'
  | 'autocomplete'
  | 'select'
  | 'multiselect'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'object';

export interface FieldV2 {
  key: string;
  label: Label;
  help: Label | null;
  group: string;
  order: number;

  type: FieldType;
  multiple: boolean;
  input: FieldInput;

  values: { vocabulary: string; storeAs: StoreAs } | null;
  suggest: SuggestSpec | null;

  required: boolean;
  visible: boolean;
  readOnly: boolean;
  unit: Unit | null;
  constraints: Constraints;

  rules: Rule[];
  objectShape: FieldV2[] | null;

  parentInheritable: boolean;
  issueIdentifying: boolean;
  /** The value a new item starts with, `null` for none (`collectionType` → 0). */
  default: string | number | boolean | null;
}

export interface SchemaV2 {
  schemaVersion: 2;
  languages: UiLanguage[];
  inlineVocabularyMax: number;
  context: ContextKey[];
  vocabularies: Record<string, Vocabulary>;
  groups: Group[];
  fields: FieldV2[];
}

/** `Cache-Control: no-cache` + `ETag`: the browser revalidates and gets a 304. */
export async function getRecordSchema(): Promise<SchemaV2> {
  const { data } = await api.get<SchemaV2>('/schema/v2/record');
  return data;
}

/**
 * Search a controlled vocabulary (the code list, not the data) — for the ones
 * too long to inline: `language` (449), `relator` (116), `contentType` (69).
 * Same response shape as `/search/suggest`, without `count`.
 */
export async function searchVocabulary(
  name: string,
  q: string,
  limit = 10,
): Promise<ResolvedCode[]> {
  const { data } = await api.get<{ field: string; suggestions: { value: ResolvedCode }[] }>(
    `/search/vocabularies/${name}`,
    { params: { ...(q ? { q } : {}), limit } },
  );
  return data.suggestions.map((s) => s.value);
}
