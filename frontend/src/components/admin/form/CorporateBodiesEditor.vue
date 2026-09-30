<template>
  <div class="column q-gutter-y-sm">
    <div v-for="(row, i) in rows" :key="i" class="body-row">
      <SuggestTextInput
        v-model="row.name"
        field="corporateBody"
        :placeholder="t('admin.edit.corporate.name')"
        :readonly="readonly"
      />
      <q-select
        v-model="row.responsibility"
        :options="responsibilityOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        clearable
        :readonly="readonly"
        :placeholder="row.responsibility ? undefined : t('admin.edit.authors.responsibility')"
      />
      <q-btn
        v-if="!readonly"
        flat
        dense
        round
        icon="o_delete"
        color="negative"
        :aria-label="t('admin.common.remove')"
        @click="removeAt(i)"
      />
    </div>

    <div v-if="!readonly">
      <q-btn
        outline
        dense
        no-caps
        color="primary"
        icon="o_add"
        :label="t('admin.edit.corporate.add')"
        @click="add"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSchemaLabel } from 'src/composables/useSchemaForm';
import { useSchemaStore } from 'src/stores/schema-store';
import SuggestTextInput from './SuggestTextInput.vue';
import { emptyCorporateBody, RESPONSIBILITIES, type CorporateBodyForm } from './metadataForm';

// Corporate bodies (COMARC 710-712): name plus which field it came from.
// A row without a name is dropped on save — the schema requires one.

const props = defineProps<{
  modelValue: CorporateBodyForm[];
  readonly?: boolean | undefined;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', value: CorporateBodyForm[]): void }>();

const { t } = useI18n();
const { tl } = useSchemaLabel();
const schemaStore = useSchemaStore();
const rows = toRef(props, 'modelValue');

const responsibilityOptions = computed(() => {
  const values = schemaStore.values('responsibility');
  return values.length
    ? values.map((v) => ({ label: tl(v), value: String(v.code) }))
    : RESPONSIBILITIES.map((r) => ({ label: t(`admin.edit.responsibility.${r}`), value: r }));
});

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
.body-row
  display: grid
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr) 36px
  gap: 12px
  align-items: center
</style>
