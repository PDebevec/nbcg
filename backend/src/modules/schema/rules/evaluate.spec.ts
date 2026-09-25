import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildRecordSchemaV2 } from '../v2/build-schema';
import {
  buildContext,
  checkMetadata,
  evaluateAll,
  isEmpty,
  type FieldState,
  type ItemState,
  type RuleContext,
  type TargetState,
  type RuleField,
} from './evaluate';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fixture: any = JSON.parse(readFileSync(join(__dirname, 'conformance.json'), 'utf8'));

/** Compare only the properties a case lists; units and labels by code / English text. */
function project(state: FieldState, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'unit') out.unit = state.unit ? state.unit.code : null;
    else if (k === 'label') out.label = state.label.en;
    else if (k === 'help') out.help = state.help ? state.help.en : null;
    else out[k] = (state as any)[k];
  }
  return out;
}

function runCase(fields: RuleField[], defaults: RuleContext, c: any) {
  const states = evaluateAll({ fields }, { ...defaults, ...c.context });
  for (const [path, expected] of Object.entries<Record<string, unknown>>(c.expected)) {
    expect(states[path]).toBeDefined();
    expect({ path, ...project(states[path], Object.keys(expected)) }).toEqual({ path, ...expected });
  }
}

describe('schema rules — conformance fixture', () => {
  describe('isEmpty', () => {
    it.each(fixture.isEmpty.map((c: any) => [JSON.stringify(c.value), c.value, c.expected]))(
      'isEmpty(%s)',
      (_label, value, expected) => expect(isEmpty(value)).toBe(expected),
    );
  });

  describe('buildContext', () => {
    it.each(fixture.buildContext.map((c: any) => [c.name, c]))('%s', (_name, c: any) => {
      const ctx = buildContext(c.metadata, c.parents, c.itemState as ItemState, c.targetState as TargetState);
      expect(ctx).toMatchObject(c.expected);
    });
  });

  describe('mechanics', () => {
    const fields: RuleField[] = fixture.mechanics.fields;
    it.each(fixture.mechanics.cases.map((c: any) => [c.name, c]))('%s', (_name, c) =>
      runCase(fields, fixture.mechanics.contextDefaults, c),
    );
  });

  describe('record rule table', () => {
    const { fields } = buildRecordSchemaV2();
    it.each(fixture.record.cases.map((c: any) => [c.name, c]))('%s', (_name, c) =>
      runCase(fields, fixture.record.contextDefaults, c),
    );
  });

  describe('checkMetadata', () => {
    const schema = buildRecordSchemaV2();
    it.each(fixture.check.cases.map((c: any) => [c.name, c]))('%s', (_name, c: any) => {
      const ctx = buildContext(c.metadata, c.parents, c.itemState, c.targetState);
      const result = checkMetadata(schema, c.metadata, ctx);
      expect({
        missing: result.missing.map((m) => m.path),
        violations: result.violations.map((v) => ({ path: v.path, constraint: v.constraint })),
      }).toEqual(c.expected);
    });

    it('reports the evaluated label, not the base one', () => {
      const metadata = { title: 'T', collectionType: 0, materialType: { code: 'gm', en: 'Video / Film', cnr: 'Video / Film' } };
      const result = checkMetadata(schema, metadata, buildContext(metadata, [], 'DRAFT', 'RECORD'));
      expect(result.missing).toEqual([{ path: 'extent', label: { en: 'Duration', cnr: 'Trajanje' } }]);
    });
  });
});

describe('schema rules — web frontend copy', () => {
  // The web editor runs the same file; a copy that drifted would show fields
  // the backend then refuses to publish, or the other way round.
  const frontendCopy = join(__dirname, '../../../../../frontend/src/utils/schemaRules.ts');
  const run = existsSync(frontendCopy) ? it : it.skip;

  run('frontend/src/utils/schemaRules.ts is byte-identical to evaluate.ts', () => {
    expect(readFileSync(frontendCopy, 'utf8')).toBe(readFileSync(join(__dirname, 'evaluate.ts'), 'utf8'));
  });
});
