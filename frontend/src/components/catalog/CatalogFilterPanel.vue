<template>
  <div class="refine">
    <div class="refine__head">
      <h2 class="refine__title">{{ t('catalog.refine') }}</h2>
      <q-btn
        flat
        dense
        no-caps
        :label="t('catalog.clearAll')"
        :disable="!hasCatalogFilters(query)"
        class="refine__clear"
        @click="emit('clear')"
      />
    </div>

    <!-- Material type -->
    <q-expansion-item v-model="open.type" expand-icon="o_expand_more" header-class="refine__header" class="refine__group">
      <template #header>
        <div class="refine__label">
          <span class="refine__name">{{ t('catalog.groups.type') }}</span>
          <span v-if="!open.type" class="refine__caption">{{ chosenCaption(query.materialType, typeOptions) }}</span>
        </div>
        <q-badge v-if="query.materialType.length" class="badge-soft badge-soft--sm badge-soft--primary refine__count">
          {{ query.materialType.length }}
        </q-badge>
      </template>
      <div class="refine__options">
        <q-checkbox
          v-for="opt in visibleTypes"
          :key="opt.value"
          dense
          :model-value="query.materialType"
          :val="opt.value"
          class="refine__opt"
          @update:model-value="emit('patch', { materialType: $event })"
        >
          <span class="refine__opt-label">{{ opt.label }}</span>
          <span class="refine__opt-count">{{ opt.count }}</span>
        </q-checkbox>
        <q-btn
          v-if="typeOptions.length > SHOW_LIMIT"
          flat
          dense
          no-caps
          :label="moreTypes ? t('catalog.showLess') : t('catalog.showMore')"
          class="refine__more"
          @click="moreTypes = !moreTypes"
        />
      </div>
    </q-expansion-item>

    <!-- Period: one range at a time -->
    <q-expansion-item v-model="open.period" expand-icon="o_expand_more" header-class="refine__header" class="refine__group">
      <template #header>
        <div class="refine__label">
          <span class="refine__name">{{ t('catalog.groups.period') }}</span>
          <span v-if="!open.period" class="refine__caption">{{ periodCaption }}</span>
        </div>
        <q-badge v-if="query.yearFrom || query.yearTo" class="badge-soft badge-soft--sm badge-soft--primary refine__count">1</q-badge>
      </template>
      <div class="refine__options">
        <q-checkbox
          v-for="era in ERAS"
          :key="era.key"
          dense
          :model-value="isEra(era)"
          class="refine__opt"
          @update:model-value="
            emit('patch', $event ? { yearFrom: era.from ?? '', yearTo: era.to ?? '' } : { yearFrom: '', yearTo: '' })
          "
        >
          <span class="refine__opt-label">{{ t(`catalog.eras.${era.key}`) }}</span>
        </q-checkbox>
      </div>
    </q-expansion-item>

    <!-- Language -->
    <q-expansion-item v-model="open.language" expand-icon="o_expand_more" header-class="refine__header" class="refine__group">
      <template #header>
        <div class="refine__label">
          <span class="refine__name">{{ t('catalog.groups.language') }}</span>
          <span v-if="!open.language" class="refine__caption">{{ chosenCaption(query.language, languageOptions) }}</span>
        </div>
        <q-badge v-if="query.language.length" class="badge-soft badge-soft--sm badge-soft--primary refine__count">
          {{ query.language.length }}
        </q-badge>
      </template>
      <div class="refine__options">
        <q-checkbox
          v-for="opt in visibleLanguages"
          :key="opt.value"
          dense
          :model-value="query.language"
          :val="opt.value"
          class="refine__opt"
          @update:model-value="emit('patch', { language: $event })"
        >
          <span class="refine__opt-label">{{ opt.label }}</span>
          <span class="refine__opt-count">{{ opt.count }}</span>
        </q-checkbox>
        <q-btn
          v-if="languageOptions.length > SHOW_LIMIT"
          flat
          dense
          no-caps
          :label="moreLanguages ? t('catalog.showLess') : t('catalog.showMore')"
          class="refine__more"
          @click="moreLanguages = !moreLanguages"
        />
      </div>
    </q-expansion-item>

    <!-- Author -->
    <q-expansion-item v-model="open.author" expand-icon="o_expand_more" header-class="refine__header" class="refine__group">
      <template #header>
        <div class="refine__label">
          <span class="refine__name">{{ t('catalog.groups.author') }}</span>
          <span v-if="!open.author" class="refine__caption">{{ query.author || t('catalog.any') }}</span>
        </div>
      </template>
      <div class="refine__options refine__options--field">
        <q-input
          :model-value="query.author"
          outlined
          dense
          debounce="400"
          clearable
          :placeholder="t('catalog.authorPlaceholder')"
          :aria-label="t('catalog.groups.author')"
          @update:model-value="emit('patch', { author: String($event ?? '').trim() })"
        />
      </div>
    </q-expansion-item>

    <!-- Publisher -->
    <q-expansion-item v-model="open.publisher" expand-icon="o_expand_more" header-class="refine__header" class="refine__group">
      <template #header>
        <div class="refine__label">
          <span class="refine__name">{{ t('catalog.groups.publisher') }}</span>
          <span v-if="!open.publisher" class="refine__caption">{{ query.publisher || t('catalog.any') }}</span>
        </div>
      </template>
      <div class="refine__options refine__options--field">
        <q-select
          :model-value="query.publisher || null"
          :options="publisherOptions"
          outlined
          dense
          use-input
          fill-input
          hide-selected
          clearable
          input-debounce="300"
          :placeholder="query.publisher ? undefined : t('catalog.publisherPlaceholder')"
          :aria-label="t('catalog.groups.publisher')"
          @filter="filterPublisher"
          @update:model-value="emit('patch', { publisher: $event ?? '' })"
          @clear="emit('patch', { publisher: '' })"
        >
          <template #append><q-icon name="o_search" size="18px" /></template>
        </q-select>
      </div>
    </q-expansion-item>

    <!-- Collection -->
    <q-expansion-item v-model="open.collection" expand-icon="o_expand_more" header-class="refine__header" class="refine__group">
      <template #header>
        <div class="refine__label">
          <span class="refine__name">{{ t('catalog.groups.collection') }}</span>
          <span v-if="!open.collection" class="refine__caption">{{ collectionCaption }}</span>
        </div>
      </template>
      <div class="refine__options">
        <q-option-group
          :model-value="query.collectionType"
          :options="collectionOptions"
          type="radio"
          dense
          class="refine__radios"
          @update:model-value="emit('patch', { collectionType: $event })"
        />
      </div>
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { suggestValues } from 'src/api/search';
import { ERAS, type Era } from 'src/utils/eras';
import { hasCatalogFilters, type CatalogQuery } from 'src/utils/catalogQuery';

