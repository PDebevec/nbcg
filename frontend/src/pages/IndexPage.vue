<template>
  <q-page>
    <!-- HERO -->
    <section class="hero-section">
      <div class="hero-overlay" />
      <div class="hero-content q-px-md">
        <div class="row justify-center">
          <div class="col-12 col-sm-10 col-md-8 col-lg-7 text-center">
            <div class="hero-kicker q-mb-sm">National and Central Library</div>
            <h1 class="text-h3 text-weight-bold text-white q-my-sm">
              NBCG Digital Library
            </h1>
            <p class="text-subtitle1 hero-subtitle q-mb-xl">
              Free access to catalogs, digital resources, metadata and archival collections
            </p>

            <!-- SEARCH BAR -->
            <div class="search-bar row no-wrap items-center q-pa-sm">
              <q-select
                v-model="searchType"
                :options="searchTypes"
                dense
                borderless
                emit-value
                map-options
                class="search-type-select q-px-xs"
              />
              <q-separator vertical inset />
              <q-input
                v-model="searchQuery"
                borderless
                dense
                class="col q-px-sm"
                placeholder="Search by title, author, subject …"
                @keyup.enter="doSearch"
              />
              <q-btn
                flat
                round
                dense
                :icon="fullTextSearch ? 'manage_search' : 'text_fields'"
                :color="fullTextSearch ? 'primary' : 'grey-5'"
                size="sm"
                class="q-mr-xs"
                @click="fullTextSearch = !fullTextSearch"
              >
                <q-tooltip>{{ fullTextSearch ? 'Full-text search on' : 'Full-text search off' }}</q-tooltip>
              </q-btn>
              <q-separator vertical inset class="q-mr-xs" />
              <q-btn
                unelevated
                color="secondary"
                text-color="dark"
                icon="search"
                label="Search"
                no-caps
                class="search-btn"
                @click="doSearch"
              />
            </div>

            <!-- QUICK TAGS -->
            <div class="row justify-center q-gutter-sm q-mt-md">
              <q-chip
                v-for="tag in popularTags"
                :key="tag"
                clickable
                outline
                color="white"
                text-color="white"
                size="sm"
                @click="searchQuery = tag"
              >{{ tag }}</q-chip>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- STATS -->
    <div v-if="false" class="stats-bar row no-wrap justify-center">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="stat-item col-6 col-sm-3 text-center q-pa-md"
      >
        <div class="text-h5 text-weight-bold text-library-primary">{{ stat.value }}</div>
        <div class="text-caption text-library-muted">{{ stat.label }}</div>
      </div>
    </div>

    <div class="page-body q-px-md q-py-xl">

      <!-- COLLECTIONS -->
      <section class="q-mb-xl">
        <div v-if="false" class="section-label text-library-muted q-mb-xs">Collections</div>
        <h2 class="text-h5 text-weight-bold text-library-primary q-mt-none q-mb-md">Browse collections</h2>
        <div class="row q-col-gutter-md">
          <div v-for="col in collections" :key="col.type" class="col-6 col-sm-4 col-md-2">
            <q-card
              flat
              bordered
              v-ripple
              class="collection-card text-center q-pa-lg cursor-pointer"
              @click="$router.push('/catalog')"
            >
              <q-icon :name="col.icon" size="36px" :color="col.color" />
              <div class="text-weight-semibold text-library-ink q-mt-sm">{{ col.label }}</div>
              <div class="text-caption text-library-muted q-mt-xs">{{ col.count }}</div>
            </q-card>
          </div>
        </div>
      </section>


      <!-- RECENT + INFO -->
      <div class="row q-col-gutter-lg">
        <div class="col-12 col-md-8">
          <div class="section-label text-library-muted q-mb-xs">Recently updated</div>
          <h2 class="text-h5 text-weight-bold text-library-primary q-mt-none q-mb-md">New entries</h2>
          <q-list bordered separator class="rounded-borders bg-white">
            <q-item
              v-for="entry in recentEntries"
              :key="entry.id"
              clickable
              v-ripple
              class="q-py-sm"
            >
              <q-item-section avatar>
                <q-avatar square size="48px" class="rounded-borders overflow-hidden">
                  <img :src="entry.cover" />
                </q-avatar>
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-semibold text-library-ink">{{ entry.title }}</q-item-label>
                <q-item-label caption>{{ entry.author }} · {{ entry.year }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge outline :color="typeColor(entry.type)" :label="entry.type" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <div class="col-12 col-md-4">
          <div class="info-card q-pa-lg full-height">
            <q-icon name="local_library" color="secondary" size="28px" class="q-mb-sm" />
            <div class="text-h6 text-weight-bold text-library-primary q-mb-sm">About the library</div>
            <p class="text-body2 text-library-ink">
              The NBCG digital library provides open access to catalogs,
              digital resources and metadata for books, journals, manuscripts,
              maps and photographic material of Slovenian cultural heritage.
            </p>
            <q-separator class="q-my-md" color="grey-3" />
            <div class="column q-gutter-sm">
              <div class="row items-center q-gutter-sm">
                <q-icon name="schedule" color="secondary" size="18px" />
                <span class="text-body2 text-library-muted">Mon–Fri: 8:00–20:00</span>
              </div>
              <div class="row items-center q-gutter-sm">
                <q-icon name="location_on" color="secondary" size="18px" />
                <span class="text-body2 text-library-muted">Ljubljana, Slovenia</span>
              </div>
              <div class="row items-center q-gutter-sm">
                <q-icon name="mail" color="secondary" size="18px" />
                <span class="text-body2 text-library-muted">info@nbcg.si</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

const searchQuery = ref('');
const searchType = ref('all');
const fullTextSearch = ref(false);

const searchTypes = [
  { label: 'All', value: 'all' },
  { label: 'Books', value: 'book' },
  { label: 'Journals', value: 'journal' },
  { label: 'Manuscripts', value: 'manuscript' },
];

const popularTags = ['Slovenia', 'History', 'Natural sciences', 'Literature', 'Maps', 'Photography'];

const stats = [
  { label: 'Catalog items', value: '248,400' },
  { label: 'Digital resources', value: '31,200' },
  { label: 'Authority records', value: '19,800' },
  { label: 'Collections', value: '64' },
];

const collections = [
  { type: 'books',        label: 'Books',        icon: 'menu_book',     color: 'primary',   count: '148k items' },
  { type: 'journals',     label: 'Journals',     icon: 'article',       color: 'secondary',  count: '22k items' },
  { type: 'newspapers',   label: 'Newspapers',   icon: 'newspaper',     color: 'info',       count: '18k items' },
  { type: 'manuscripts',  label: 'Manuscripts',  icon: 'history_edu',   color: 'accent',     count: '4k items' },
  { type: 'maps',         label: 'Maps',         icon: 'map',           color: 'positive',   count: '3k items' },
  { type: 'photographs',  label: 'Photographs',  icon: 'photo_library', color: 'warning',    count: '11k items' },
];


const recentEntries = [
  { id: 1, title: 'Yearbook of Matica Slovenska 1874', author: 'Matica Slovenska', year: '1874', type: 'Journal',   cover: 'https://picsum.photos/seed/nbcg07/80/80' },
  { id: 2, title: 'Slovenia in words and images',      author: 'Janez Trdina',    year: '1888', type: 'Book',      cover: 'https://picsum.photos/seed/nbcg08/80/80' },
  { id: 3, title: 'Ethnographic map of the Balkans',   author: 'K. Šmid',         year: '1919', type: 'Map',       cover: 'https://picsum.photos/seed/nbcg09/80/80' },
  { id: 4, title: 'Jutro – daily newspaper',            author: 'Jutro editorial', year: '1930', type: 'Newspaper', cover: 'https://picsum.photos/seed/nbcg10/80/80' },
  { id: 5, title: 'Natural history atlas',             author: 'M. Hrovatin',     year: '1955', type: 'Book',      cover: 'https://picsum.photos/seed/nbcg11/80/80' },
];

const typeColorMap: Record<string, string> = {
  Book:       'primary',
  Journal:    'secondary',
  Newspaper:  'info',
  Manuscript: 'accent',
  Map:        'positive',
  Photograph: 'warning',
};

function typeColor(type: string) {
  return typeColorMap[type] ?? 'grey-6';
}

async function doSearch() {
  console.log('search', searchType.value, searchQuery.value);
  await router.push('/catalog');
}
</script>

<style scoped lang="sass">
@use 'sass:color'

.hero-section
  position: relative
  background-image: url('https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1600&q=80')
  background-size: cover
  background-position: center 30%
  min-height: 380px
  overflow: hidden

.hero-overlay
  position: absolute
  inset: 0
  background: linear-gradient(145deg, rgba($primary, 0.82) 0%, rgba($dark, 0.72) 100%)

.hero-content
  position: relative
  z-index: 1
  padding-top: 72px
  padding-bottom: 88px

.hero-kicker
  font-size: 0.72rem
  font-weight: 700
  letter-spacing: 0.14em
  text-transform: uppercase
  color: rgba($paper, 0.6)

.hero-subtitle
  color: rgba($paper, 0.72)

.search-bar
  background: #fff
  border-radius: 12px
  box-shadow: 0 8px 36px rgba($dark, 0.28)
  max-width: 680px
  margin: 0 auto

.search-type-select
  min-width: 110px

.search-btn
  border-radius: 8px
  flex-shrink: 0

.stats-bar
  background: $paper
  border-bottom: 1px solid $divider
  flex-wrap: wrap

.stat-item
  border-right: 1px solid $divider
  &:last-child
    border-right: none


.page-body
  max-width: 1280px
  margin: 0 auto

.section-label
  letter-spacing: 0.08em
  text-transform: uppercase
  font-size: 0.72rem
  font-weight: 700


.collection-card
  border-radius: 16px
  border: 1px solid $divider
  background: $paper
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.15s
  &:hover
    border-color: $secondary
    box-shadow: 0 4px 18px rgba($dark, 0.1)
    transform: translateY(-2px)


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


.info-card
  background: linear-gradient(180deg, color.adjust($paper, $lightness: 2%), $paper)
  border: 1px solid $divider
  border-radius: 16px
  box-shadow: 0 4px 20px rgba($dark, 0.06)
</style>
