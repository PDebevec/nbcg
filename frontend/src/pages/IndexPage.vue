<template>
  <q-page class="home">
    <!-- HERO: search first (design canvas "NBCG Public Redesign", home board) -->
    <section class="hero" :aria-label="t('common.search')">
      <div class="hero__inner">
        <h1 class="hero__title">{{ t('index.heroTitle1') }}<br />{{ t('index.heroTitle2') }}</h1>

        <form class="hero__search" role="search" @submit.prevent="doSearch">
          <q-select
            v-model="searchType"
            :options="searchTypes"
            borderless
            emit-value
            map-options
            dropdown-icon="o_expand_more"
            class="hero__type"
            :aria-label="t('advanced.materialType')"
          />
          <q-input
            v-model="searchQuery"
            borderless
            class="hero__input"
            :placeholder="t('index.searchPlaceholder')"
            :aria-label="t('common.search')"
          />
          <q-btn
            type="submit"
            unelevated
            no-caps
            color="secondary"
            icon="o_search"
            :label="t('common.search')"
            class="hero__submit"
          />
        </form>

        <div class="hero__options">
          <q-checkbox
            v-model="fullTextSearch"
            dense
            color="secondary"
            keep-color
            :label="t('index.fullText')"
            class="hero__fulltext"
          />
          <router-link to="/napredna-pretraga" class="hero__link">
            {{ t('nav.advancedSearch') }}
            <q-icon name="o_arrow_forward" size="16px" />
          </router-link>
        </div>

        <div class="hero__chips">
          <span class="hero__chips-label">{{ t('index.oftenSearched') }}</span>
          <q-btn
            v-for="term in OFTEN_SEARCHED"
            :key="term"
            outline
            rounded
            dense
            no-caps
            :label="term"
            :to="{ path: '/catalog', query: { q: term } }"
            class="hero__chip"
          />
        </div>

        <div class="hero__facts">
          <template v-if="recordTotal !== null">{{ t('index.factsRecords', { count: formatCount(recordTotal) }) }} · </template>
          {{ t('index.factsTitles') }} · {{ t('index.factsFree') }}
        </div>
      </div>
    </section>

    <!-- COLLECTIONS -->
    <section class="home__section site-container" aria-labelledby="collections-h">
      <div class="sec-head">
        <div>
          <div class="sec-head__eyebrow">{{ t('index.browseKicker') }}</div>
          <h2 id="collections-h" class="sec-head__title">{{ t('index.collectionsTitle') }}</h2>
        </div>
        <router-link to="/catalog" class="sec-head__link">
          {{ t('index.openCatalog') }}
          <q-icon name="o_arrow_forward" size="16px" />
        </router-link>
      </div>

      <div class="tiles">
        <router-link
          v-for="col in COLLECTIONS"
          :key="col.key"
          :to="collectionRoute(col)"
          class="tile"
        >
          <span class="tile__icon"><q-icon :name="col.icon" size="22px" /></span>
          <span class="tile__text">
            <span class="tile__name">{{ t(`index.collections.${col.key}`) }}</span>
            <span class="tile__count">{{ typeCounts ? t('index.records', collectionCount(col)) : '&nbsp;' }}</span>
          </span>
        </router-link>
      </div>
    </section>

    <!-- THEMES: static placeholders until curated collections exist -->
    <section class="home__section site-container" aria-labelledby="themes-h">
      <div class="sec-head">
        <div>
          <div class="sec-head__eyebrow">{{ t('index.curatedKicker') }}</div>
          <h2 id="themes-h" class="sec-head__title">{{ t('index.thematicTitle') }}</h2>
          <p class="sec-head__lead">{{ t('index.thematicLead') }}</p>
        </div>
      </div>

      <div class="mosaic">
        <router-link
          v-for="theme in THEMES"
          :key="theme.key"
          to="/catalog"
          class="mosaic__tile"
          :class="[`mosaic__tile--${theme.size}`, { 'mosaic__tile--image': theme.image }]"
          :style="theme.image ? undefined : { background: theme.color }"
        >
          <img v-if="theme.image" :src="theme.image" alt="" class="mosaic__img" />
          <span v-if="theme.image" class="mosaic__plate" :class="{ 'mosaic__plate--lg': theme.size === 'large' }">
            <span v-if="theme.size === 'large'" class="mosaic__badge">{{ t('index.mostVisited') }}</span>
            <span class="mosaic__name">{{ t(`index.thematic.${theme.key}.title`) }}</span>
          </span>
          <template v-else>
            <span class="mosaic__body">
              <span class="mosaic__name">{{ t(`index.thematic.${theme.key}.title`) }}</span>
              <span v-if="theme.size === 'wide'" class="mosaic__desc">{{ t(`index.thematic.${theme.key}.description`) }}</span>
            </span>
            <span class="mosaic__foot"><q-icon name="o_arrow_forward" size="16px" /></span>
          </template>
        </router-link>
      </div>
    </section>

    <!-- RECENTLY ADDED -->
    <section v-if="newestItems.length" class="home__section site-container" aria-labelledby="newest-h">
      <div class="sec-head">
        <div>
          <div class="sec-head__eyebrow">{{ t('index.newKicker') }}</div>
          <h2 id="newest-h" class="sec-head__title">{{ t('index.newestTitle') }}</h2>
        </div>
        <router-link :to="{ path: '/catalog', query: { sort: 'newest' } }" class="sec-head__link">
          {{ t('index.seeAllNew') }}
          <q-icon name="o_arrow_forward" size="16px" />
        </router-link>
      </div>

      <div class="newest">
        <router-link v-for="item in newestItems" :key="item.id" :to="`/catalog/${item.id}`" class="newest__card">
          <span class="newest__cover">
            <img v-if="coverUrl(item)" :src="coverUrl(item)" alt="" loading="lazy" />
            <q-icon v-else :name="typeIcon(item.source.metadata.materialType)" size="28px" class="newest__cover-icon" />
          </span>
          <span class="newest__text">
            <span class="newest__meta">
              <q-badge
                v-if="item.source.metadata.materialType"
                class="badge-soft newest__type"
                :class="`badge-soft--${typeTone(item.source.metadata.materialType)}`"
              >
                {{ codeLabel(item.source.metadata.materialType) }}
              </q-badge>
              <span v-if="item.source.metadata.publicationDate1" class="newest__year">{{ item.source.metadata.publicationDate1 }}</span>
            </span>
            <span class="newest__title">{{ item.source.metadata.title }}</span>
            <span class="newest__creator">{{ creatorLine(item) }}</span>
          </span>
          <q-icon name="o_arrow_forward" size="16px" class="newest__arrow" />
        </router-link>
      </div>
    </section>

    <!-- ABOUT -->
    <section class="home__section home__section--last site-container" aria-labelledby="about-h">
      <div class="about">
        <div class="about__copy">
          <div class="sec-head__eyebrow">{{ t('index.aboutKicker') }}</div>
          <h2 id="about-h" class="sec-head__title">{{ t('index.aboutTitle') }}</h2>
          <p>{{ t('index.aboutShort1') }}</p>
          <p>{{ t('index.aboutShort2') }}</p>
          <q-btn
            outline
            no-caps
            color="primary"
            :label="t('index.aboutMore')"
            icon-right="o_arrow_forward"
            to="/o-nama"
            class="about__more"
          />
        </div>
        <ul class="about__facts">
          <li v-for="fact in ABOUT_FACTS" :key="fact.key" class="about__fact">
            <span class="about__fact-icon"><q-icon :name="fact.icon" size="20px" /></span>
            <span class="about__fact-text">
              <span class="about__fact-title">{{ t(`index.facts.${fact.key}Title`) }}</span>
              <span class="about__fact-desc">{{ t(`index.facts.${fact.key}Text`) }}</span>
            </span>
          </li>
        </ul>
      </div>
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { searchItems, suggestValues, type ResolvedCode, type SearchHit } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';

