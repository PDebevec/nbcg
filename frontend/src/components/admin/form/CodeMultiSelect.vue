<template>
  <q-select
    :model-value="modelValue"
    :options="filtered"
    :option-label="codeLabel"
    outlined
    multiple
    use-chips
    use-input
    input-debounce="0"
    :label="label"
    :hint="hint"
    @filter="onFilter"
    @update:model-value="emit('update:modelValue', $event ?? [])"
  >
    <template #option="{ itemProps, opt, selected }">
      <q-item v-bind="itemProps">
        <q-item-section side>
          <q-checkbox :model-value="selected" dense disable />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ codeLabel(opt) }}</q-item-label>
          <q-item-label caption>{{ opt.code }}</q-item-label>
        </q-item-section>
      </q-item>
    </template>
    <template #no-option>
      <q-item>
        <q-item-section class="text-library-muted">{{ t('admin.edit.noMatch') }}</q-item-section>
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

// Multi-value ResolvedCode picker (languages, countries, illustration codes).

const props = defineProps<{
  modelValue: ResolvedCode[];
  options: ResolvedCode[];
  label: string;
  hint?: string | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: ResolvedCode[]): void }>();

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
