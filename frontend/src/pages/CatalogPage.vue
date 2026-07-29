<template>
  <q-page class="row no-wrap items-stretch">

    <!-- FILTERS — in-flow left column; scrolls with the page -->
    <aside class="filter-panel q-pa-md">

      <div class="text-subtitle1 text-weight-bold text-primary q-mb-md">{{ t('catalog.filters') }}</div>

      <!-- TYPE -->
      <div class="section-label text-library-muted q-mb-sm">{{ t('catalog.itemType') }}</div>
      <MultiSelectChipsFilter
        v-model="selectedTypes"
        :options="typeOptions"
        :empty-label="t('catalog.allTypes')"
        class="q-mb-md"
      />

      <q-separator color="library-divider" class="q-my-md" />

      <!-- LANGUAGE -->
      <div class="section-label text-library-muted q-mb-sm">{{ t('catalog.language') }}</div>
      <MultiSelectFilter
        v-model="selectedLanguages"
        :options="languageOptions"
        :empty-label="t('catalog.allLanguages')"
        class="q-mb-md"
      />

      <q-separator color="library-divider" class="q-my-md" />

      <!-- ERA -->
      <div class="section-label text-library-muted q-mb-sm">{{ t('catalog.period') }}</div>
      <div class="row wrap q-gutter-xs q-mb-md">
        <q-chip
          v-for="era in eras"
          :key="era.value"
          :outline="selectedEra !== era.value"
          :color="selectedEra === era.value ? 'secondary' : 'library-muted'"
          :text-color="selectedEra === era.value ? 'white' : 'library-muted'"
          clickable
          size="sm"
          @click="selectEra(era)"
        >{{ era.label }}</q-chip>
      </div>

      <q-separator color="library-divider" class="q-my-md" />

      <q-btn
        flat no-caps dense
        color="negative"
        :label="t('catalog.resetFilters')"
        icon="restart_alt"
        size="sm"
        @click="resetFilters"
      />
    </aside>

    <!-- RESULTS -->
    <div class="results-area col q-px-lg q-py-lg">

      <!-- RESULTS BAR -->
      <div class="row items-center justify-between q-mb-lg">
        <div>
          <h1 class="text-h5 text-weight-bold text-primary q-my-none">{{ t('catalog.title') }}</h1>
          <div class="text-body2 text-library-muted q-mt-xs">
            <q-spinner v-if="loading" size="14px" color="primary" class="q-mr-xs" />
            {{ t('catalog.showing') }}
            <strong class="text-library-ink">{{ filteredItems.length }}</strong>
            {{ t('catalog.of') }} {{ totalItems }} {{ t('catalog.items') }}
          </div>
        </div>
        <q-select
          v-model="sortBy"
          :options="sortOptions"
          outlined dense emit-value map-options
          :label="t('catalog.sortBy')"
          class="sort-select"
        />
      </div>

      <!-- MASONRY GRID -->
      <div class="masonry">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          class="masonry-item cursor-pointer"
          @click="openRecord(item)"
        >
          <div class="cover-wrap">
            <img :src="coverUrl(item)" class="cover-img" loading="lazy" />
            <q-badge
              class="type-badge"
              :color="typeColor(item.source.metadata.materialType?.en ?? '')"
              :label="item.source.metadata.materialType?.en"
            />
          </div>
          <div class="q-mt-sm q-px-xs">
            <div class="text-weight-bold text-body2 text-library-ink ellipsis-2-lines">{{ item.source.metadata.title }}</div>
            <div class="text-caption text-library-muted ellipsis q-mt-xs">
              {{ item.source.metadata.firstResponsibility }}<template v-if="item.source.metadata.firstResponsibility && item.source.metadata.publicationDate1"> · </template>{{ item.source.metadata.publicationDate1 }}
            </div>
          </div>
        </div>
      </div>

      <!-- PAGINATION -->
      <div class="row justify-center q-mt-lg">
        <q-pagination
          v-model="page"
          :max="totalPages"
          :max-pages="6"
          boundary-numbers
          color="primary"
          active-color="primary"
        />
      </div>
    </div>

  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import imageStock from 'src/assets/image-stock.jpg';
