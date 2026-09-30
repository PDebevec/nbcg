<template>
  <q-select
    :model-value="modelValue"
    :options="filtered"
    :option-label="codeLabel"
    option-value="code"
    outlined
    dense
    options-dense
    clearable
    use-input
    hide-selected
    fill-input
    input-debounce="0"
    hide-bottom-space
    :label="label"
    :hint="hint"
    :for="forId"
    :readonly="readonly"
    :placeholder="modelValue ? undefined : placeholder"
    @filter="onFilter"
    @update:model-value="emit('update:modelValue', $event ?? null)"
  >
    <template v-if="showCode && modelValue" #append>
      <span class="adm-mono adm-muted">{{ modelValue.code }}</span>
    </template>
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
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ResolvedCode } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { filterCodes } from './filterCodes';

// Single ResolvedCode picker over a code list the schema inlines (material
// type, record type, literary form …). Filters client-side on label or code.

const props = defineProps<{
  modelValue: ResolvedCode | null;
  options: ResolvedCode[];
  label?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
  forId?: string | undefined;
  readonly?: boolean | undefined;
  /** Show the selected code next to the dropdown arrow. */
  showCode?: boolean;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: ResolvedCode | null): void }>();

const { t } = useI18n();
const { codeLabel } = useCodeLabel();

const filtered = ref<ResolvedCode[]>(props.options);
watch(
  () => props.options,
  (opts) => {
    filtered.value = opts;
  },
);

function onFilter(input: string, done: (cb: () => void) => void) {
  done(() => {
    filtered.value = filterCodes(props.options, input, codeLabel);
  });
}
</script>
