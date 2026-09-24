import { FIELD_HELP, FIELD_LABELS, GROUP_LABELS } from './labels';
import { CONTEXT_KEYS, GROUP_KEYS, RECORD_FIELD_SPECS, type FieldSpec } from './record-fields';
import type { FieldInput, FieldV2, SchemaV2, SuggestSpec, Vocabulary } from './schema-v2.types';
import { INLINE_VOCABULARY_MAX, VOCABULARIES, toSchemaVocabulary } from './vocabularies';

/** `/search/suggest` call for a field, relative to `/api`. */
export function suggestPath(field: string): string {
  return `/search/suggest?field=${field}&limit=5`;
}

/**
 * How to render a field — derived, never hand-written, so no two clients can
 * disagree about it (table "input" in the contract).
 */
export function computeInput(
  spec: Pick<FieldSpec, 'type' | 'multiple' | 'vocabulary' | 'suggest'>,
  vocabularies: Record<string, Vocabulary>,
): FieldInput {
  switch (spec.type) {
    case 'string':
      return spec.suggest ? 'autocomplete' : 'text';
    case 'text':
      return spec.suggest ? 'autocomplete' : 'textarea';
    case 'enum': {
      const vocab = spec.vocabulary ? vocabularies[spec.vocabulary] : undefined;
      if (vocab && !vocab.values) return 'autocomplete';
      return spec.multiple ? 'multiselect' : 'select';
    }
    case 'integer':
    case 'number':
    case 'quantity':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'date':
      return 'date';
    case 'object':
      return 'object';
  }
}

function toField(
  spec: FieldSpec,
  path: string,
  group: string,
  order: number,
  vocabularies: Record<string, Vocabulary>,
): FieldV2 {
  const suggest: SuggestSpec | null = spec.suggest
    ? { path: suggestPath(spec.suggest), queryParam: 'q', minChars: 2, strict: false }
    : null;

  return {
    key: spec.key,
    // A missing caption is caught by the self-check; the key keeps it readable until then.
    label: FIELD_LABELS[path] ?? { en: '', cnr: '' },
    help: FIELD_HELP[path] ?? null,
    group,
    order,
    type: spec.type,
    multiple: spec.multiple ?? false,
    input: computeInput(spec, vocabularies),
    values: spec.vocabulary
      ? { vocabulary: spec.vocabulary, storeAs: spec.storeAs ?? VOCABULARIES[spec.vocabulary]?.storeAs ?? 'resolvedCode' }
      : null,
    suggest,
    required: spec.required ?? false,
    visible: spec.visible ?? true,
    readOnly: spec.readOnly ?? false,
    unit: spec.unit ?? null,
    constraints: spec.constraints ?? {},
    rules: spec.rules ?? [],
    objectShape: spec.objectShape
      ? spec.objectShape.map((child, i) => toField(child, `${path}.${child.key}`, group, i, vocabularies))
      : null,
    parentInheritable: spec.parentInheritable ?? false,
    issueIdentifying: spec.issueIdentifying ?? false,
  };
}

/** Collect every vocabulary name a field list uses, recursively. */
function usedVocabularies(specs: FieldSpec[], into = new Set<string>()): Set<string> {
  for (const s of specs) {
    if (s.vocabulary) into.add(s.vocabulary);
    if (s.objectShape) usedVocabularies(s.objectShape, into);
  }
  return into;
}

/** The full `GET /schema/v2/record` body. */
export function buildRecordSchemaV2(specs: FieldSpec[] = RECORD_FIELD_SPECS): SchemaV2 {
  // Every registered list is shipped, used or not: `extentUnit` backs the
  // `quantity` units and `/search/vocabularies/:name` serves all of them.
  const names = new Set([...Object.keys(VOCABULARIES), ...usedVocabularies(specs)]);
  const vocabularies: Record<string, Vocabulary> = {};
  for (const name of names) {
    if (VOCABULARIES[name]) vocabularies[name] = toSchemaVocabulary(name);
  }

  return {
    schemaVersion: 2,
    languages: ['en', 'cnr'],
    inlineVocabularyMax: INLINE_VOCABULARY_MAX,
    context: CONTEXT_KEYS,
    vocabularies,
    groups: GROUP_KEYS.map((key, order) => ({
      key,
      order,
      label: GROUP_LABELS[key] ?? { en: '', cnr: '' },
    })),
    fields: specs.map((spec, order) =>
      toField(spec, spec.key, spec.group ?? '', order, vocabularies),
    ),
  };
}
