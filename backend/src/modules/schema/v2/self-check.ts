import { METADATA_VALIDATORS } from '../../../core/types/metadata.types';
import type { FieldValidator } from '../../import/cobiss/cobiss-util/cobiss.types';
import { SUGGEST_FIELDS } from '../../search/suggest-fields';
import { buildContext, type Condition, type Rule, type Unit } from '../rules/evaluate';
import type { FieldV2, SchemaV2 } from './schema-v2.types';
import { VOCABULARIES } from './vocabularies';

export interface SelfCheckDeps {
  validators: ReadonlyMap<string, FieldValidator>;
  suggestFields: Readonly<Record<string, unknown>>;
}

const DEFAULT_DEPS: SelfCheckDeps = {
  validators: METADATA_VALIDATORS,
  suggestFields: SUGGEST_FIELDS,
};

const EFFECT_KEYS = new Set(['visible', 'required', 'readOnly', 'unit', 'label', 'help', 'constraints']);
const STORE_AS = new Set(['resolvedCode', 'code']);

/**
 * Everything that can be wrong with a v2 schema, as readable messages; `[]`
 * means it is sound. The point is that the schema can never advertise a field
 * the API silently drops (the `summaryNote` bug) or a shape the API rejects.
 */
export function selfCheckSchema(schema: SchemaV2, deps: SelfCheckDeps = DEFAULT_DEPS): string[] {
  const errors: string[] = [];
  const contextKeys = new Set(schema.context.map((c) => c.key));
  const groupKeys = new Set(schema.groups.map((g) => g.key));
  const unitCodes = new Set((VOCABULARIES.extentUnit?.values ?? []).map((v) => String(v.code)));

  // ── context: exactly what buildContext() computes ──
  const computed = Object.keys(buildContext({}, [], 'NEW')).sort();
  const declared = [...contextKeys].sort();
  if (computed.join() !== declared.join()) {
    errors.push(`context keys [${declared.join(', ')}] differ from buildContext() [${computed.join(', ')}]`);
  }

  // ── vocabularies ──
  for (const [name, vocab] of Object.entries(schema.vocabularies)) {
    const def = VOCABULARIES[name];
    if (!def) {
      errors.push(`vocabulary ${name} is not in the registry`);
      continue;
    }
    if (vocab.size !== def.values.length) errors.push(`vocabulary ${name}: size ${vocab.size} ≠ ${def.values.length}`);
    const inline = vocab.size <= schema.inlineVocabularyMax;
    if (inline && !vocab.values) errors.push(`vocabulary ${name} is small enough to inline but has no values`);
    if (!inline && (vocab.values || !vocab.search)) errors.push(`vocabulary ${name} is too big to inline but is not searched`);
    if (vocab.search && !vocab.search.path.startsWith(`/search/vocabularies/${name}?`)) {
      errors.push(`vocabulary ${name}: search path ${vocab.search.path} does not point at itself`);
    }
  }

  // ── groups ──
  for (const g of schema.groups) {
    if (!g.label?.en || !g.label?.cnr) errors.push(`group ${g.key} has no label in every language`);
  }

  // ── fields ──
  const checkUnit = (where: string, unit: Unit | null | undefined) => {
    if (unit && !unitCodes.has(unit.code)) errors.push(`${where}: unit ${unit.code} is not an extentUnit code`);
  };

  const checkCondition = (where: string, cond: Condition) => {
    if ('all' in cond) return cond.all.forEach((c) => checkCondition(where, c));
    if ('any' in cond) return cond.any.forEach((c) => checkCondition(where, c));
    if ('not' in cond) return checkCondition(where, cond.not);
    if (!contextKeys.has(cond.ref)) errors.push(`${where}: rule refers to undeclared context key "${cond.ref}"`);
    if (!('eq' in cond) && !('in' in cond) && !('empty' in cond)) errors.push(`${where}: condition has no eq/in/empty`);
  };

  const checkRule = (where: string, field: FieldV2, rule: Rule) => {
    checkCondition(where, rule.when);
    for (const k of Object.keys(rule.set)) {
      if (!EFFECT_KEYS.has(k)) errors.push(`${where}: a rule may not set "${k}"`);
    }
    if (rule.set.unit !== undefined && field.type !== 'quantity') errors.push(`${where}: unit on a ${field.type} field`);
    checkUnit(where, rule.set.unit);
    if (rule.set.label && (!rule.set.label.en || !rule.set.label.cnr)) errors.push(`${where}: rule label incomplete`);
  };

  const checkField = (field: FieldV2, path: string, topLevel: boolean) => {
    if (!field.label?.en || !field.label?.cnr) errors.push(`${path}: no label in every language`);
    if (topLevel && !groupKeys.has(field.group)) errors.push(`${path}: unknown group "${field.group}"`);

    if (field.type === 'enum') {
      if (!field.values) errors.push(`${path}: enum without values`);
      else {
        if (!VOCABULARIES[field.values.vocabulary] || !schema.vocabularies[field.values.vocabulary]) {
          errors.push(`${path}: unknown vocabulary "${field.values.vocabulary}"`);
        }
        if (!STORE_AS.has(field.values.storeAs)) errors.push(`${path}: bad storeAs "${field.values.storeAs}"`);
      }
    } else if (field.values) {
      errors.push(`${path}: values on a ${field.type} field`);
    }

    if (field.suggest) {
      const name = /[?&]field=([^&]+)/.exec(field.suggest.path)?.[1];
      if (!field.suggest.path.startsWith('/search/suggest?') || !name) {
        errors.push(`${path}: suggest path ${field.suggest.path} is not a /search/suggest call`);
      } else if (!(name in deps.suggestFields)) {
        errors.push(`${path}: suggest field "${name}" is not in SUGGEST_FIELDS`);
      }
    }

    if (field.unit && field.type !== 'quantity') errors.push(`${path}: unit on a ${field.type} field`);
    checkUnit(path, field.unit);

    if ((field.type === 'object') !== Boolean(field.objectShape?.length)) {
      errors.push(`${path}: objectShape must be present exactly on object fields`);
    }

    field.rules.forEach((rule, i) => checkRule(`${path} rule ${i}`, field, rule));

    const seen = new Set<string>();
    for (const child of field.objectShape ?? []) {
      if (seen.has(child.key)) errors.push(`${path}: duplicate sub-field ${child.key}`);
      seen.add(child.key);
      checkField(child, `${path}.${child.key}`, false);
    }
  };

  const topKeys = new Set<string>();
  for (const field of schema.fields) {
    if (topKeys.has(field.key)) errors.push(`${field.key}: duplicate field`);
    topKeys.add(field.key);
    checkField(field, field.key, true);

    // The API must accept exactly what the schema describes, whole.
    const validate = deps.validators.get(field.key);
    if (!validate) {
      errors.push(`${field.key}: the API does not accept this key — every value would be silently dropped`);
      continue;
    }
    const sample = sampleValue(field);
    try {
      const stored = validate(sample);
      if (canonical(stored) !== canonical(sample)) {
        errors.push(
          `${field.key}: the API changes ${canonical(sample)} into ${canonical(stored)} — ` +
            'a sub-field is dropped or the declared shape is wrong',
        );
      }
    } catch (e) {
      errors.push(`${field.key}: the API rejects the declared shape ${canonical(sample)}: ${(e as Error).message}`);
    }
  }

  for (const key of deps.validators.keys()) {
    if (!topKeys.has(key)) errors.push(`${key}: accepted by the API but missing from the schema`);
  }

  return errors;
}

