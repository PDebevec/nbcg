import { defineStore } from 'pinia';
import { getRecordSchema, type FieldV2, type SchemaV2, type VocabularyValue } from 'src/api/schema';
import type { ResolvedCode } from 'src/api/search';

// ---------------------------------------------------------------------------
// The metadata schema (v2), loaded once per session. Everything that needs a
// code list or a field caption reads it from here: the item editor, the
// records list (collection type filter), the validation dialog.
// ---------------------------------------------------------------------------

interface State {
  schema: SchemaV2 | null;
  failed: boolean;
}

let pending: Promise<SchemaV2 | null> | undefined;

export const useSchemaStore = defineStore('schema', {
  state: (): State => ({ schema: null, failed: false }),

  getters: {
    /** Inline values of a vocabulary; `[]` for one that is searched instead. */
    values:
      (state) =>
      (name: string): VocabularyValue[] =>
        state.schema?.vocabularies[name]?.values ?? [],

    /** A top-level field, or a sub-field by dotted path (`issue.number`). */
    field:
      (state) =>
      (path: string): FieldV2 | undefined => {
        let fields = state.schema?.fields ?? [];
        let found: FieldV2 | undefined;
        for (const key of path.split('.')) {
          found = fields.find((f) => f.key === key);
          if (!found) return undefined;
          fields = found.objectShape ?? [];
        }
        return found;
      },
  },

  actions: {
    /** Resolves to the schema, or `null` when it could not be loaded. Safe to call from anywhere, any number of times. */
    load(): Promise<SchemaV2 | null> {
      if (this.schema) return Promise.resolve(this.schema);
      pending ??= getRecordSchema()
        .then((schema) => {
          this.schema = schema;
          this.failed = false;
          return schema;
        })
        .catch(() => {
          this.failed = true;
          return null;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },

    /** The string-coded values of a vocabulary as ResolvedCode options (everything except `collectionType`). */
    codes(name: string): ResolvedCode[] {
      return this.values(name).map((v) => ({ code: String(v.code), en: v.en, cnr: v.cnr }));
    },
  },
});
