<template>
  <div>
    <div class="editor-label q-mb-sm">{{ t('admin.edit.fields.corporateBodies') }}</div>

    <div v-for="(row, i) in rows" :key="i" class="row q-col-gutter-sm items-start q-mb-sm">
      <div class="col-12 col-md-8">
        <q-input v-model="row.name" outlined dense :label="t('admin.edit.corporate.name')" />
      </div>
      <div class="col-10 col-md-3">
        <q-select
          v-model="row.responsibility"
          :options="responsibilityOptions"
          emit-value
          map-options
          outlined
          dense
          clearable
          :label="t('admin.edit.authors.responsibility')"
        />
      </div>
      <div class="col-2 col-md-1 row items-center justify-end">
        <q-btn
          flat
          dense
          round
          icon="delete"
          color="negative"
          :aria-label="t('admin.edit.remove')"
          @click="removeAt(i)"
        />
      </div>
    </div>

    <q-btn
      outline
      dense
      no-caps
      color="primary"
      icon="add"
      :label="t('admin.edit.corporate.add')"
      @click="add"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { emptyCorporateBody, RESPONSIBILITIES, type CorporateBodyForm } from './metadataForm';

// Corporate bodies (COMARC 710-712): name plus which field it came from.

const props = defineProps<{ modelValue: CorporateBodyForm[] }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: CorporateBodyForm[]): void }>();

const { t } = useI18n();
const rows = toRef(props, 'modelValue');

const responsibilityOptions = computed(() =>
  RESPONSIBILITIES.map((r) => ({ label: t(`admin.edit.responsibility.${r}`), value: r })),
);

function add() {
  emit('update:modelValue', [...props.modelValue, emptyCorporateBody()]);
}

function removeAt(i: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, idx) => idx !== i),
  );
}
</script>

<style scoped lang="sass">
.editor-label
  font-size: 0.8rem
  font-weight: 600
  color: $muted
</style>
