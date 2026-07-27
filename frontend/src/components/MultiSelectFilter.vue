<template>
  <q-select
    :model-value="modelValue"
    :options="options"
    outlined dense multiple emit-value map-options options-dense
    :display-value="hideSelection || !modelValue.length ? emptyLabel : undefined"
    @update:model-value="emit('update:modelValue', $event ?? [])"
  >
    <template #option="{ itemProps, opt, selected, toggleOption }">
      <q-item v-bind="itemProps">
        <q-item-section side>
          <q-checkbox :model-value="selected" dense color="primary" @update:model-value="toggleOption(opt)" />
        </q-item-section>
        <q-item-section>{{ opt.label }}</q-item-section>
      </q-item>
    </template>
  </q-select>
</template>

<script setup lang="ts">
export interface MultiSelectOption {
  label: string;
  value: string;
}

defineProps<{
  modelValue: string[];
  options: MultiSelectOption[];
  /** Shown when nothing is selected (e.g. "All types") */
  emptyLabel: string;
  /** Always show emptyLabel in the input, even with selected values */
  hideSelection?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();
</script>
