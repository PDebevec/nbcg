<template>
  <div class="column q-gutter-y-sm">
    <div v-if="!readonly" class="row justify-end">
      <q-select
        :model-value="null"
        :options="suggestions"
        outlined
        dense
        options-dense
        use-input
        hide-selected
        hide-dropdown-icon
        input-debounce="300"
        :placeholder="t('admin.edit.authors.find')"
        class="find-author"
        @filter="onFilter"
        @update:model-value="addFromSuggestion"
      >
        <template #prepend><q-icon name="o_search" size="18px" /></template>
        <template #option="{ itemProps, opt }">
          <q-item v-bind="itemProps">
            <q-item-section>
              <q-item-label>{{ suggestionLabel(opt) }}</q-item-label>
              <q-item-label v-if="opt.role" caption>{{ codeLabel(opt.role) }}</q-item-label>
            </q-item-section>
          </q-item>
        </template>
        <template #no-option>
          <q-item>
            <q-item-section class="adm-muted">{{ t('admin.common.noMatch') }}</q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>

    <div v-for="(row, i) in rows" :key="i" class="author-row">
      <div class="author-row__grid author-row__grid--name">
        <FormField :label="sub('familyName')">
          <q-input v-model="row.familyName" outlined dense :readonly="readonly" />
        </FormField>
        <FormField :label="sub('firstName')">
          <q-input v-model="row.firstName" outlined dense :readonly="readonly" />
        </FormField>
        <FormField :label="sub('dates')">
          <q-input
            v-model="row.dates"
            outlined
            dense
            :readonly="readonly"
            :placeholder="t('admin.edit.authors.datesPlaceholder')"
          />
        </FormField>
        <q-btn
          v-if="!readonly"
          flat
          dense
          round
          icon="o_delete"
          color="negative"
          class="author-row__remove"
          :aria-label="t('admin.common.remove')"
          @click="removeAt(i)"
        />
      </div>
      <div class="author-row__grid author-row__grid--role">
        <FormField :label="sub('role')">
          <VocabularySelect
            :model-value="row.role"
            vocabulary="relator"
            :readonly="readonly"
            @update:model-value="row.role = $event as ResolvedCode | null"
          />
        </FormField>
        <FormField :label="sub('responsibility')">
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
          />
        </FormField>
        <FormField :label="sub('prefix')">
          <q-input v-model="row.prefix" outlined dense :readonly="readonly" />
        </FormField>
        <FormField :label="sub('romanNumerals')">
          <q-input v-model="row.romanNumerals" outlined dense :readonly="readonly" />
        </FormField>
      </div>
    </div>

    <div v-if="!readonly">
      <q-btn
        outline
        dense
        no-caps
        color="primary"
        icon="o_person_add"
        :label="t('admin.edit.authors.add')"
        @click="add"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { suggestValues, type AuthorSuggestion, type ResolvedCode } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { useSchemaLabel } from 'src/composables/useSchemaForm';
import { useSchemaStore } from 'src/stores/schema-store';
import FormField from 'src/components/admin/FormField.vue';
import VocabularySelect from './VocabularySelect.vue';
import { emptyAuthor, RESPONSIBILITIES, type AuthorForm } from './metadataForm';

// Personal authors (COMARC 700-702). Rows are edited in place on the array
// the page owns; add / remove replace the array so the parent sees the change.
// The role comes from the relator vocabulary (searched — 116 codes), the
// responsibility (700 / 701 / 702) from the schema's short list.

const props = defineProps<{
  modelValue: AuthorForm[];
  readonly?: boolean | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: AuthorForm[]): void }>();

const { t } = useI18n();
const { codeLabel } = useCodeLabel();
const { tl } = useSchemaLabel();
const schemaStore = useSchemaStore();

// Row fields bind straight into the objects; the parent form is a reactive
// object, so this is the same state, not a copy.
const rows = toRef(props, 'modelValue');

/** Captions of the sub-fields come from the schema; the i18n file is the fallback. */
function sub(key: string): string {
  return tl(schemaStore.field(`authors.${key}`)?.label) || t(`admin.edit.authors.${key}`);
}

const responsibilityOptions = computed(() => {
  const values = schemaStore.values('responsibility');
  return values.length
    ? values.map((v) => ({ label: tl(v), value: String(v.code) }))
    : RESPONSIBILITIES.map((r) => ({ label: t(`admin.edit.responsibility.${r}`), value: r }));
});

function add() {
  emit('update:modelValue', [...props.modelValue, emptyAuthor()]);
}

function removeAt(i: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, idx) => idx !== i),
  );
}

// ── Typeahead over authors already in the catalogue ──

const suggestions = ref<AuthorSuggestion[]>([]);

function suggestionLabel(a: AuthorSuggestion): string {
  const name = [a.familyName, a.firstName].filter(Boolean).join(', ');
  return a.dates ? `${name} (${a.dates})` : name;
}

function onFilter(input: string, done: (cb: () => void) => void) {
  void (async () => {
    let next: AuthorSuggestion[] = [];
    if (input.trim().length >= 2) {
      try {
        const result = await suggestValues({ field: 'author', q: input.trim(), limit: 8 });
        next = result.suggestions.map((s) => s.value);
      } catch {
        next = [];
      }
    }
    done(() => {
      suggestions.value = next;
    });
  })();
}

function addFromSuggestion(a: AuthorSuggestion | null) {
  if (!a) return;
  const row = emptyAuthor();
  row.familyName = a.familyName ?? '';
  row.firstName = a.firstName ?? '';
  row.prefix = a.prefix ?? '';
  row.dates = a.dates ?? '';
  row.role = a.role ?? null;
  emit('update:modelValue', [...props.modelValue, row]);
}
</script>

<style scoped lang="sass">
.find-author
  width: 320px
  max-width: 100%

.author-row
  display: flex
  flex-direction: column
  gap: 12px
  padding: 14px 16px
  background: #FBF8F1
  border: 1px solid $divider
  border-radius: $radius

.author-row__grid
  display: grid
  gap: 12px
  align-items: end

.author-row__grid--name
  grid-template-columns: minmax(0, 3fr) minmax(0, 3fr) minmax(0, 2fr) 36px

.author-row__grid--role
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 36px

.author-row__remove
  margin-bottom: 2px

@media (max-width: 900px)
  .author-row__grid--name,
  .author-row__grid--role
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)
</style>