/** Throw with every problem listed. Called at module init so a bad schema cannot boot. */
export function assertSchemaV2(schema: SchemaV2, deps?: SelfCheckDeps): void {
  const errors = selfCheckSchema(schema, deps);
  if (errors.length > 0) {
    throw new Error(`Metadata schema v2 self-check failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/** A value of exactly the shape the field declares — fed to the API's validator. */
export function sampleValue(field: FieldV2): unknown {
  const one = (): unknown => {
    switch (field.type) {
      case 'string':
      case 'text':
        return 'x';
      case 'integer':
      case 'number':
        return 1;
      case 'boolean':
        return true;
      case 'date':
        return '1905-03-12';
      case 'enum': {
        const first = field.values ? VOCABULARIES[field.values.vocabulary]?.values[0] : undefined;
        if (!first) return 'x';
        return field.values!.storeAs === 'code'
          ? first.code
          : { code: first.code, en: first.en, cnr: first.cnr };
      }
      case 'quantity': {
        const unit = field.unit ?? field.rules.find((r) => r.set.unit)?.set.unit;
        return { value: 1, unit: unit?.code ?? 'x' };
      }
      case 'object':
        return Object.fromEntries((field.objectShape ?? []).map((c) => [c.key, sampleValue(c)]));
    }
  };
  return field.multiple ? [one()] : one();
}

/** Key-order-independent JSON, for comparing what went in with what came out. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
