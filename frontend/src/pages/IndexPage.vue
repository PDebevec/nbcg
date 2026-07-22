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
          <div class="search-bar bg-white row no-wrap items-center">
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
        <h2 class="text-h5 text-weight-bold text-primary text-center q-mt-none q-mb-sm">{{ t('index.collectionsTitle') }}</h2>
        <q-separator color="secondary" size="3px" class="section-separator q-mb-md" />
        <div class="row q-col-gutter-md">
          <div v-for="col in collections" :key="col.key" class="col-6 col-sm-3">
            <q-card
              flat
              bordered
              v-ripple
              class="collection-card bg-white text-center q-pa-lg cursor-pointer full-height"
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
        <h2 class="text-h5 text-weight-bold text-primary text-center q-mt-none q-mb-sm">{{ t('index.thematicTitle') }}</h2>
        <q-separator color="secondary" size="3px" class="section-separator q-mb-md" />
        <div
          class="thematic-carousel"
          @mouseenter="thematicPaused = true"
          @mouseleave="thematicPaused = false"
        >
          <q-card
            v-for="(tc, i) in thematicCollections"
            :key="tc.key"
            flat
            bordered
            class="thematic-slide bg-white"
            :class="{ 'is-active': i === thematicIndex }"
            :style="thematicStyle(i)"
            @click="goToThematic(i)"
          >
            <q-img :src="tc.image" :ratio="1" class="thematic-card-img">
              <div class="absolute-bottom thematic-img-overlay text-center">
                <div class="thematic-slide-title text-white text-weight-bold">{{ t(`index.thematic.${tc.key}.title`) }}</div>
              </div>
            </q-img>
            <q-card-section
              v-if="i === thematicIndex"
              class="thematic-desc q-pa-md text-center"
            >
              <q-separator color="secondary" size="2px" class="desc-accent q-mb-sm" />
              <div class="text-caption text-library-muted">{{ t(`index.thematic.${tc.key}.description`) }}</div>
            </q-card-section>
          </q-card>
        </div>
      </section>

      <!-- NEWEST ADDITIONS -->
      <section v-if="newestItems.length" class="q-mb-xl">
        <h2 class="text-h5 text-weight-bold text-primary q-mt-none q-mb-sm">{{ t('index.newestTitle') }}</h2>
        <q-separator color="secondary" size="3px" class="section-separator section-separator--left q-mb-md" />
        <div class="row q-col-gutter-md">
          <div v-for="item in newestItems" :key="item.id" class="col-12 col-sm-6">
            <q-card flat v-ripple class="newest-card bg-white cursor-pointer" @click="openRecord(item)">
              <div class="row no-wrap full-height">
                <q-img :src="coverUrl(item)" fit="cover" class="newest-cover" />
                <div class="col q-pa-md column justify-between">
                  <div>
                    <div
                      v-if="item.source.metadata.materialType?.en"
                      class="newest-type text-uppercase text-weight-bold"
                      :class="`text-${typeColor(item.source.metadata.materialType.en)}`"
                    >{{ item.source.metadata.materialType.en }}</div>
                    <div class="text-weight-bold text-library-ink ellipsis-2-lines q-mt-xs">{{ item.source.metadata.title }}</div>
                    <div class="text-caption text-library-muted ellipsis q-mt-xs">{{ item.source.metadata.firstResponsibility }}</div>
                  </div>
                  <div class="row items-center justify-between q-mt-sm">
                    <span class="text-caption text-library-muted">{{ item.source.metadata.publicationDate1 }}</span>
                    <q-icon name="arrow_forward" size="18px" color="primary" class="newest-arrow" />
                  </div>
                </div>
              </div>
            </q-card>
          </div>
        </div>
      </section>

      <!-- ABOUT -->
      <q-card flat class="about-section q-pa-xl">
        <div class="text-caption text-uppercase text-weight-bold text-library-muted q-mb-xs">{{ t('index.aboutKicker') }}</div>
        <h2 class="text-h5 text-weight-bold text-primary q-mt-none q-mb-md">
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
      </q-card>

    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import imageStock from 'src/assets/image-stock.jpg';
