<template>
  <q-page>
    <!-- BANNER (placeholder for future banner image) -->
    <section class="banner-section">
      <div class="banner-overlay" />
    </section>

    <!-- SEARCH -->
    <section class="search-section q-px-md">
      <div class="row justify-center">
        <div class="col-12 col-md-11 col-lg-10">
          <!-- SEARCH BAR -->
          <div class="search-bar row no-wrap items-center">
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
              :placeholder="t('index.searchPlaceholder')"
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
              <q-tooltip>{{ fullTextSearch ? t('index.fullTextOn') : t('index.fullTextOff') }}</q-tooltip>
            </q-btn>
            <q-separator vertical inset class="q-mr-xs" />
            <q-btn
              unelevated
              color="secondary"
              text-color="white"
              icon="search"
              :label="t('common.search')"
              no-caps
              class="search-btn"
              @click="doSearch"
            />
          </div>
        </div>
      </div>
    </section>

    <div class="page-body q-px-md q-py-xl">

      <!-- COLLECTIONS -->
      <section class="q-mb-xl">
        <h2 class="text-h5 text-weight-bold text-library-primary q-mt-none q-mb-md">{{ t('index.collectionsTitle') }}</h2>
        <div class="row q-col-gutter-md">
          <div v-for="col in collections" :key="col.key" class="col-6 col-sm-3">
            <q-card
              flat
              bordered
              v-ripple
              class="collection-card text-center q-pa-lg cursor-pointer full-height"
              @click="openCollection(col)"
            >
              <q-icon :name="col.icon" size="40px" color="primary" />
              <div class="text-weight-semibold text-library-ink q-mt-sm">{{ t(`index.collections.${col.key}`) }}</div>
            </q-card>
          </div>
        </div>
      </section>

      <!-- THEMATIC COLLECTIONS -->
      <section class="q-mb-xl">
        <h2 class="text-h5 text-weight-bold text-library-primary q-mt-none q-mb-md">{{ t('index.thematicTitle') }}</h2>
        <div class="thematic-carousel">
          <q-card
            v-for="(tc, i) in thematicCollections"
            :key="tc.key"
            flat
            bordered
            class="thematic-slide"
            :class="{ 'is-active': i === thematicIndex }"
            :style="thematicStyle(i)"
            @click="goToThematic(i)"
          >
            <q-img :src="tc.image" :ratio="4/3" class="thematic-card-img" />
            <q-card-section class="q-pa-sm text-center">
              <div class="text-weight-semibold text-library-ink text-body2">{{ t(`index.thematic.${tc.key}.title`) }}</div>
              <div
                v-if="i === thematicIndex"
                class="text-caption text-library-muted q-mt-xs"
              >{{ t(`index.thematic.${tc.key}.description`) }}</div>
            </q-card-section>
          </q-card>
        </div>
      </section>

      <!-- ABOUT -->
      <section class="about-section q-pa-xl">
        <div class="section-label text-library-muted q-mb-xs">{{ t('index.aboutKicker') }}</div>
        <h2 class="text-h5 text-weight-bold text-library-primary q-mt-none q-mb-md">
          {{ t('index.aboutTitle') }}
        </h2>
        <div class="about-text text-library-ink">
          <p>{{ t('index.aboutP1') }}</p>
          <p>{{ t('index.aboutP2') }}</p>
          <p>{{ t('index.aboutP3') }}</p>
          <p>{{ t('index.aboutP4') }}</p>
        </div>
        <q-btn
          flat
          no-caps
          color="primary"
          :label="t('common.readMore')"
          icon-right="arrow_forward"
          to="/o-nama"
          class="q-mt-sm"
        />
      </section>

    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

const router = useRouter();
const { t } = useI18n();

const searchQuery = ref('');
const searchType = ref('all');
const fullTextSearch = ref(false);

const searchTypes = computed(() => [
  { label: t('index.searchTypes.all'), value: 'all' },
  { label: t('index.searchTypes.books'), value: 'Monograph' },
  { label: t('index.searchTypes.periodicals'), value: 'Serial publication' },
  { label: t('index.searchTypes.manuscripts'), value: 'Manuscript' },
]);

interface Collection {
  key: string;
  icon: string;
  materialType?: string;
}

const collections: Collection[] = [
  { key: 'books',        icon: 'menu_book',            materialType: 'Monograph' },
  { key: 'newspapers',   icon: 'newspaper',            materialType: 'Serial publication' },
  { key: 'magazines',    icon: 'auto_stories',         materialType: 'Serial publication' },
  { key: 'manuscripts',  icon: 'history_edu',          materialType: 'Manuscript' },
  { key: 'maps',         icon: 'map',                  materialType: 'Map' },
  { key: 'posters',      icon: 'palette' },
  { key: 'photographs',  icon: 'photo_library' },
  { key: 'audiovisual',  icon: 'music_video',          materialType: 'Sound recording' },
];

