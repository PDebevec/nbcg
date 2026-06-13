<template>
  <q-page>
    <!-- PAGE HEADER -->
    <div class="catalog-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="row items-center justify-between q-px-md">
          <div>
            <div class="header-kicker q-mb-xs">{{ t('catalog.kicker') }}</div>
            <h1 class="text-h4 text-weight-bold text-white q-my-none">{{ t('catalog.title') }}</h1>
          </div>
          <div class="row q-gutter-xs">
            <q-btn
              flat round
              :color="viewMode === 'grid' ? 'secondary' : 'white'"
              icon="grid_view"
              @click="viewMode = 'grid'"
            />
            <q-btn
              flat round
              :color="viewMode === 'list' ? 'secondary' : 'white'"
              icon="view_list"
              @click="viewMode = 'list'"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="page-body q-px-md q-py-lg">
      <div class="row q-col-gutter-lg">

        <!-- SIDEBAR -->
        <div class="col-12 col-md-3">
          <q-card flat bordered class="filter-card q-pa-md">

            <!-- SEARCH -->
            <q-input
              v-model="filterSearch"
              outlined dense
              debounce="350"
              :placeholder="t('catalog.searchWithin')"
              class="q-mb-md"
            >
              <template #prepend>
                <q-icon name="search" size="18px" color="grey-6" />
              </template>
              <template #append>
                <q-btn
                  flat round dense
                  :icon="fullTextSearch ? 'manage_search' : 'text_fields'"
                  :color="fullTextSearch ? 'primary' : 'grey-5'"
                  size="sm"
                  @click="fullTextSearch = !fullTextSearch"
                  >
                  <q-tooltip>{{ fullTextSearch ? t('catalog.fullTextOn') : t('catalog.fullTextOff') }}</q-tooltip>
                </q-btn>
              </template>
            </q-input>

            <!-- TYPE -->
            <div class="section-label text-library-muted q-mb-sm">{{ t('catalog.itemType') }}</div>
            <q-option-group
              v-model="selectedType"
              :options="typeOptions"
              color="primary" dense
              class="q-mb-md"
            />

            <q-separator color="grey-3" class="q-my-md" />

            <!-- LANGUAGE -->
            <div class="section-label text-library-muted q-mb-sm">{{ t('catalog.language') }}</div>
            <div class="column q-gutter-xs q-mb-md">
              <q-checkbox
                v-for="lang in languages"
                :key="lang.value"
                v-model="selectedLanguages"
                :val="lang.value"
                :label="lang.label"
                color="primary" dense
                />
            </div>

            <q-separator color="grey-3" class="q-my-md" />

            <!-- ERA -->
            <div class="section-label text-library-muted q-mb-sm">{{ t('catalog.period') }}</div>
            <div class="row wrap q-gutter-xs q-mb-md">
              <q-chip
                v-for="era in eras"
                :key="era.value"
                :outline="selectedEra !== era.value"
                :color="selectedEra === era.value ? 'primary' : 'grey-5'"
                :text-color="selectedEra === era.value ? 'white' : 'grey-7'"
                clickable
                size="sm"
                @click="selectedEra = era.value"
              >{{ era.label }}</q-chip>
            </div>

            <q-separator color="grey-3" class="q-my-md" />

            <q-btn
              flat no-caps dense
              color="negative"
              :label="t('catalog.resetFilters')"
              icon="restart_alt"
              size="sm"
              @click="resetFilters"
            />
          </q-card>
        </div>

        <!-- RESULTS -->
        <div class="col-12 col-md-9">

          <!-- RESULTS BAR -->
          <div class="row items-center justify-between q-mb-md">
            <div class="text-body2 text-library-muted">
              <q-spinner v-if="loading" size="14px" color="primary" class="q-mr-xs" />
              {{ t('catalog.showing') }}
              <strong class="text-library-ink">{{ filteredItems.length }}</strong>
              {{ t('catalog.of') }} {{ totalItems }} {{ t('catalog.items') }}
            </div>
            <q-select
              v-model="sortBy"
              :options="sortOptions"
              outlined dense emit-value map-options
              :label="t('catalog.sortBy')"
              class="sort-select"
            />
          </div>

          <!-- GRID VIEW -->
          <div v-if="viewMode === 'grid'" class="row q-col-gutter-md">
            <div
              v-for="item in filteredItems"
              :key="item.id"
              class="col-6 col-sm-4 col-lg-3"
            >
              <q-card flat v-ripple class="item-card cursor-pointer" @click="openRecord(item)">
                <q-img :src="coverUrl(item)" :ratio="2/3" class="item-cover">
                  <div class="absolute-top-right q-pa-xs">
                    <q-badge :color="typeColor(item.source.metadata.materialType?.en ?? '')" :label="item.source.metadata.materialType?.en" />
                  </div>
                </q-img>
                <q-card-section class="q-pa-sm">
                  <div class="text-weight-bold text-caption text-library-ink ellipsis-2-lines">{{ item.source.metadata.title }}</div>
                  <div class="text-caption text-library-muted q-mt-xs ellipsis">{{ item.source.metadata.firstResponsibility }}</div>
                  <div class="row items-center justify-between q-mt-xs">
                    <span class="text-caption text-library-muted">{{ item.source.metadata.publicationDate1 }}</span>
                    <q-btn flat dense no-caps color="primary" :label="t('catalog.view')" size="sm" @click.stop="openRecord(item)" />
                  </div>
                </q-card-section>
              </q-card>
            </div>
          </div>

          <!-- LIST VIEW -->
          <q-list v-else bordered separator class="rounded-borders bg-white">
            <q-item
              v-for="item in filteredItems"
              :key="item.id"
              clickable
              v-ripple
              class="q-py-md"
              @click="openRecord(item)"
            >
              <q-item-section avatar>
                <q-avatar square size="58px" class="rounded-borders overflow-hidden">
                  <img :src="coverUrl(item)" />
                </q-avatar>
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-semibold text-library-ink">{{ item.source.metadata.title }}</q-item-label>
                <q-item-label caption>{{ item.source.metadata.firstResponsibility }}</q-item-label>
                <q-item-label caption>{{ item.source.metadata.publication?.publisher }} · {{ item.source.metadata.publicationDate1 }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="column items-end q-gutter-xs">
                  <q-badge outline :color="typeColor(item.source.metadata.materialType?.en ?? '')" :label="item.source.metadata.materialType?.en" />
                  <q-badge outline color="grey-5" text-color="grey-7" :label="item.source.metadata.language?.[0]?.en" />
                  <q-btn flat dense no-caps color="primary" :label="t('catalog.details')" size="xs" class="q-mt-xs" @click.stop="openRecord(item)" />
                </div>
              </q-item-section>
            </q-item>
          </q-list>

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

      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import imageStock from 'src/assets/image-stock.jpg';
import { searchItems, type SearchHit } from 'src/api/search';

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
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

const viewMode = ref<'grid' | 'list'>('list');
const filterSearch = ref(queryStr('q'));
const fullTextSearch = ref(queryStr('fullText') === '1');
const selectedType = ref(queryStr('materialType') || 'vse');
const selectedLanguages = ref<string[]>([]);
const selectedEra = ref('vse');
const sortBy = ref('relevance');
const page = ref(1);
const loading = ref(false);

const typeOptions = computed(() => [
  { label: t('catalog.types.all'),        value: 'vse' },
  { label: t('catalog.types.monograph'),  value: 'Monograph' },
  { label: t('catalog.types.serial'),     value: 'Serial publication' },
  { label: t('catalog.types.manuscript'), value: 'Manuscript' },
  { label: t('catalog.types.map'),        value: 'Map' },
  { label: t('catalog.types.music'),      value: 'Printed music' },
  { label: t('catalog.types.sound'),      value: 'Sound recording' },
  { label: t('catalog.types.visual'),     value: 'Visual material' },
]);

const languages = computed(() => [
  { label: t('catalog.languages.slovenian'), value: 'Slovenian' },
  { label: t('catalog.languages.german'),    value: 'German' },
  { label: t('catalog.languages.latin'),     value: 'Latin' },
  { label: t('catalog.languages.italian'),   value: 'Italian' },
  { label: t('catalog.languages.croatian'),  value: 'Croatian' },
]);

const eras = computed(() => [
  { label: t('catalog.eras.all'),      value: 'vse' },
  { label: t('catalog.eras.pre1800'),  value: 'do1800' },
  { label: t('catalog.eras.c19'),      value: '19st' },
  { label: t('catalog.eras.e1900'),    value: '1900-1950' },
  { label: t('catalog.eras.e1950'),    value: '1950-2000' },
  { label: t('catalog.eras.post2000'), value: 'po2000' },
]);

const sortOptions = computed(() => [
  { label: t('catalog.sort.relevance'), value: 'relevance' },
  { label: t('catalog.sort.titleAsc'),  value: 'title-asc' },
  { label: t('catalog.sort.yearAsc'),   value: 'year-asc' },
  { label: t('catalog.sort.yearDesc'),  value: 'year-desc' },
]);

const items = ref<SearchHit[]>([]);
const totalItems = ref(0);
const totalPages = ref(1);
const PAGE_SIZE = 20;

async function fetchItems() {
  loading.value = true;
  try {
    const q = filterSearch.value.trim();
    const result = await searchItems({
      type: 'records',
      page: page.value,
      limit: PAGE_SIZE,
      ...(q ? (fullTextSearch.value ? { q } : { title: q }) : {}),
      ...(selectedType.value !== 'vse' ? { materialType: selectedType.value } : {}),
      ...(selectedLanguages.value.length === 1 && selectedLanguages.value[0]
        ? { language: selectedLanguages.value[0] }
        : {}),
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

watch([selectedType, selectedLanguages, fullTextSearch], () => {
  page.value = 1;
  void fetchItems();
}, { deep: true });

watch(page, () => { void fetchItems(); });

onMounted(() => { void fetchItems(); });

const typeColorMap: Record<string, string> = {
  'Monograph':          'primary',
  'Serial publication': 'secondary',
  'Manuscript':         'accent',
  'Map':                'positive',
  'Printed music':      'info',
  'Sound recording':    'purple',
  'Visual material':    'warning',
};

function typeColor(type: string) {
  return typeColorMap[type] ?? 'grey-6';
}

const filteredItems = computed(() => {
 return items.value;
});

function resetFilters() {
  selectedType.value = 'vse';
  selectedLanguages.value = [];
  selectedEra.value = 'vse';
  filterSearch.value = '';
  page.value = 1;
}
</script>

<style scoped lang="sass">
@use 'sass:color'

.catalog-header
  background: $primary

.header-kicker
  font-size: 0.72rem
  font-weight: 700
  letter-spacing: 0.14em
  text-transform: uppercase
  color: rgba($paper, 0.6)

.sort-select
  min-width: 170px


.page-body
  max-width: 1280px
  margin: 0 auto

.section-label
  letter-spacing: 0.08em
  text-transform: uppercase
  font-size: 0.72rem
  font-weight: 700


.filter-card
  border-radius: 16px
  background: $paper
  border: 1px solid $divider
  position: sticky
  top: 72px


.item-card
  border-radius: 12px
  overflow: hidden
  background: $paper
  border: 1px solid $divider
  transition: box-shadow 0.2s, transform 0.15s
  &:hover
    box-shadow: 0 6px 24px rgba($dark, 0.12)
    transform: translateY(-3px)

.item-cover
  border-radius: 12px 12px 0 0

.ellipsis-2-lines
  display: -webkit-box
  -webkit-line-clamp: 2
  -webkit-box-orient: vertical
  overflow: hidden
</style>