import { searchItems, type SearchHit } from 'src/api/search';

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
      transform: 'translate(-50%, -50%) perspective(1200px) scale(0.4)',
      opacity: '0',
      pointerEvents: 'none' as const,
      zIndex: '0',
    };
  }
  const shift = d * 58;
  const scale = abs === 0 ? 1 : abs === 1 ? 0.86 : 0.7;
  const tilt = d === 0 ? 0 : d > 0 ? -9 : 9;
  return {
    transform: `translate(calc(-50% + ${shift}%), -50%) perspective(1200px) rotateY(${tilt}deg) scale(${scale})`,
    opacity: abs === 0 ? '1' : abs === 1 ? '0.95' : '0.8',
    filter: abs === 0 ? 'none' : 'saturate(0.6) brightness(0.94)',
    zIndex: String(10 - abs * 3),
  };
}

function goToThematic(i: number) {
  thematicIndex.value = i;
}

// Auto-advance, paused while the pointer is over the carousel
const thematicPaused = ref(false);
let thematicTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  thematicTimer = setInterval(() => {
    if (!thematicPaused.value) {
      thematicIndex.value = (thematicIndex.value + 1) % thematicCollections.length;
    }
  }, 5000);
});

onBeforeUnmount(() => {
  clearInterval(thematicTimer);
});

// Newest additions
const newestItems = ref<SearchHit[]>([]);

onMounted(async () => {
  try {
    const result = await searchItems({ type: 'records', sort: 'newest', limit: 4 });
    newestItems.value = result.hits;
  } catch {
    newestItems.value = [];
  }
});

function openRecord(item: SearchHit) {
  void router.push(`/catalog/${item.id}`);
}

function coverUrl(item: SearchHit): string {
  const img = item.source.file_attachments?.find((f) => f.fileType === 'IMAGE');
  return img ? `/api/files/${img.id}/download` : imageStock;
}

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

.section-separator
  width: 80px
  border-radius: 2px
  margin-left: auto
  margin-right: auto
  &--left
    margin-left: 0

.collection-card
  border-radius: 16px
  border: 1px solid $divider
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.15s
  &:hover
    border-color: $secondary
    box-shadow: 0 4px 18px rgba($dark, 0.1)
    transform: translateY(-2px)

.thematic-carousel
  position: relative
  height: 560px
  overflow: hidden
  // Fade the far edges so half-hidden cards dissolve into the page
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 7%, #000 93%, transparent 100%)
  mask-image: linear-gradient(90deg, transparent 0%, #000 7%, #000 93%, transparent 100%)

.thematic-slide
  position: absolute
  top: 50%
  left: 50%
  width: min(420px, 72vw)
  border-radius: 14px
  overflow: hidden
  border: 1px solid $divider
  cursor: pointer
  will-change: transform, opacity
  transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease, filter 0.5s ease, box-shadow 0.3s ease, border-color 0.3s ease
  &:not(.is-active):hover
    box-shadow: 0 6px 24px rgba($dark, 0.18)
  &.is-active
    cursor: default
    border-color: rgba($secondary, 0.35)
    box-shadow: 0 18px 48px rgba($primary, 0.22)

.thematic-card-img
  display: block

.thematic-slide .thematic-img-overlay
  background: linear-gradient(180deg, rgba($dark, 0) 0%, rgba($dark, 0.55) 45%, rgba($dark, 0.82) 100%)
  padding: 28px 16px 12px

.thematic-slide-title
  font-size: 1.05rem
  letter-spacing: 0.01em
  text-shadow: 0 1px 8px rgba($dark, 0.6)

.thematic-desc
  animation: thematic-fade-up 0.45s ease both

.desc-accent
  width: 36px
  border-radius: 2px
  margin: 0 auto

@keyframes thematic-fade-up
  from
    opacity: 0
    transform: translateY(8px)
  to
    opacity: 1
    transform: translateY(0)

.newest-card
  height: 164px
  border-radius: 14px
  overflow: hidden
  border: 1px solid $divider
  transition: box-shadow 0.25s ease, transform 0.2s ease, border-color 0.25s ease
  .newest-arrow
    transition: transform 0.25s ease
  &:hover
    border-color: rgba($primary, 0.35)
    box-shadow: 0 10px 32px rgba($primary, 0.16)
    transform: translateY(-3px)
    .newest-arrow
      transform: translateX(4px)

.newest-cover
  width: 110px
  min-width: 110px
  height: 100%

.newest-type
  font-size: 0.68rem
  letter-spacing: 0.08em

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