import { searchItems, suggestValues, type ResolvedCode, type SearchHit } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { useCatalogSearch } from 'src/composables/useCatalogSearch';
import MultiSelectFilter from 'src/components/MultiSelectFilter.vue';
import MultiSelectChipsFilter from 'src/components/MultiSelectChipsFilter.vue';

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const { codeLabel } = useCodeLabel();
function openRecord(item: SearchHit) {
  void router.push(`/catalog/${item.id}`);
}

//TEMPORARY IMAGE, currently bad todo: make better
function coverUrl(item: SearchHit): string {
  const img = item.source.file_attachments?.find((f) => f.fileType === 'IMAGE');
  return img ? `/api/files/${img.id}/download` : imageStock;
}

function queryStr(key: string): string {
  const v = route.query[key];
  return typeof v === 'string' ? v : '';
}

function queryList(key: string): string[] {
  return queryStr(key).split(',').map((s) => s.trim()).filter(Boolean);
}

// Header-hosted search state (shared with MainLayout), seeded from the URL
const { searchText: filterSearch, fullText: fullTextSearch } = useCatalogSearch();
filterSearch.value = queryStr('q');
fullTextSearch.value = queryStr('fullText') === '1';
const selectedTypes = ref<string[]>(queryList('materialType'));
const selectedLanguages = ref<string[]>(queryList('language'));
const publisherFilter = ref(queryStr('publisher'));
const yearFrom = ref(queryStr('yearFrom'));
const yearTo = ref(queryStr('yearTo'));
const sortBy = ref<'relevance' | 'newest'>(queryStr('sort') === 'newest' ? 'newest' : 'relevance');
const page = ref(1);
const loading = ref(false);

const languageCodes = ref<ResolvedCode[]>([]);
const materialTypeCodes = ref<ResolvedCode[]>([]);

// Filter values are the `en` names — the backend filters match on metadata.*.en
const languageOptions = computed(() =>
  languageCodes.value.map((c) => ({ label: codeLabel(c), value: c.en })),
);
const typeOptions = computed(() =>
  materialTypeCodes.value.map((c) => ({ label: codeLabel(c), value: c.en })),
);

async function loadFilterOptions() {
  try {
    const [langs, types] = await Promise.all([
      suggestValues({ field: 'language', limit: 50, type: 'records' }),
      suggestValues({ field: 'materialType', limit: 50, type: 'records' }),
    ]);
    languageCodes.value = langs.suggestions.map((s) => s.value);
    materialTypeCodes.value = types.suggestions.map((s) => s.value);
  } catch {
    languageCodes.value = [];
    materialTypeCodes.value = [];
  }
}

interface Era {
  label: string;
  value: string;
  from?: string;
  to?: string;
}

const eras = computed<Era[]>(() => [
  { label: t('catalog.eras.all'),      value: 'vse' },
  { label: t('catalog.eras.pre1800'),  value: 'do1800',    to: '1799' },
  { label: t('catalog.eras.c19'),      value: '19st',      from: '1800', to: '1899' },
  { label: t('catalog.eras.e1900'),    value: '1900-1950', from: '1900', to: '1950' },
  { label: t('catalog.eras.e1950'),    value: '1950-2000', from: '1950', to: '2000' },
  { label: t('catalog.eras.post2000'), value: 'po2000',    from: '2001' },
]);

// A custom year range (e.g. from the advanced search page) selects no chip
const selectedEra = computed(() => {
  if (!yearFrom.value && !yearTo.value) return 'vse';
  const match = eras.value.find(
    (e) => (e.from ?? '') === yearFrom.value && (e.to ?? '') === yearTo.value,
  );
  return match?.value ?? '';
});

function selectEra(era: Era) {
  yearFrom.value = era.from ?? '';
  yearTo.value = era.to ?? '';
}

const sortOptions = computed(() => [
  { label: t('catalog.sort.relevance'), value: 'relevance' },
  { label: t('catalog.sort.newest'),    value: 'newest' },
]);

