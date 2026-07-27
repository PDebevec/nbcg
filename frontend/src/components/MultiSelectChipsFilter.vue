<template>
  <div>
    <MultiSelectFilter
      :model-value="modelValue"
      :options="options"
      :empty-label="emptyLabel"
      hide-selection
      @update:model-value="emit('update:modelValue', $event)"
    />
    <div v-if="modelValue.length" class="row wrap q-gutter-xs q-mt-sm">
      <q-chip
        v-for="value in modelValue"
        :key="value"
        removable
        remove-icon="close"
        outline
        color="primary"
        size="sm"
        class="filter-chip"
        @remove="remove(value)"
      >{{ labelFor(value) }}</q-chip>
    </div>
  </div>
</template>

<script setup lang="ts">
import MultiSelectFilter, { type MultiSelectOption } from 'src/components/MultiSelectFilter.vue';

const props = defineProps<{
  modelValue: string[];
  options: MultiSelectOption[];
  /** Shown in the input (e.g. "All types") — selection is rendered as chips below */
  emptyLabel: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();

function labelFor(value: string): string {
  return props.options.find((o) => o.value === value)?.label ?? value;
}

function remove(value: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== value),
  );
}
</script>

<style scoped lang="sass">
.filter-chip
  background: none !important

  :deep(.q-chip__icon--remove)
    background: none !important
    color: $primary
    opacity: 0.75
    &:hover
      opacity: 1
</style>