function openCollection(col: Collection) {
  void router.push({
    path: '/catalog',
    ...(col.materialType ? { query: { materialType: col.materialType } } : {}),
  });
}

// Placeholder thumbnails until curated collection cover images are available
interface ThematicCollection {
  key: string;
  image: string;
}

const thematicCollections: ThematicCollection[] = [
  { key: 'oldRareBooks',    image: 'https://picsum.photos/seed/nbcg-old-rare-books/480/360' },
  { key: 'montenegrinPress', image: 'https://picsum.photos/seed/nbcg-montenegrin-press/480/360' },
  { key: 'cetinjeHeritage', image: 'https://picsum.photos/seed/nbcg-cetinje-heritage/480/360' },
  { key: 'cartography',    image: 'https://picsum.photos/seed/nbcg-cartography/480/360' },
  { key: 'artAndPosters',  image: 'https://picsum.photos/seed/nbcg-art-posters/480/360' },
  { key: 'folkHeritage',   image: 'https://picsum.photos/seed/nbcg-folk-heritage/480/360' },
];

const thematicIndex = ref(0);

// Signed distance from the active slide, wrapping around the ends
function thematicOffset(i: number) {
  const n = thematicCollections.length;
  let d = i - thematicIndex.value;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

function thematicStyle(i: number) {
  const d = thematicOffset(i);
  const abs = Math.abs(d);
  if (abs > 2) {
    return {
      transform: 'translate(-50%, -50%) scale(0.4)',
      opacity: '0',
      pointerEvents: 'none' as const,
      zIndex: '0',
    };
  }
  const shift = d * 48;
  const scale = abs === 0 ? 1 : abs === 1 ? 0.68 : 0.5;
  return {
    transform: `translate(calc(-50% + ${shift}%), -50%) scale(${scale})`,
    opacity: abs === 0 ? '1' : abs === 1 ? '0.95' : '0.85',
    zIndex: String(10 - abs * 3),
  };
}

function goToThematic(i: number) {
  thematicIndex.value = i;
}

async function doSearch() {
  await router.push({
    path: '/catalog',
    query: {
      ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {}),
      ...(searchType.value !== 'all' ? { materialType: searchType.value } : {}),
      ...(fullTextSearch.value ? { fullText: '1' } : {}),
    },
  });
}
</script>

<style scoped lang="sass">
@use 'sass:color'

// Placeholder banner — to be replaced with a real banner image later
.banner-section
  position: relative
  background-image: url('https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1600&q=80')
  background-size: cover
  background-position: center 30%
  min-height: 280px
  overflow: hidden

.banner-overlay
  position: absolute
  inset: 0
  background: linear-gradient(145deg, rgba($primary, 0.82) 0%, rgba($dark, 0.72) 100%)

.search-section
  margin-top: -44px
  margin-bottom: 8px
  position: relative
  z-index: 1

.search-bar
  background: #fff
  border-radius: 14px
  box-shadow: 0 12px 48px rgba($dark, 0.32)
  max-width: 1080px
  margin: 0 auto
  padding: 12px 14px
  font-size: 1.05rem

.search-type-select
  min-width: 110px

.search-btn
  border-radius: 8px
  flex-shrink: 0

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
  background: #ffffff
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.15s
  &:hover
    border-color: $secondary
    box-shadow: 0 4px 18px rgba($dark, 0.1)
    transform: translateY(-2px)

.thematic-carousel
  position: relative
  height: 480px
  overflow: hidden

.thematic-slide
  position: absolute
  top: 50%
  left: 50%
  width: min(440px, 74vw)
  border-radius: 12px
  overflow: hidden
  border: 1px solid $divider
  background: #ffffff
  cursor: pointer
  transition: transform 0.35s ease, opacity 0.35s ease, box-shadow 0.2s
  &:not(.is-active):hover
    box-shadow: 0 4px 18px rgba($dark, 0.15)
  &.is-active
    cursor: default
    box-shadow: 0 8px 32px rgba($dark, 0.18)

.thematic-card-img
  display: block

.about-section
  background: linear-gradient(180deg, color.adjust($paper, $lightness: 2%), $paper)
  border: 1px solid $divider
  border-radius: 16px
  box-shadow: 0 4px 20px rgba($dark, 0.06)

.about-text
  p
    font-size: 0.95rem
    line-height: 1.7
    margin-bottom: 1rem
</style>
