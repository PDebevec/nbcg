<template>
  <div class="text-list">
    <div class="text-list__label">{{ label }}</div>
    <div v-for="(value, i) in modelValue" :key="i" class="row items-start no-wrap q-mb-sm">
      <q-input
        :model-value="value"
        outlined
        dense
        class="col"
        :type="textarea ? 'textarea' : (inputType ?? 'text')"
        :autogrow="textarea"
        :placeholder="placeholder"
        @update:model-value="setAt(i, String($event ?? ''))"
      />
      <q-btn
        flat
        dense
        round
        icon="close"
        color="library-muted"
        class="q-ml-xs"
        :aria-label="t('admin.edit.remove')"
        @click="removeAt(i)"
      />
    </div>
    <q-btn
      outline
      dense
      no-caps
      color="primary"
      icon="add"
      :label="addLabel ?? t('admin.edit.addLine')"
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
  label: string;
  addLabel?: string | undefined;
  placeholder?: string | undefined;
  textarea?: boolean;
  inputType?: 'text' | 'url' | undefined;
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

<style scoped lang="sass">
.text-list__label
  font-size: 0.8rem
  font-weight: 600
  color: $muted
  margin-bottom: 6px
</style>
