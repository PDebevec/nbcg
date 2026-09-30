import { computed, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSchemaStore } from 'src/stores/schema-store';
import {
  buildContext,
  checkMetadata,
  evaluateAll,
  type CheckResult,
  type FieldState,
  type ItemState,
  type Label,
  type TargetState,
} from 'src/utils/schemaRules';

// ---------------------------------------------------------------------------
// Evaluated field states for the item editor (metadata schema v2).
//
// The schema says, per field, whether it is visible / required / read-only and
// which caption, help and unit it has — as rules over the item's context
// (material type, collection type, the parents' collection type, the state the
// save goes to). This composable runs the same evaluator the backend runs
// (`src/utils/schemaRules.ts` is a verbatim copy), so what the form shows and
// what the API's save check answers cannot disagree.
//
// `targetState` is the state the editor saves to: a new or existing draft →
// DRAFT, a record → RECORD. A draft needs little (title, material type); the
// second evaluation, against RECORD, is what publishing would still ask for.
// ---------------------------------------------------------------------------

const EMPTY_CHECK: CheckResult = { missing: [], violations: [] };

/** What a field falls back to while the schema is loading or could not be loaded: shown, optional. */
const FALLBACK_STATE: FieldState = {
  visible: true,
  required: false,
  readOnly: false,
  unit: null,
  label: { en: '', cnr: '' },
  help: null,
  constraints: {},
};

/** The caption in the UI language (`me` → `cnr`, anything else → `en`). */
export function useSchemaLabel() {
  const { locale } = useI18n();
  function tl(label: Label | null | undefined): string {
    if (!label) return '';
    return (locale.value === 'me' ? label.cnr : label.en) || label.en || label.cnr;
  }
  return { tl };
}

export function useSchemaForm(options: {
  /** The metadata as it would be sent — rebuilt from the form on every change. */
  metadata: Ref<Record<string, unknown>>;
  /**
   * What the rule context is read from (material type, record type,
   * bibliographic level, collection type). Defaults to `metadata`; pass the
   * form's own values when `metadata` itself depends on the evaluated states
   * (the extent's unit), so the two do not form a cycle.
   */
  contextMetadata?: Ref<Record<string, unknown>>;
  /** The metadata of every parent (`[]` for an item without parents). */
  parents: Ref<Array<Record<string, unknown>>>;
  itemState: Ref<ItemState>;
  targetState: Ref<TargetState>;
}) {
  const store = useSchemaStore();
  const { schema } = storeToRefs(store);
  const { tl } = useSchemaLabel();

  const context = computed(() =>
    buildContext(
      (options.contextMetadata ?? options.metadata).value,
      options.parents.value,
      options.itemState.value,
      options.targetState.value,
    ),
  );

  /** The same context, as if the save went to RECORD. */
  const recordContext = computed(() => ({ ...context.value, targetState: 'RECORD' as const }));

  const states = computed<Record<string, FieldState>>(() =>
    schema.value ? evaluateAll(schema.value, context.value) : {},
  );

  const recordStates = computed<Record<string, FieldState>>(() =>
    schema.value ? evaluateAll(schema.value, recordContext.value) : {},
  );

  /** By dotted path: `extent`, `issue.number`, `authors.role`. */
  function state(path: string): FieldState {
    return states.value[path] ?? FALLBACK_STATE;
  }

  function visible(path: string): boolean {
    return state(path).visible;
  }

  /** Required to save in the current target state. */
  function required(path: string): boolean {
    return state(path).required;
  }

  /** Not required to save a draft, but publishing will ask for it. */
  function publishOnly(path: string): boolean {
    return !state(path).required && (recordStates.value[path]?.required ?? false);
  }

  function readOnly(path: string): boolean {
    return state(path).readOnly;
  }

  /** The evaluated caption (a rule may have changed it: "Number of pages", "Scale"). */
  function label(path: string): string {
    return tl(states.value[path]?.label) || path.split('.').pop() || path;
  }

  function help(path: string): string | undefined {
    return tl(states.value[path]?.help) || undefined;
  }

  /** What stands between this metadata and saving it in `targetState`. */
  const saveCheck = computed<CheckResult>(() =>
    schema.value ? checkMetadata(schema.value, options.metadata.value, context.value) : EMPTY_CHECK,
  );

  /** What publishing would ask for — a superset of `saveCheck` on a draft, equal to it on a record. */
  const publishCheck = computed<CheckResult>(() =>
    schema.value
      ? checkMetadata(schema.value, options.metadata.value, recordContext.value)
      : EMPTY_CHECK,
  );

  /** Problems that only matter for publishing (on a draft): `publishCheck` minus `saveCheck`. */
  const publishOnlyCheck = computed<CheckResult>(() => {
    const blocking = new Set([
      ...saveCheck.value.missing.map((m) => m.path),
      ...saveCheck.value.violations.map((v) => `${v.path}#${v.constraint}`),
    ]);
    return {
      missing: publishCheck.value.missing.filter((m) => !blocking.has(m.path)),
      violations: publishCheck.value.violations.filter(
        (v) => !blocking.has(`${v.path}#${v.constraint}`),
      ),
    };
  });

  const canSave = computed(
    () => saveCheck.value.missing.length === 0 && saveCheck.value.violations.length === 0,
  );

  const canPublish = computed(
    () => publishCheck.value.missing.length === 0 && publishCheck.value.violations.length === 0,
  );

  return {
    schema,
    context,
    states,
    state,
    visible,
    required,
    publishOnly,
    readOnly,
    label,
    help,
    tl,
    saveCheck,
    publishCheck,
    publishOnlyCheck,
    canSave,
    canPublish,
  };
}

export type SchemaForm = ReturnType<typeof useSchemaForm>;
