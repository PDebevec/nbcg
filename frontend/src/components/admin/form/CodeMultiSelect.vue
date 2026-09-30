<template>
  <q-select
    :model-value="modelValue"
    :options="filtered"
    :option-label="codeLabel"
    option-value="code"
    outlined
    dense
    options-dense
    multiple
    use-chips
    use-input
    input-debounce="0"
    hide-bottom-space
    :label="label"
    :hint="hint"
    :for="forId"
    :readonly="readonly"
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

// Multi-value ResolvedCode picker over an inlined code list (countries, illustration codes).

const props = defineProps<{
  modelValue: ResolvedCode[];
  options: ResolvedCode[];
  label?: string | undefined;
  hint?: string | undefined;
  forId?: string | undefined;
  readonly?: boolean | undefined;
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
