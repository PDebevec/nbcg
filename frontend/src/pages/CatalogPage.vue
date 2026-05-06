<template>
  <q-page>
    <!-- PAGE HEADER -->
    <div class="catalog-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="row items-center justify-between q-px-md">
          <div>
            <div class="header-kicker q-mb-xs">Digital Library</div>
            <h1 class="text-h4 text-weight-bold text-white q-my-none">Item catalog</h1>
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
              placeholder="Search within catalog …"
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
                  <q-tooltip>{{ fullTextSearch ? 'Full-text search on' : 'Full-text search off' }}</q-tooltip>
                </q-btn>
              </template>
            </q-input>

            <!-- TYPE -->
            <div class="section-label text-library-muted q-mb-sm">Item type</div>
            <q-option-group
              v-model="selectedType"
              :options="typeOptions"
              color="primary" dense
              class="q-mb-md"
            />

            <q-separator color="grey-3" class="q-my-md" />

            <!-- LANGUAGE -->
            <div class="section-label text-library-muted q-mb-sm">Language</div>
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
            <div class="section-label text-library-muted q-mb-sm">Period</div>
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
              label="Reset filters"
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
              Showing
              <strong class="text-library-ink">{{ filteredItems.length }}</strong>
              of {{ allItems.length }} items
            </div>
            <q-select
              v-model="sortBy"
              :options="sortOptions"
              outlined dense emit-value map-options
              label="Sort by"
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
              <q-card flat v-ripple class="item-card cursor-pointer">
                <q-img :src="item.cover" :ratio="2/3" class="item-cover">
                  <div class="absolute-top-right q-pa-xs">
                    <q-badge :color="typeColor(item.type)" :label="item.type" />
                  </div>
                </q-img>
                <q-card-section class="q-pa-sm">
                  <div class="text-weight-bold text-caption text-library-ink ellipsis-2-lines">{{ item.title }}</div>
                  <div class="text-caption text-library-muted q-mt-xs ellipsis">{{ item.author }}</div>
                  <div class="row items-center justify-between q-mt-xs">
                    <span class="text-caption text-library-muted">{{ item.year }}</span>
                    <q-btn flat dense no-caps color="primary" label="View" size="sm" />
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
            >
              <q-item-section avatar>
                <q-avatar square size="58px" class="rounded-borders overflow-hidden">
                  <img :src="item.cover" />
                </q-avatar>
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-semibold text-library-ink">{{ item.title }}</q-item-label>
                <q-item-label caption>{{ item.author }}</q-item-label>
                <q-item-label caption>{{ item.publisher }} · {{ item.year }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="column items-end q-gutter-xs">
                  <q-badge outline :color="typeColor(item.type)" :label="item.type" />
                  <q-badge outline color="grey-5" text-color="grey-7" :label="item.language" />
                  <q-btn flat dense no-caps color="primary" label="Details" size="xs" class="q-mt-xs" />
                </div>
              </q-item-section>
            </q-item>
          </q-list>

          <!-- PAGINATION -->
          <div class="row justify-center q-mt-lg">
            <q-pagination
              v-model="page"
              :max="8"
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
import { ref, computed } from 'vue';

const viewMode = ref<'grid' | 'list'>('list');
const filterSearch = ref('');
const fullTextSearch = ref(false);
const selectedType = ref('vse');
const selectedLanguages = ref<string[]>(['sl']);
const selectedEra = ref('vse');
const sortBy = ref('relevance');
const page = ref(1);

const typeOptions = [
  { label: 'All types',      value: 'vse' },
  { label: 'Books',          value: 'Book' },
  { label: 'Journals',       value: 'Journal' },
  { label: 'Newspapers',     value: 'Newspaper' },
  { label: 'Manuscripts',    value: 'Manuscript' },
  { label: 'Maps',           value: 'Map' },
  { label: 'Photographs',    value: 'Photograph' },
  { label: 'Audio records',  value: 'Audio record' },
];

const languages = [
  { label: 'Slovenian', value: 'sl' },
  { label: 'German',    value: 'de' },
  { label: 'Latin',     value: 'la' },
  { label: 'Italian',   value: 'it' },
  { label: 'Croatian',  value: 'hr' },
];

const eras = [
  { label: 'All',       value: 'vse' },
  { label: 'Pre-1800',  value: 'do1800' },
  { label: '1800–1900', value: '19st' },
  { label: '1900–1950', value: '1900-1950' },
  { label: '1950–2000', value: '1950-2000' },
  { label: 'Post-2000', value: 'po2000' },
];

const sortOptions = [
  { label: 'Relevance',       value: 'relevance' },
  { label: 'Title A–Z',       value: 'title-asc' },
  { label: 'Year (oldest)',   value: 'year-asc' },
  { label: 'Year (newest)',   value: 'year-desc' },
];

interface CatalogItem {
  id: number;
  title: string;
  author: string;
  publisher: string;
  year: string;
  type: string;
  language: string;
  cover: string;
}

const allItems: CatalogItem[] = [
  { id:  1, title: 'Collected Poems',                          author: 'France Prešeren',          publisher: 'Blaž Crobath',         year: '1847', type: 'Book',         language: 'sl', cover: 'https://picsum.photos/seed/cat01/200/300' },
  { id:  2, title: 'History of the Slovenian nation',          author: 'Josip Mal',                publisher: 'Učiteljska tiskarna',   year: '1928', type: 'Book',         language: 'sl', cover: 'https://picsum.photos/seed/cat02/200/300' },
  { id:  3, title: 'Alpine Bulletin',                          author: 'Planinska zveza Slovenije', publisher: 'PZS',                  year: '1912', type: 'Journal',      language: 'sl', cover: 'https://picsum.photos/seed/cat03/200/300' },
  { id:  4, title: 'Ljubljanski zvon',                         author: 'Fran Levstik et al.',      publisher: 'Kleinmayr & Bamberg',  year: '1881', type: 'Journal',      language: 'sl', cover: 'https://picsum.photos/seed/cat04/200/300' },
  { id:  5, title: 'Jutro – daily newspaper',                  author: 'Jutro editorial',          publisher: 'Jutro d.o.o.',         year: '1930', type: 'Newspaper',    language: 'sl', cover: 'https://picsum.photos/seed/cat05/200/300' },
  { id:  6, title: 'Slovenec – political newspaper',          author: 'Various authors',          publisher: 'Katoliška tiskarna',   year: '1873', type: 'Newspaper',    language: 'sl', cover: 'https://picsum.photos/seed/cat06/200/300' },
  { id:  7, title: 'Triglav Manuscript',                       author: 'Unknown',                  publisher: '–',                     year: '1780', type: 'Manuscript',   language: 'sl', cover: 'https://picsum.photos/seed/cat07/200/300' },
  { id:  8, title: 'Codex Aquileiensis',                       author: 'Anonymous',                publisher: '–',                     year: '1150', type: 'Manuscript',   language: 'la', cover: 'https://picsum.photos/seed/cat08/200/300' },
  { id:  9, title: 'Map of the Carniola Province',             author: 'J. Lavtižar',              publisher: 'Državna tiskarna',      year: '1901', type: 'Map',          language: 'sl', cover: 'https://picsum.photos/seed/cat09/200/300' },
  { id: 10, title: 'Ethnographic map of the Balkans',          author: 'K. Šmid',                  publisher: 'Geografski inštitut',  year: '1919', type: 'Map',          language: 'de', cover: 'https://picsum.photos/seed/cat10/200/300' },
  { id: 11, title: 'Kobal photo archive – Ljubljana 1920',   author: 'Foto Kobal',               publisher: '–',                     year: '1920', type: 'Photograph',   language: 'sl', cover: 'https://picsum.photos/seed/cat11/200/300' },
  { id: 12, title: 'Portrait of Valentin Vodnik',              author: 'Janez Wolf',               publisher: '–',                     year: '1818', type: 'Photograph',   language: 'sl', cover: 'https://picsum.photos/seed/cat12/200/300' },
  { id: 13, title: 'Natural history atlas',                    author: 'M. Hrovatin',              publisher: 'DZS',                  year: '1955', type: 'Book',         language: 'sl', cover: 'https://picsum.photos/seed/cat13/200/300' },
  { id: 14, title: 'Botanisches Handbuch Krain',               author: 'H. Freyer',                publisher: 'Eger',                 year: '1838', type: 'Book',         language: 'de', cover: 'https://picsum.photos/seed/cat14/200/300' },
  { id: 15, title: 'Yearbook of Matica Slovenska 1874',        author: 'Matica Slovenska',         publisher: 'Matica Slovenska',     year: '1874', type: 'Journal',      language: 'sl', cover: 'https://picsum.photos/seed/cat15/200/300' },
  { id: 16, title: 'Folk songs recordings (LP)',               author: 'ZKP RTV Slovenija',        publisher: 'RTV',                  year: '1968', type: 'Audio record',  language: 'sl', cover: 'https://picsum.photos/seed/cat16/200/300' },
];

const typeColorMap: Record<string, string> = {
  Book:         'primary',
  Journal:      'secondary',
  Newspaper:    'info',
  Manuscript:   'accent',
  Map:          'positive',
  Photograph:   'warning',
  'Audio record': 'purple',
};

function typeColor(type: string) {
  return typeColorMap[type] ?? 'grey-6';
}

const filteredItems = computed(() => {
  let items = allItems;
  if (selectedType.value !== 'vse') {
    items = items.filter((i) => i.type === selectedType.value);
  }
  if (selectedLanguages.value.length > 0) {
    items = items.filter((i) => selectedLanguages.value.includes(i.language));
  }
  if (filterSearch.value.trim()) {
    const q = filterSearch.value.toLowerCase();
    items = items.filter(
      (i) => i.title.toLowerCase().includes(q) || i.author.toLowerCase().includes(q),
    );
  }
  return items;
});

function resetFilters() {
  selectedType.value = 'vse';
  selectedLanguages.value = [];
  selectedEra.value = 'vse';
  filterSearch.value = '';
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
