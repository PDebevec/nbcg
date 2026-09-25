import { METADATA_VALIDATORS } from '../../../core/types/metadata.types';
import { SchemaService } from '../schema.service';
import { buildRecordSchemaV2 } from './build-schema';
import type { FieldSpec } from './record-fields';
import { RECORD_FIELD_SPECS } from './record-fields';
import type { FieldV2, SchemaV2 } from './schema-v2.types';
import { assertSchemaV2, selfCheckSchema } from './self-check';

/** The real field list with one spec replaced / added — each test breaks exactly one thing. */
function schemaWith(edit: (specs: FieldSpec[]) => FieldSpec[]): SchemaV2 {
  return buildRecordSchemaV2(edit(structuredClone(RECORD_FIELD_SPECS)));
}

function field(schema: SchemaV2, path: string): FieldV2 {
  const [head, ...rest] = path.split('.');
  let f = schema.fields.find((x) => x.key === head)!;
  for (const k of rest) f = f.objectShape!.find((x) => x.key === k)!;
  return f;
}

describe('schema v2 self-check', () => {
  const schema = buildRecordSchemaV2();

  it('the shipped schema is sound', () => {
    expect(selfCheckSchema(schema)).toEqual([]);
  });

  it('boots: SchemaService runs the check at module init', () => {
    expect(() => new SchemaService().onModuleInit()).not.toThrow();
  });

  it('advertises every key the API accepts, and only those', () => {
    expect(schema.fields.map((f) => f.key).sort()).toEqual([...METADATA_VALIDATORS.keys()].sort());
  });

  it('keeps every v1 key', () => {
    const v1 = new SchemaService().getRecordSchema().fields.map((f) => f.key);
    const v2 = new Set(schema.fields.map((f) => f.key));
    expect(v1.filter((k) => !v2.has(k))).toEqual([]);
  });

  describe('catches', () => {
    const errorsFor = (s: SchemaV2) => selfCheckSchema(s).join('\n');

    it('a field the API would silently drop', () => {
      const s = schemaWith((specs) => [...specs, { key: 'abstract', type: 'text', group: 'notes' }]);
      expect(errorsFor(s)).toMatch(/abstract: the API does not accept this key/);
    });

    it('a sub-field the API would silently drop', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'publication')!.objectShape!.push({ key: 'distributor', type: 'string' });
        return specs;
      });
      expect(errorsFor(s)).toMatch(/publication: the API changes .* sub-field is dropped/);
    });

    it('a key the API accepts but the schema forgot', () => {
      const s = schemaWith((specs) => specs.filter((f) => f.key !== 'summaryNote'));
      expect(errorsFor(s)).toMatch(/summaryNote: accepted by the API but missing from the schema/);
    });

    it('multiple that disagrees with the validator', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'isbn')!.multiple = false;
        return specs;
      });
      expect(errorsFor(s)).toMatch(/isbn: the API rejects the declared shape/);
    });

    it('storeAs that disagrees with the validator', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'materialType')!.storeAs = 'code';
        return specs;
      });
      expect(errorsFor(s)).toMatch(/materialType: the API rejects the declared shape/);
    });

    it('a rule on an undeclared context key', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'edition')!.rules = [{ when: { ref: 'colour', eq: 'red' }, set: { visible: false } }];
        return specs;
      });
      expect(errorsFor(s)).toMatch(/edition rule 0: rule refers to undeclared context key "colour"/);
    });

    it('a rule that sets something other than state', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'edition')!.rules = [
          { when: { ref: 'isChild', eq: true }, set: { type: 'text' } as never },
        ];
        return specs;
      });
      expect(errorsFor(s)).toMatch(/a rule may not set "type"/);
    });

    it('an unknown vocabulary', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'country')!.vocabulary = 'countries';
        return specs;
      });
      expect(errorsFor(s)).toMatch(/country: unknown vocabulary "countries"/);
    });

    it('a suggest field outside the allowlist', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'otherPhysicalDetails')!.suggest = 'otherPhysicalDetails';
        return specs;
      });
      expect(errorsFor(s)).toMatch(/suggest field "otherPhysicalDetails" is not in SUGGEST_FIELDS/);
    });

    it('a field without a caption', () => {
      const s = schemaWith((specs) => [...specs.filter((f) => f.key !== 'notes'), { key: 'notes', type: 'text', multiple: true, group: 'nowhere' as FieldSpec['group'] }]);
      const broken = structuredClone(s);
      field(broken, 'notes').label = { en: 'Notes', cnr: '' };
      expect(errorsFor(broken)).toMatch(/notes: no label in every language/);
      expect(errorsFor(broken)).toMatch(/notes: unknown group "nowhere"/);
    });

    it('a unit that is not an extentUnit code', () => {
      const broken = structuredClone(schema);
      field(broken, 'extent').rules[0].set.unit = { code: 'furlongs', en: 'fur.', cnr: 'fur.' };
      expect(errorsFor(broken)).toMatch(/unit furlongs is not an extentUnit code/);
    });

    it('a default that is not a code of its vocabulary', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'collectionType')!.default = 2;
        return specs;
      });
      expect(errorsFor(s)).toMatch(/collectionType: default 2 is not a collectionType code/);
    });

    it('a default of the wrong type, or on a repeatable field', () => {
      const s = schemaWith((specs) => {
        specs.find((f) => f.key === 'title')!.default = 0;
        specs.find((f) => f.key === 'keywords')!.default = 'x';
        return specs;
      });
      expect(errorsFor(s)).toMatch(/title: default 0 is not a string/);
      expect(errorsFor(s)).toMatch(/keywords: a default is only allowed on a single scalar field/);
    });

    it('and assertSchemaV2 throws with the whole list', () => {
      const broken = structuredClone(schema);
      field(broken, 'title').label = { en: '', cnr: '' };
      expect(() => assertSchemaV2(broken)).toThrow(/self-check failed:\n {2}- title: no label/);
    });
  });
});