const router = useRouter();
const { t, locale } = useI18n();
const { codeLabel } = useCodeLabel();

// ── Hero search ────────────────────────────────────────────────────────────
const searchQuery = ref('');
const searchType = ref('');
const fullTextSearch = ref(false);

// Values are `materialType` filter lists (the filter matches the English label;
// see docs/frontend/plans/search-filters.md, W2)
const searchTypes = computed(() => [
  { label: t('index.searchTypes.all'), value: '' },
  { label: t('index.searchTypes.books'), value: 'Book' },
  { label: t('index.searchTypes.periodicals'), value: 'Journal / Serial' },
  { label: t('index.searchTypes.maps'), value: 'Printed map,Manuscript map,Map serial' },
]);

// Placeholder terms until search statistics exist
const OFTEN_SEARCHED = ['Glas Crnogorca', 'Njegoš', 'Cetinje', 'Boka Kotorska', 'Grlica 1835'];

async function doSearch() {
  await router.push({
    path: '/catalog',
    query: {
      ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {}),
      ...(searchType.value ? { materialType: searchType.value } : {}),
      ...(fullTextSearch.value ? { fullText: '1' } : {}),
    },
  });
}

// ── Collections ────────────────────────────────────────────────────────────
interface Collection {
  key: string;
  icon: string;
  /** English material-type labels the tile filters by; empty = the whole catalogue */
  types: string[];
}

