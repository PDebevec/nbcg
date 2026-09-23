<template>
  <q-select
    :model-value="modelValue"
    :options="[]"
    outlined
    multiple
    use-chips
    use-input
    hide-dropdown-icon
    new-value-mode="add-unique"
    input-debounce="0"
    :label="label"
    :hint="hint ?? t('admin.edit.listHint')"
    @update:model-value="emit('update:modelValue', $event ?? [])"
  />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// Short repeatable strings (ISBNs, parallel titles): type a value, press
// Enter, it becomes a chip. No dropdown — there is nothing to pick from.

defineProps<{
  modelValue: string[];
  label: string;
  hint?: string | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>();

const { t } = useI18n();
</script>
