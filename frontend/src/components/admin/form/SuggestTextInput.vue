<template>
  <q-select
    :model-value="modelValue"
    :options="options"
    outlined
    use-input
    fill-input
    hide-selected
    clearable
    input-debounce="300"
    :label="label"
    :hint="hint"
    @filter="onFilter"
    @input-value="emit('update:modelValue', $event)"
    @update:model-value="emit('update:modelValue', $event ?? '')"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { suggestValues, type SuggestStringField } from 'src/api/search';

// Free-text input with typeahead from values already in the catalogue
// (publisher, place, series title …). Any typed text is accepted as-is;
// the suggestions only save keystrokes and keep spellings consistent.

const props = defineProps<{
  modelValue: string;
  field: SuggestStringField;
  label: string;
  hint?: string | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const options = ref<string[]>([]);

function onFilter(input: string, done: (cb: () => void) => void) {
  void (async () => {
    let next: string[] = [];
    try {
      const result = await suggestValues({
        field: props.field,
        ...(input.trim() ? { q: input.trim() } : {}),
        limit: 10,
      });
      next = result.suggestions.map((s) => s.value);
    } catch {
      next = [];
    }
    done(() => {
      options.value = next;
    });
  })();
}
</script>