// Posters and photographs have no material type of their own; Graphic is the closest.
const COLLECTIONS: Collection[] = [
  { key: 'books', icon: 'o_menu_book', types: ['Book'] },
  { key: 'newspapers', icon: 'o_newspaper', types: ['Journal / Serial'] },
  { key: 'magazines', icon: 'o_auto_stories', types: ['Journal / Serial'] },
  { key: 'manuscripts', icon: 'o_history_edu', types: ['Music manuscript', 'Manuscript map'] },
  { key: 'maps', icon: 'o_map', types: ['Printed map', 'Manuscript map', 'Map serial'] },
  { key: 'posters', icon: 'o_palette', types: ['Graphic'] },
  { key: 'photographs', icon: 'o_photo_camera', types: ['Graphic'] },
  {
    key: 'audiovisual',
    icon: 'o_music_note',
    types: ['Musical sound recording', 'Non-musical sound recording', 'Video / Film'],
  },
];

function collectionRoute(col: Collection) {
  return col.types.length ? { path: '/catalog', query: { materialType: col.types.join(',') } } : { path: '/catalog' };
}

/** Records per material type (English label → count), null until loaded */
const typeCounts = ref<Record<string, number> | null>(null);

function collectionCount(col: Collection): number {
  return col.types.reduce((sum, type) => sum + (typeCounts.value?.[type] ?? 0), 0);
}

const recordTotal = ref<number | null>(null);

function formatCount(n: number): string {
  return new Intl.NumberFormat(locale.value === 'me' ? 'sr-Latn' : 'en-US').format(n);
}

// ── Themes (static placeholders) ───────────────────────────────────────────
interface Theme {
  key: string;
  size: 'large' | 'wide' | 'small';
  image?: string;
  color?: string;
}

const THEMES: Theme[] = [
  { key: 'oldRareBooks', size: 'large', image: 'https://picsum.photos/seed/nbcg-old-rare-books/900/640' },
  { key: 'montenegrinPress', size: 'wide', color: '#1F2A52' },
  { key: 'cetinjeHeritage', size: 'small', image: 'https://picsum.photos/seed/nbcg-cetinje-heritage/480/360' },
  { key: 'cartography', size: 'small', color: '#8A4A1C' },
  { key: 'artAndPosters', size: 'small', color: '#2F4F36' },
  { key: 'folkHeritage', size: 'small', image: 'https://picsum.photos/seed/nbcg-folk-heritage/480/360' },
  { key: 'njegos', size: 'wide', color: '#3A362E' },
];

// ── Recently added ─────────────────────────────────────────────────────────
const newestItems = ref<SearchHit[]>([]);

function coverUrl(item: SearchHit): string | undefined {
  const img = item.source.file_attachments?.find((f) => f.fileType === 'IMAGE');
  return img ? `/api/files/${img.id}/download` : undefined;
}

function creatorLine(item: SearchHit): string {
  const m = item.source.metadata;
  if (m.firstResponsibility) return m.firstResponsibility;
  return [m.publication?.place, m.publication?.publisher].filter(Boolean).join(': ');
}

