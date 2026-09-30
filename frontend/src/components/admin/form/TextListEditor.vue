<template>
  <div class="text-list">
    <div v-for="(value, i) in modelValue" :key="i" class="row items-start no-wrap q-mb-sm">
      <q-input
        :model-value="value"
        outlined
        dense
        class="col"
        :type="textarea ? 'textarea' : (inputType ?? 'text')"
        :autogrow="textarea"
        :placeholder="placeholder"
        :readonly="readonly"
        @update:model-value="setAt(i, String($event ?? ''))"
      />
      <q-btn
        v-if="!readonly"
        flat
        dense
        round
        icon="o_close"
        color="grey-7"
        class="q-ml-xs"
        :aria-label="t('admin.common.remove')"
        @click="removeAt(i)"
      />
    </div>
    <q-btn
      v-if="!readonly"
      outline
      dense
      no-caps
      color="primary"
      icon="o_add"
      :label="addLabel ?? t('admin.common.add')"
      @click="add"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// Longer repeatable strings (notes, URLs): one input per line, add / remove
// buttons. Emits a fresh array on every change so the parent owns the state.

const props = defineProps<{
  modelValue: string[];
  addLabel?: string | undefined;
  placeholder?: string | undefined;
  textarea?: boolean | undefined;
  inputType?: 'text' | 'url' | undefined;
  readonly?: boolean | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>();

const { t } = useI18n();

function setAt(i: number, value: string) {
  const next = [...props.modelValue];
  next[i] = value;
  emit('update:modelValue', next);
}

function removeAt(i: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, idx) => idx !== i),
  );
}

function add() {
  emit('update:modelValue', [...props.modelValue, '']);
}
</script>