const items = ref<SearchHit[]>([]);
const totalItems = ref(0);
const totalPages = ref(1);
const PAGE_SIZE = 20;

const LIST_FIELDS = [
  'metadata.title',
  'metadata.firstResponsibility',
  'metadata.publicationDate1',
  'metadata.materialType',
  'metadata.language',
  'metadata.publication.publisher',
  'file_attachments.id',
  'file_attachments.fileType',
].join(',');

async function fetchItems() {
  loading.value = true;
  try {
    const q = filterSearch.value.trim();
    const result = await searchItems({
      type: 'records',
      page: page.value,
      limit: PAGE_SIZE,
      fields: LIST_FIELDS,
      sort: sortBy.value,
      ...(q ? (fullTextSearch.value ? { q } : { title: q }) : {}),
      ...(selectedTypes.value.length ? { materialType: selectedTypes.value.join(',') } : {}),
      ...(selectedLanguages.value.length ? { language: selectedLanguages.value.join(',') } : {}),
      ...(publisherFilter.value ? { publisher: publisherFilter.value } : {}),
      ...(yearFrom.value ? { yearFrom: yearFrom.value } : {}),
      ...(yearTo.value ? { yearTo: yearTo.value } : {}),
    });
    items.value = result.hits;
    totalItems.value = result.total;
    totalPages.value = result.pages;
  } finally {
    loading.value = false;
  }
}

watch(filterSearch, () => {
  page.value = 1;
  void fetchItems();
});

watch(
  [selectedTypes, selectedLanguages, fullTextSearch, yearFrom, yearTo, publisherFilter, sortBy],
  () => {
    page.value = 1;
    void fetchItems();
  },
  { deep: true },
);

watch(page, () => { void fetchItems(); });

onMounted(() => {
  void fetchItems();
  void loadFilterOptions();
});

const typeColorMap: Record<string, string> = {
  'Monograph':          'primary',
  'Serial publication': 'secondary',
  'Manuscript':         'accent',
  'Map':                'positive',
  'Printed music':      'info',
  'Sound recording':    'negative',
  'Visual material':    'warning',
};

function typeColor(type: string) {
  return typeColorMap[type] ?? 'library-muted';
}

const filteredItems = computed(() => {
 return items.value;
});

function resetFilters() {
  selectedTypes.value = [];
  selectedLanguages.value = [];
  publisherFilter.value = '';
  yearFrom.value = '';
  yearTo.value = '';
  filterSearch.value = '';
  page.value = 1;
}
</script>

<style scoped lang="sass">
.sort-select
  min-width: 170px

.section-label
  letter-spacing: 0.08em
  text-transform: uppercase
  font-size: 0.72rem
  font-weight: 700

// In-flow left column: stretches to the page's full content height, so the
// space under the filters stays a quiet $surface strip while scrolling
.filter-panel
  width: $page-gutter
  flex: 0 0 $page-gutter
  background: $surface
  border-right: 1px solid $divider

.results-area
  min-width: 0

// CSS-columns masonry: fixed column width, image height stays natural
.masonry
  column-width: 220px
  column-gap: 20px

.masonry-item
  break-inside: avoid
  margin-bottom: 28px

.cover-wrap
  position: relative
  line-height: 0

.cover-img
  width: 100%
  height: auto
  display: block
  border-radius: 4px
  border: 1px solid $divider
  transition: box-shadow 0.2s

.masonry-item:hover .cover-img
  box-shadow: 0 6px 24px rgba($dark, 0.16)

.type-badge
  position: absolute
  top: 8px
  right: 8px

.ellipsis-2-lines
  display: -webkit-box
  -webkit-line-clamp: 2
  -webkit-box-orient: vertical
  overflow: hidden

// Below md the filter column stacks above the results
@media (max-width: 1023px)
  .q-page.row
    flex-direction: column

  .filter-panel
    width: 100%
    flex: 1 1 auto
    border-right: none
    border-bottom: 1px solid $divider
</style>