// COMARC material-type codes: first letter = record type, second = bibliographic level
function typeTone(type: ResolvedCode): string {
  const code = type.code ?? '';
  if (code === 'am') return 'primary';
  if (code === 'as') return 'warm';
  if (code.startsWith('e') || code.startsWith('f')) return 'positive';
  if (code.startsWith('k')) return 'warning';
  return 'muted';
}

function typeIcon(type: ResolvedCode | undefined): string {
  const code = type?.code ?? '';
  if (code === 'as') return 'o_newspaper';
  if (code.startsWith('e') || code.startsWith('f')) return 'o_map';
  if (code.startsWith('k')) return 'o_image';
  return 'o_menu_book';
}

// ── About ──────────────────────────────────────────────────────────────────
const ABOUT_FACTS = [
  { key: 'since', icon: 'o_calendar_today' },
  { key: 'titles', icon: 'o_inventory_2' },
  { key: 'programme', icon: 'o_account_balance' },
];

onMounted(() => {
  void (async () => {
    try {
      const result = await searchItems({
        type: 'records',
        sort: 'newest',
        limit: 6,
        fields: [
          'metadata.title',
          'metadata.firstResponsibility',
          'metadata.publicationDate1',
          'metadata.materialType',
          'metadata.publication.place',
          'metadata.publication.publisher',
          'file_attachments.id',
          'file_attachments.fileType',
        ].join(','),
      });
      newestItems.value = result.hits;
      recordTotal.value = result.total;
    } catch {
      newestItems.value = [];
    }
  })();
  void (async () => {
    try {
      const { suggestions } = await suggestValues({ field: 'materialType', limit: 50, type: 'records' });
      typeCounts.value = Object.fromEntries(suggestions.map((s) => [s.value.en, s.count]));
    } catch {
      typeCounts.value = null;
    }
  })();
});
</script>

<style scoped lang="sass">
// ── Hero ───────────────────────────────────────────────────────────────────
.hero
  background: $primary
  color: white
  padding: 96px 24px

.hero__inner
  max-width: 960px
  margin: 0 auto
  display: flex
  flex-direction: column
  gap: 28px

.hero__title
  margin: 0
  text-align: center
  font-family: $serif
  font-size: 56px
  font-weight: 600
  line-height: 1.08
  letter-spacing: -0.01em

.hero__search
  margin-top: 12px
  display: flex
  align-items: stretch
  height: 76px
  background: $surface
  border-radius: 10px
  box-shadow: 0 16px 40px rgba(10, 16, 40, 0.35)
  overflow: hidden

.hero__type
  flex-shrink: 0
  padding: 0 18px
  border-right: 1px solid $divider
  color: $primary
  font-weight: 600
  font-size: 15px
  :deep(.q-field__control)
    height: 100%
  :deep(.q-field__native)
    color: $primary
    white-space: nowrap

.hero__input
  flex-grow: 1
  min-width: 0
  padding: 0 20px
  font-size: 18px
  :deep(.q-field__control)
    height: 100%
  :deep(.q-field__native)
    color: $ink

.hero__submit
  margin: 8px
  padding: 0 26px
  border-radius: $radius
  font-size: 16px
  font-weight: 700

.hero__options
  display: flex
  align-items: center
  justify-content: center
  gap: 28px
  font-size: 14.5px
  color: $on-navy

.hero__fulltext
  color: $on-navy
  :deep(.q-checkbox__label)
    color: $on-navy
    font-size: 14.5px

.hero__link
  display: inline-flex
  align-items: center
  gap: 6px
  color: white
  font-weight: 600
  text-decoration: none
  &:hover
    text-decoration: underline

.hero__chips
  display: flex
  align-items: center
  justify-content: center
  flex-wrap: wrap
  gap: 10px

.hero__chips-label
  margin-right: 4px
  font-size: 13px
  font-weight: 600
  letter-spacing: 0.04em
  text-transform: uppercase
  color: $on-navy-muted

.hero__chip
  height: 32px
  padding: 0 14px
  font-size: 14px
  font-weight: 400
  color: #F1EDE3
  &:before
    border-color: rgba($paper, 0.28)
  &:hover:before
    border-color: rgba($paper, 0.6)

.hero__facts
  margin-top: 20px
  padding-top: 22px
  border-top: 1px solid rgba($paper, 0.14)
  text-align: center
  font-size: 14px
  color: $on-navy-muted

