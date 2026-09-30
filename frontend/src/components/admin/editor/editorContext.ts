import { computed, inject, nextTick, reactive, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { SchemaForm } from 'src/composables/useSchemaForm';
import {
  ALL_FIELDS,
  isFilled,
  SECTIONS,
  sectionOf,
  WIDGETS,
  type SectionKey,
} from 'src/components/admin/form/fields';
import type { MetadataForm } from 'src/components/admin/form/metadataForm';

// ---------------------------------------------------------------------------
// What the item editor's pieces share: the form model, the evaluated schema
// states, and the section bookkeeping (which fields a section shows for this
// item, how many are filled, what is still missing, which cards are open).
// The page creates it once and provides it; MetaField, the form and the
// right-hand "On this page" list read it.
// ---------------------------------------------------------------------------

export interface SectionState {
  key: SectionKey;
  /** 1-based position among the sections this item shows. */
  number: number;
  /** Visible fields, in display order. */
  fields: string[];
  filled: number;
  total: number;
  /** Visible fields that stop the save in the current state. */
  blocking: number;
  /** Visible fields that are only needed to publish. */
  neededToPublish: number;
}

export interface EditorContext {
  form: Ref<MetadataForm>;
  schema: SchemaForm;
  /** Field paths (top-level form paths) the save check reports. */
  blockingPaths: ComputedRef<Set<string>>;
  /** Field paths that only publishing asks for. */
  publishPaths: ComputedRef<Set<string>>;
  sections: ComputedRef<SectionState[]>;
  /** Fields the schema hides for this item — "Other fields". */
  hiddenFields: ComputedRef<string[]>;
  /** Which section cards are open; `other` is the "Other fields" block. */
  open: Record<SectionKey | 'other', boolean>;
  expandAll: () => void;
  collapseAll: () => void;
  /** Open the card that holds the field, scroll to it and focus its input. */
  goToField: (path: string) => void;
}

export const EDITOR_KEY: InjectionKey<EditorContext> = Symbol('item-editor');

export function useEditor(): EditorContext {
  const context = inject(EDITOR_KEY);
  if (!context) throw new Error('useEditor() called outside the item editor');
  return context;
}

/** DOM id of a field's wrapper — the target of "go to field" links. */
export function fieldId(path: string): string {
  return `field-${path.replace(/\./g, '-')}`;
}

/**
 * A path from the save check (`issue.number`, `corporateBodies[1].name`,
 * `electronicLocation[0].url`) → the form field that owns it.
 */
export function ownerField(path: string): string {
  const plain = path.replace(/\[\d+\]/g, '');
  if (WIDGETS[plain]) return plain;
  return plain.split('.')[0]!;
}

export function createEditorContext(form: Ref<MetadataForm>, schema: SchemaForm): EditorContext {
  const blockingPaths = computed(
    () =>
      new Set(
        [...schema.saveCheck.value.missing, ...schema.saveCheck.value.violations].map((p) =>
          ownerField(p.path),
        ),
      ),
  );

  const publishPaths = computed(
    () =>
      new Set(
        [
          ...schema.publishOnlyCheck.value.missing,
          ...schema.publishOnlyCheck.value.violations,
        ].map((p) => ownerField(p.path)),
      ),
  );

  const sections = computed<SectionState[]>(() => {
    let number = 0;
    const out: SectionState[] = [];
    for (const section of SECTIONS) {
      const fields = section.fields.filter((path) => schema.visible(path));
      if (fields.length === 0) continue;
      number += 1;
      out.push({
        key: section.key,
        number,
        fields,
        filled: fields.filter((path) => isFilled(form.value, path)).length,
        total: fields.length,
        blocking: fields.filter((path) => blockingPaths.value.has(path)).length,
        neededToPublish: fields.filter((path) => publishPaths.value.has(path)).length,
      });
    }
    return out;
  });

  const hiddenFields = computed(() => ALL_FIELDS.filter((path) => !schema.visible(path)));

  const open = reactive(
    Object.fromEntries([...SECTIONS.map((s) => [s.key, true]), ['other', false]]),
  ) as Record<SectionKey | 'other', boolean>;

  function expandAll() {
    for (const section of SECTIONS) open[section.key] = true;
  }

  function collapseAll() {
    for (const section of SECTIONS) open[section.key] = false;
  }

  function goToField(path: string) {
    const field = ownerField(path);
    const section = sectionOf(field);
    if (schema.visible(field)) {
      if (section) open[section] = true;
    } else {
      open.other = true;
    }
    void nextTick(() => {
      const element = document.getElementById(fieldId(field));
      if (!element) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  }

  return {
    form,
    schema,
    blockingPaths,
    publishPaths,
    sections,
    hiddenFields,
    open,
    expandAll,
    collapseAll,
    goToField,
  };
}
