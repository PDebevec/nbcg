/**
 * Metadata schema v2 — the response of `GET /api/schema/v2/record`.
 * Contract: docs/shared/plans/metadata-schema-v2.md ("Response shape").
 *
 * The rule-related types live in `../rules/evaluate.ts`, because that file is
 * copied verbatim to the web frontend and may not import anything.
 */
import type { Constraints, Label, Rule, Unit } from '../rules/evaluate';

export type { Condition, Constraints, Label, Rule, RuleEffect, Unit } from '../rules/evaluate';

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
  /** Computed from type + values + suggest — never hand-written. */
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