@media (max-width: 1023px)
  .hero
    padding: 64px 24px
  .hero__title
    font-size: 40px

@media (max-width: 599px)
  .hero
    padding: 48px 16px
  .hero__title
    font-size: 30px
  .hero__search
    height: auto
    flex-direction: column
    align-items: stretch
  .hero__type
    padding: 4px 14px
    border-right: none
    border-bottom: 1px solid $divider
  .hero__input
    padding: 4px 14px
  .hero__submit
    height: 48px
  .hero__options
    flex-direction: column
    gap: 12px

// ── Sections ───────────────────────────────────────────────────────────────
.home__section
  padding-top: 64px
  display: flex
  flex-direction: column
  gap: 22px
  &--last
    padding-bottom: 72px

.sec-head
  display: flex
  align-items: flex-end
  justify-content: space-between
  gap: 24px
  flex-wrap: wrap

.sec-head__eyebrow
  font-size: 12px
  font-weight: 600
  letter-spacing: 0.1em
  text-transform: uppercase
  color: $eyebrow
  margin-bottom: 6px

.sec-head__title
  margin: 0
  font-family: $serif
  font-size: 30px
  font-weight: 600
  line-height: 1.15
  color: $ink

.sec-head__lead
  margin: 8px 0 0
  font-size: 15px
  color: $muted

.sec-head__link
  display: inline-flex
  align-items: center
  gap: 6px
  padding-bottom: 6px
  font-size: 15px
  font-weight: 600
  color: $primary
  text-decoration: none
  &:hover
    text-decoration: underline

// ── Collection tiles ───────────────────────────────────────────────────────
.tiles
  display: grid
  grid-template-columns: repeat(4, minmax(0, 1fr))
  gap: 16px

.tile
  display: flex
  align-items: center
  gap: 14px
  padding: 16px 18px
  background: $surface
  border: 1px solid $divider
  border-radius: $radius
  color: $ink
  text-decoration: none
  transition: border-color 0.15s, box-shadow 0.15s
  &:hover
    border-color: $primary
    box-shadow: 0 4px 18px rgba($dark, 0.08)

.tile__icon
  width: 46px
  height: 46px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  border-radius: 10px
  background: #F1EADB
  color: $primary

.tile__text
  display: flex
  flex-direction: column
  gap: 3px
  min-width: 0

.tile__name
  font-size: 15.5px
  font-weight: 600

.tile__count
  font-size: 13px
  color: $muted

@media (max-width: 1023px)
  .tiles
    grid-template-columns: repeat(2, minmax(0, 1fr))

// ── Theme mosaic ───────────────────────────────────────────────────────────
.mosaic
  display: grid
  grid-template-columns: repeat(4, minmax(0, 1fr))
  grid-auto-rows: 186px
  gap: 16px

.mosaic__tile
  position: relative
  display: flex
  flex-direction: column
  justify-content: space-between
  padding: 20px 22px
  border-radius: 12px
  overflow: hidden
  background: $divider
  color: white
  text-decoration: none
  &--large
    grid-column: span 2
    grid-row: span 2
  &--wide
    grid-column: span 2
    padding: 26px 28px
  &--image
    justify-content: flex-end
    padding: 14px
  &:hover .mosaic__img
    transform: scale(1.03)

.mosaic__img
  position: absolute
  inset: 0
  width: 100%
  height: 100%
  object-fit: cover
  transition: transform 0.4s ease

.mosaic__plate
  position: relative
  align-self: flex-start
  display: flex
  flex-direction: column
  gap: 4px
  padding: 10px 14px
  background: $primary
  border-radius: $radius
  &--lg
    padding: 18px 22px
    .mosaic__name
      font-size: 34px

.mosaic__badge
  font-size: 12px
  font-weight: 700
  letter-spacing: 0.08em
  text-transform: uppercase
  color: $gold

.mosaic__name
  font-family: $serif
  font-size: 21px
  font-weight: 600
  line-height: 1.15

.mosaic__tile--wide .mosaic__name
  font-size: 28px

.mosaic__body
  display: flex
  flex-direction: column
  gap: 8px

