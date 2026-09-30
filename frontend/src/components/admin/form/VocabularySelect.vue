<template>
  <q-select
    :model-value="modelValue"
    :options="options"
    :option-label="codeLabel"
    option-value="code"
    outlined
    dense
    options-dense
    :multiple="multiple"
    :use-chips="multiple"
    :clearable="!multiple"
    :hide-selected="!multiple"
    :fill-input="!multiple"
    use-input
    input-debounce="250"
    hide-bottom-space
    :hint="hint"
    :for="forId"
    :readonly="readonly"
    :placeholder="isEmpty ? t('admin.edit.searchVocabulary') : undefined"
    @filter="onFilter"
    @update:model-value="onUpdate"
  >
    <template #option="{ itemProps, opt }">
      <q-item v-bind="itemProps">
        <q-item-section>
          <q-item-label>{{ codeLabel(opt) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <span class="adm-mono">{{ opt.code }}</span>
        </q-item-section>
      </q-item>
    </template>
    <template #no-option>
      <q-item>
        <q-item-section class="adm-muted">{{ t('admin.common.noMatch') }}</q-item-section>
      </q-item>
    </template>
  </q-select>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { searchVocabulary } from 'src/api/schema';
import type { ResolvedCode } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';

// ---------------------------------------------------------------------------
// Picker over a vocabulary too long to inline in the schema — languages (449),
// relator roles (116), content types (69). Searches the code list itself
// (`GET /search/vocabularies/:name`), not the values already in use, so a
// language no record has yet can still be chosen.
// ---------------------------------------------------------------------------

const props = defineProps<{
  modelValue: ResolvedCode | ResolvedCode[] | null;
  /** Vocabulary name from the schema: `language`, `relator`, `contentType`. */
  vocabulary: string;
  multiple?: boolean;
  hint?: string | undefined;
  forId?: string | undefined;
  readonly?: boolean | undefined;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: ResolvedCode | ResolvedCode[] | null): void;
}>();

const { t } = useI18n();
const { codeLabel } = useCodeLabel();

const options = ref<ResolvedCode[]>([]);

const isEmpty = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue.length === 0 : !props.modelValue,
);

function onFilter(input: string, done: (cb: () => void) => void, abort: () => void) {
  searchVocabulary(props.vocabulary, input.trim(), 10)
    .then((values) => {
      done(() => {
        options.value = values;
      });
    })
    .catch(() => abort());
}

function onUpdate(value: ResolvedCode | ResolvedCode[] | null) {
  emit('update:modelValue', props.multiple ? (value ?? []) : (value ?? null));
}
</script>
