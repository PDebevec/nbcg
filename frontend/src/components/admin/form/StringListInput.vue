<template>
  <q-select
    :model-value="modelValue"
    :options="[]"
    outlined
    dense
    multiple
    use-chips
    use-input
    hide-dropdown-icon
    new-value-mode="add-unique"
    input-debounce="0"
    hide-bottom-space
    :label="label"
    :hint="hint"
    :for="forId"
    :readonly="readonly"
    :placeholder="modelValue.length ? undefined : t('admin.edit.listHint')"
    @update:model-value="emit('update:modelValue', $event ?? [])"
  />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// Short repeatable strings (ISBNs, parallel titles, keywords): type a value,
// press Enter, it becomes a chip. No dropdown — there is nothing to pick from.

defineProps<{
  modelValue: string[];
  label?: string | undefined;
  hint?: string | undefined;
  forId?: string | undefined;
  readonly?: boolean | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>();

const { t } = useI18n();
</script>