.mosaic__desc
  max-width: 460px
  font-size: 14.5px
  line-height: 1.5
  color: rgba(white, 0.82)

.mosaic__foot
  display: flex
  justify-content: flex-end
  color: rgba(white, 0.85)

@media (max-width: 1023px)
  .mosaic
    grid-template-columns: repeat(2, minmax(0, 1fr))
    grid-auto-rows: 170px
  .mosaic__tile--large
    grid-row: span 2
  .mosaic__plate--lg .mosaic__name
    font-size: 26px

@media (max-width: 599px)
  .mosaic
    grid-template-columns: 1fr
    grid-auto-rows: 150px
  .mosaic__tile--large,
  .mosaic__tile--wide
    grid-column: span 1
  .mosaic__tile--large
    grid-row: span 2

// ── Recently added ─────────────────────────────────────────────────────────
.newest
  display: grid
  grid-template-columns: repeat(2, minmax(0, 1fr))
  gap: 14px 24px

.newest__card
  display: flex
  align-items: center
  gap: 18px
  min-height: 112px
  padding: 11px 20px 11px 12px
  background: $surface
  border: 1px solid $divider
  border-radius: 10px
  color: $ink
  text-decoration: none
  transition: border-color 0.15s, box-shadow 0.15s
  &:hover
    border-color: $primary
    box-shadow: 0 4px 18px rgba($dark, 0.08)
    .newest__arrow
      transform: translateX(3px)

.newest__cover
  width: 70px
  height: 90px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  padding: 6px
  border-radius: 6px
  background: $divider-soft
  color: $muted
  overflow: hidden
  img
    width: 100%
    height: 100%
    object-fit: contain
    display: block

.newest__text
  display: flex
  flex-direction: column
  gap: 5px
  flex-grow: 1
  min-width: 0

.newest__meta
  display: flex
  align-items: center
  gap: 10px

.newest__type
  text-transform: uppercase
  letter-spacing: 0.04em
  font-size: 11.5px
  font-weight: 700
  // Serials get a warm tone the shared badge set does not have
  &.badge-soft--warm
    background: #F5E1D0
    color: #7A3F12

.newest__year
  font-size: 13px
  color: $muted

.newest__title
  font-family: $serif
  font-size: 19px
  font-weight: 600
  line-height: 1.2
  color: $primary
  overflow: hidden
  display: -webkit-box
  -webkit-line-clamp: 2
  -webkit-box-orient: vertical

.newest__creator
  font-size: 13.5px
  color: $muted
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis

.newest__arrow
  flex-shrink: 0
  color: $primary
  transition: transform 0.2s

@media (max-width: 799px)
  .newest
    grid-template-columns: 1fr

// ── About ──────────────────────────────────────────────────────────────────
.about
  display: grid
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr)
  gap: 56px
  padding: 44px 48px
  background: $surface
  border: 1px solid $divider
  border-radius: 10px

.about__copy
  display: flex
  flex-direction: column
  gap: 14px
  p
    margin: 0
    font-size: 15.5px
    line-height: 1.65
    color: #3A362E
  .sec-head__eyebrow
    margin-bottom: 0

.about__more
  align-self: flex-start
  margin-top: 8px
  min-height: 44px
  padding: 0 18px
  font-size: 14.5px
  font-weight: 600
  &:before
    border-color: $field-border

.about__facts
  list-style: none
  margin: 0
  padding: 0 0 0 40px
  border-left: 1px solid $divider
  display: flex
  flex-direction: column

.about__fact
  display: flex
  gap: 14px
  padding: 14px 0
  border-bottom: 1px solid $divider-soft
  &:last-child
    border-bottom: none

.about__fact-icon
  width: 40px
  height: 40px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  border-radius: 10px
  background: #F1EADB
  color: $primary

.about__fact-text
  display: flex
  flex-direction: column
  gap: 3px

.about__fact-title
  font-size: 15px
  font-weight: 600

.about__fact-desc
  font-size: 13.5px
  line-height: 1.45
  color: $muted

@media (max-width: 1023px)
  .about
    grid-template-columns: 1fr
    gap: 32px
    padding: 28px 24px
  .about__facts
    padding-left: 0
    border-left: none
    border-top: 1px solid $divider
</style>
