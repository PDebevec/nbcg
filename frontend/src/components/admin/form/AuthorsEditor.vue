<template>
  <div>
    <div class="row items-center q-mb-sm">
      <div class="editor-label">{{ t('admin.edit.fields.authors') }}</div>
      <q-space />
      <q-select
        :model-value="null"
        :options="suggestions"
        outlined
        dense
        use-input
        hide-selected
        input-debounce="300"
        :label="t('admin.edit.authors.find')"
        class="find-author"
        @filter="onFilter"
        @update:model-value="addFromSuggestion"
      >
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
            <q-item-section class="text-library-muted">{{
              t('admin.edit.noMatch')
            }}</q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>

    <q-card v-for="(row, i) in rows" :key="i" flat bordered class="author-row q-mb-sm">
      <q-card-section class="row q-col-gutter-sm">
        <div class="col-12 col-md-4">
          <q-input
            v-model="row.familyName"
            outlined
            dense
            :label="t('admin.edit.authors.familyName')"
          />
        </div>
        <div class="col-12 col-md-4">
          <q-input
            v-model="row.firstName"
            outlined
            dense
            :label="t('admin.edit.authors.firstName')"
          />
        </div>
        <div class="col-6 col-md-2">
          <q-input v-model="row.prefix" outlined dense :label="t('admin.edit.authors.prefix')" />
        </div>
        <div class="col-6 col-md-2">
          <q-input
            v-model="row.romanNumerals"
            outlined
            dense
            :label="t('admin.edit.authors.romanNumerals')"
          />
        </div>
        <div class="col-12 col-md-3">
          <q-input
            v-model="row.dates"
            outlined
            dense
            :label="t('admin.edit.authors.dates')"
            :placeholder="t('admin.edit.authors.datesPlaceholder')"
          />
        </div>
        <div class="col-12 col-md-5">
          <CodeSelect
            v-model="row.role"
            :options="roles"
            :label="t('admin.edit.authors.role')"
            dense
          />
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
      </q-card-section>
    </q-card>

    <q-btn
      outline
      dense
      no-caps
      color="primary"
      icon="person_add"
      :label="t('admin.edit.authors.add')"
      @click="add"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { suggestValues, type AuthorSuggestion, type ResolvedCode } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import CodeSelect from './CodeSelect.vue';
import { emptyAuthor, RESPONSIBILITIES, type AuthorForm } from './metadataForm';

// Personal authors (COMARC 700-702). Rows are edited in place on the array
// the page owns; add / remove replace the array so the parent sees the change.

const props = defineProps<{
  modelValue: AuthorForm[];
  /** Relator codes from the schema. */
  roles: ResolvedCode[];
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: AuthorForm[]): void }>();

const { t } = useI18n();
const { codeLabel } = useCodeLabel();

// Row fields bind straight into the objects; the parent form is a reactive
// object, so this is the same state, not a copy.
const rows = toRef(props, 'modelValue');

const responsibilityOptions = computed(() =>
  RESPONSIBILITIES.map((r) => ({ label: t(`admin.edit.responsibility.${r}`), value: r })),
);

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
    try {
      const result = await suggestValues({
        field: 'author',
        ...(input.trim() ? { q: input.trim() } : {}),
        limit: 10,
      });
      next = result.suggestions.map((s) => s.value);
    } catch {
      next = [];
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
.editor-label
  font-size: 0.8rem
  font-weight: 600
  color: $muted

.find-author
  min-width: 280px

.author-row
  background: $paper
  border-radius: $radius
</style>