describe('schema v2 shape', () => {
  const schema = buildRecordSchemaV2();

  it('inlines small vocabularies and searches big ones', () => {
    expect(schema.vocabularies.materialType.values).toHaveLength(25);
    expect(schema.vocabularies.language).toEqual({
      size: 449,
      search: { path: '/search/vocabularies/language?limit=5', queryParam: 'q', minChars: 1 },
    });
    expect(schema.vocabularies.relator.values).toBeUndefined();
    expect(schema.vocabularies.contentType.values).toBeUndefined();
    expect(schema.vocabularies.collectionType.values!.map((v) => v.code)).toEqual([0, 1, 3, 4]);
  });

  it.each([
    ['title', 'text'],
    ['summaryNote', 'textarea'],
    ['notes', 'textarea'],
    ['publication.publisher', 'autocomplete'],
    ['keywords', 'autocomplete'],
    ['materialType', 'select'],
    ['collectionType', 'select'],
    ['country', 'multiselect'],
    ['language', 'autocomplete'],
    ['authors.role', 'autocomplete'],
    ['authors.responsibility', 'select'],
    ['textualMaterialCodes.contentTypeCodes', 'autocomplete'],
    ['textualMaterialCodes.illustrationCodes', 'multiselect'],
    ['textualMaterialCodes.festschrift', 'checkbox'],
    ['extent', 'number'],
    ['issue.date', 'date'],
    ['authors', 'object'],
  ])('%s renders as %s', (path, input) => {
    expect(field(schema, path).input).toBe(input);
  });

  it('makes storeAs explicit where v1 left it implicit', () => {
    expect(field(schema, 'authors.role').values).toEqual({ vocabulary: 'relator', storeAs: 'resolvedCode' });
    expect(field(schema, 'authors.responsibility').values).toEqual({ vocabulary: 'responsibility', storeAs: 'code' });
    expect(field(schema, 'collectionType').values).toEqual({ vocabulary: 'collectionType', storeAs: 'code' });
  });

  it('points free-text hints at /search/suggest', () => {
    expect(field(schema, 'publication.publisher').suggest).toEqual({
      path: '/search/suggest?field=publisher&limit=5',
      queryParam: 'q',
      minChars: 2,
      strict: false,
    });
    expect(field(schema, 'authors').suggest!.path).toBe('/search/suggest?field=author&limit=5');
  });

  it('starts collectionType at 0; no other field has a default', () => {
    const walk = (fields: FieldV2[]): FieldV2[] => fields.flatMap((f) => [f, ...walk(f.objectShape ?? [])]);
    expect(walk(schema.fields).filter((f) => f.default !== null).map((f) => [f.key, f.default])).toEqual([
      ['collectionType', 0],
    ]);
  });

  it('declares targetState, and 207 is the serial\'s own numbering (not per issue)', () => {
    expect(schema.context.map((c) => c.key)).toContain('targetState');
    expect(field(schema, 'numberingAndDates').issueIdentifying).toBe(false);
    expect(field(schema, 'issue.number').issueIdentifying).toBe(true);
  });

  it('labels every field and group in both languages', () => {
    const walk = (fields: FieldV2[]): FieldV2[] => fields.flatMap((f) => [f, ...walk(f.objectShape ?? [])]);
    for (const f of walk(schema.fields)) {
      expect({ key: f.key, en: Boolean(f.label.en), cnr: Boolean(f.label.cnr) }).toEqual({ key: f.key, en: true, cnr: true });
    }
    for (const g of schema.groups) expect(g.label.en && g.label.cnr).toBeTruthy();
  });
});