// The catalogue's "Refine" column (design canvas, filter direction 3): no box,
// one group per filter; closed groups show their choice, open ones a count.
// The panel owns no filter state — it reads the query and emits patches.

export interface FacetOption {
  value: string;
  label: string;
  /** Records with this value in the whole catalogue (not the current search) */
  count: number;
}

const props = defineProps<{
  query: CatalogQuery;
  typeOptions: FacetOption[];
  languageOptions: FacetOption[];
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Partial<CatalogQuery>): void;
  (e: 'clear'): void;
}>();

const { t } = useI18n();

const SHOW_LIMIT = 6;

const open = reactive({
  type: true,
  period: true,
  language: false,
  author: false,
  publisher: false,
  collection: false,
});

const moreTypes = ref(false);
const moreLanguages = ref(false);

const visibleTypes = computed(() => (moreTypes.value ? props.typeOptions : props.typeOptions.slice(0, SHOW_LIMIT)));
const visibleLanguages = computed(() =>
  moreLanguages.value ? props.languageOptions : props.languageOptions.slice(0, SHOW_LIMIT),
);

function chosenCaption(chosen: string[], options: FacetOption[]): string {
  if (!chosen.length) return t('catalog.any');
  return chosen.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ');
}

function isEra(era: Era): boolean {
  return props.query.yearFrom === (era.from ?? '') && props.query.yearTo === (era.to ?? '');
}

const periodCaption = computed(() => {
  const { yearFrom, yearTo } = props.query;
  if (!yearFrom && !yearTo) return t('catalog.any');
  const era = ERAS.find(isEra);
  return era ? t(`catalog.eras.${era.key}`) : `${yearFrom || '…'}–${yearTo || '…'}`;
});

const collectionOptions = computed(() => [
  { label: t('catalog.collection.any'), value: '' },
  { label: t('catalog.collection.only'), value: '>0' },
  { label: t('catalog.collection.single'), value: '0' },
]);

const collectionCaption = computed(
  () => collectionOptions.value.find((o) => o.value === props.query.collectionType)?.label ?? t('catalog.any'),
);

const publisherOptions = ref<string[]>([]);

function filterPublisher(input: string, doneFn: (cb: () => void) => void) {
  void (async () => {
    let options: string[] = [];
    try {
      const result = await suggestValues({
        field: 'publisher',
        ...(input.trim() ? { q: input.trim() } : {}),
        limit: 10,
        type: 'records',
      });
      options = result.suggestions.map((s) => s.value);
    } catch {
      options = [];
    }
    doneFn(() => {
      publisherOptions.value = options;
    });
  })();
}
</script>

<style scoped lang="sass">
.refine__head
  display: flex
  align-items: center
  justify-content: space-between
  padding-bottom: 16px

.refine__title
  margin: 0
  font-size: 16px
  font-weight: 700
  color: $ink

.refine__clear
  color: $eyebrow
  font-weight: 600
  font-size: 13.5px

.refine__group
  border-top: 1px solid $divider

:deep(.refine__header)
  min-height: 48px
  padding: 6px 0
  .q-item__section--side
    padding-left: 8px
    color: $muted
  .q-focus-helper
    display: none

.refine__label
  display: flex
  flex-direction: column
  gap: 2px
  flex-grow: 1
  min-width: 0

.refine__name
  font-size: 14.5px
  font-weight: 600
  color: $ink

.refine__caption
  font-size: 13px
  color: $muted
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis

.refine__count
  align-self: center
  margin-right: 4px

.refine__options
  display: flex
  flex-direction: column
  padding: 0 0 14px
  &--field
    padding-top: 2px

.refine__opt
  min-height: 34px
  font-size: 14px
  color: $ink
  :deep(.q-checkbox__label)
    display: flex
    align-items: center
    gap: 8px
    flex-grow: 1
    min-width: 0
    padding-left: 4px
  :deep(.q-checkbox__inner)
    color: #B8AE98

.refine__opt-label
  flex-grow: 1

.refine__opt-count
  font-size: 12.5px
  color: $muted

.refine__more
  align-self: flex-start
  margin-top: 4px
  color: $primary
  font-weight: 600
  font-size: 13.5px

.refine__radios
  :deep(.q-radio)
    min-height: 34px
    font-size: 14px
</style>
