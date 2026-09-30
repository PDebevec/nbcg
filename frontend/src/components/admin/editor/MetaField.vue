<template>
  <div :id="fieldId(path)" class="meta-field" :class="{ 'meta-field--warn': blocking || neededToPublish }">
    <!-- A flag is its own label -->
    <q-checkbox
      v-if="widget.kind === 'checkbox'"
      :model-value="model === true"
      dense
      :label="label"
      :disable="readOnly"
      @update:model-value="model = $event"
    />

    <FormField
      v-else
      :label="label"
      :for-id="inputId"
      :required="required"
      :publish-only="publishOnly"
      :hint="hint"
      :warning="blocking || neededToPublish"
    >
      <q-input
        v-if="widget.kind === 'text'"
        :model-value="text"
        outlined
        dense
        :for="inputId"
        :readonly="readOnly"
        :placeholder="widget.placeholder"
        :input-class="widget.mono ? 'adm-mono' : undefined"
        @update:model-value="model = String($event ?? '')"
      />

      <SuggestTextInput
        v-else-if="widget.kind === 'suggest'"
        :model-value="text"
        :field="widget.field"
        :for-id="inputId"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />

      <StringListInput
        v-else-if="widget.kind === 'chips'"
        :model-value="strings"
        :for-id="inputId"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />

      <CodeSelect
        v-else-if="widget.kind === 'code'"
        :model-value="code"
        :options="schemaStore.codes(widget.vocabulary)"
        :for-id="inputId"
        :readonly="readOnly"
        show-code
        @update:model-value="model = $event"
      />

      <CodeMultiSelect
        v-else-if="widget.kind === 'codes'"
        :model-value="codes"
        :options="schemaStore.codes(widget.vocabulary)"
        :for-id="inputId"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />

      <VocabularySelect
        v-else-if="widget.kind === 'vocabulary'"
        :model-value="widget.multiple ? codes : code"
        :vocabulary="widget.vocabulary"
        :multiple="widget.multiple"
        :for-id="inputId"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />

      <q-select
        v-else-if="widget.kind === 'collectionType'"
        :model-value="model"
        :options="collectionTypeOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        :for="inputId"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />

      <!-- The numeric extent: the unit is the schema's, per material type -->
      <q-input
        v-else-if="widget.kind === 'extent'"
        :model-value="numeric"
        outlined
        dense
        type="number"
        min="0"
        step="1"
        :for="inputId"
        :readonly="readOnly"
        :disable="!unitLabel && numeric === null"
        :suffix="unitLabel"
        @update:model-value="model = toNumber($event)"
      />

      <q-input
        v-else-if="widget.kind === 'textarea'"
        :model-value="text"
        outlined
        dense
        type="textarea"
        autogrow
        :for="inputId"
        :readonly="readOnly"
        input-style="min-height: 96px"
        @update:model-value="model = String($event ?? '')"
      />

      <TextListEditor
        v-else-if="widget.kind === 'lines'"
        :model-value="strings"
        :textarea="widget.textarea"
        :input-type="widget.url ? 'url' : 'text'"
        :placeholder="widget.url ? 'https://' : undefined"
        :add-label="widget.url ? t('admin.edit.addUrl') : t('admin.edit.addNote')"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />

      <AuthorsEditor
        v-else-if="widget.kind === 'authors'"
        :model-value="form.authors"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />

      <CorporateBodiesEditor
        v-else-if="widget.kind === 'corporateBodies'"
        :model-value="form.corporateBodies"
        :readonly="readOnly"
        @update:model-value="model = $event"
      />
    </FormField>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ResolvedCode } from 'src/api/search';
import { useSchemaStore } from 'src/stores/schema-store';
import FormField from 'src/components/admin/FormField.vue';
import AuthorsEditor from 'src/components/admin/form/AuthorsEditor.vue';
import CodeMultiSelect from 'src/components/admin/form/CodeMultiSelect.vue';
import CodeSelect from 'src/components/admin/form/CodeSelect.vue';
import CorporateBodiesEditor from 'src/components/admin/form/CorporateBodiesEditor.vue';
import StringListInput from 'src/components/admin/form/StringListInput.vue';
import SuggestTextInput from 'src/components/admin/form/SuggestTextInput.vue';
import TextListEditor from 'src/components/admin/form/TextListEditor.vue';
import VocabularySelect from 'src/components/admin/form/VocabularySelect.vue';
import { getField, setField, WIDGETS, type Widget } from 'src/components/admin/form/fields';
import { fieldId, useEditor } from './editorContext';

// ---------------------------------------------------------------------------
// One metadata field of the item editor: the label above, the input the field
// table assigns to it, a hint below. What it is CALLED, whether it is required
// and which unit it carries come from the evaluated schema state; which input
// it gets and where it sits is the editor's own business (form/fields.ts).
// ---------------------------------------------------------------------------

const props = defineProps<{
  /** Schema path: `title`, `publication.year`, `issue.number`, `extent` … */
  path: string;
}>();

const { t } = useI18n();
const schemaStore = useSchemaStore();
const { form, schema, blockingPaths, publishPaths } = useEditor();

const widget = computed<Widget>(() => WIDGETS[props.path] ?? { kind: 'text' });
const inputId = computed(() => `input-${props.path.replace(/\./g, '-')}`);

const model = computed<unknown>({
  get: () => getField(form.value, props.path),
  set: (value) => setField(form.value, props.path, value),
});

// The same value, typed for the input that shows it.
const text = computed(() => (typeof model.value === 'string' ? model.value : ''));
const strings = computed(() => (Array.isArray(model.value) ? (model.value as string[]) : []));
const code = computed(() => (model.value as ResolvedCode | null) ?? null);
const codes = computed(() => (Array.isArray(model.value) ? (model.value as ResolvedCode[]) : []));
const numeric = computed(() => (typeof model.value === 'number' ? model.value : null));

const label = computed(() => schema.label(props.path));
const required = computed(() => schema.required(props.path));
const publishOnly = computed(() => schema.publishOnly(props.path));
const readOnly = computed(() => schema.readOnly(props.path));

/** Stops the save in the current state (a record with a required field empty, a draft without a title). */
const blocking = computed(() => blockingPaths.value.has(props.path));
const neededToPublish = computed(() => publishPaths.value.has(props.path));

const hint = computed(() => {
  // A quantity needs a unit, and the unit comes from the material type's rule.
  if (widget.value.kind === 'extent' && !unitLabel.value && numeric.value === null) {
    return t('admin.edit.noExtentUnit');
  }
  if (blocking.value) return t('admin.edit.requiredToSave');
  if (neededToPublish.value) return t('admin.edit.requiredToPublish');
  return schema.help(props.path);
});

const unitLabel = computed(() => schema.tl(schema.state(props.path).unit) || undefined);

const collectionTypeOptions = computed(() =>
  schemaStore.values('collectionType').map((value) => ({ label: schema.tl(value), value: value.code })),
);

function toNumber(value: string | number | null): number | null {
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}
</script>

<style scoped lang="sass">
.meta-field
  min-width: 0

// A field that is holding up a save or a publish: amber border, amber hint.
.meta-field--warn
  :deep(.q-field--outlined .q-field__control:before)
    border-color: $warning
</style>
