<template>
  <q-page class="catalog">
    <!-- SEARCH BAND: always visible, submits to the URL -->
    <div class="cat-band">
      <form class="site-container cat-band__form" role="search" @submit.prevent="submitSearch">
        <q-input
          v-model="searchText"
          borderless
          clearable
          clear-icon="o_close"
          :placeholder="t('catalog.searchPlaceholder')"
          :aria-label="t('catalog.searchPlaceholder')"
          class="cat-band__input"
        >
          <template #prepend><q-icon name="o_search" size="20px" /></template>
        </q-input>
        <q-checkbox v-model="fullText" dense color="secondary" keep-color :label="t('catalog.fullText')" class="cat-band__fulltext" />
        <q-btn type="submit" unelevated no-caps color="secondary" :label="t('common.search')" class="cat-band__submit" />
      </form>
    </div>

    <div class="site-container cat-main">
      <!-- FILTERS: in-flow column on desktop, a side dialog below 1024px -->
      <aside v-if="$q.screen.gt.sm" class="cat-aside" :aria-label="t('catalog.refine')">
        <CatalogFilterPanel :query="query" :type-options="typeOptions" :language-options="languageOptions" @patch="patch" @clear="clearAll" />
      </aside>
      <q-dialog v-else v-model="filtersOpen" position="left" full-height>
        <q-card class="cat-drawer">
          <div class="cat-drawer__bar">
            <q-btn flat round dense icon="o_close" :aria-label="t('admin.common.close')" @click="filtersOpen = false" />
          </div>
          <CatalogFilterPanel
            :query="query"
            :type-options="typeOptions"
            :language-options="languageOptions"
            class="cat-drawer__panel"
            @patch="patch"
            @clear="clearAll"
          />
        </q-card>
      </q-dialog>

      <!-- RESULTS -->
      <section class="cat-results" :aria-labelledby="'results-h'">
        <nav class="cat-crumb" :aria-label="t('nav.breadcrumb')">
          <router-link to="/" class="cat-crumb__link">{{ t('nav.home') }}</router-link>
          <span aria-hidden="true">/</span>
          <span class="cat-crumb__current">{{ t('catalog.title') }}</span>
        </nav>

        <div class="cat-head">
          <div class="cat-head__text">
            <h1 id="results-h" class="cat-head__title">{{ t('catalog.title') }}</h1>
            <div class="cat-head__summary">
              <q-spinner v-if="loading" size="14px" color="primary" class="q-mr-xs" />
              <strong>{{ t('catalog.results', total) }}</strong>
              <template v-if="query.q"> {{ t('catalog.forQuery', { q: query.q }) }}</template>
              <template v-if="total > 0"> · {{ t('catalog.showingRange', { from: rangeFrom, to: rangeTo }) }}</template>
            </div>
          </div>
          <div class="cat-head__tools">
            <q-btn
              v-if="!$q.screen.gt.sm"
              outline
              no-caps
              icon="o_tune"
              :label="t('catalog.refine')"
              class="cat-tool cat-tool--btn"
              @click="filtersOpen = true"
            >
              <q-badge v-if="activeChips.length" floating color="secondary">{{ activeChips.length }}</q-badge>
            </q-btn>
            <label class="cat-head__sort">
              <span class="cat-head__sort-label">{{ t('catalog.sortBy') }}</span>
              <q-select
                :model-value="query.sort"
                :options="sortOptions"
                outlined
                dense
                emit-value
                map-options
                dropdown-icon="o_expand_more"
                class="cat-tool"
                @update:model-value="patch({ sort: $event })"
              />
            </label>
            <q-btn-toggle
              v-model="view"
              outline
              unelevated
              dense
              toggle-color="primary"
              color="primary"
              :options="viewOptions"
              class="cat-tool cat-view"
              :aria-label="t('catalog.view')"
            />
          </div>
        </div>

        <!-- Active filters as removable chips -->
        <div v-if="activeChips.length" class="cat-chips">
          <span class="cat-chips__label">{{ t('catalog.activeFilters') }}</span>
          <q-chip
            v-for="chip in activeChips"
            :key="chip.key"
            removable
            dense
            icon-remove="o_close"
            class="cat-chip"
            :aria-label="t('catalog.remove', { label: chip.label })"
            @remove="chip.remove()"
          >
            {{ chip.label }}
          </q-chip>
          <q-btn flat dense no-caps :label="t('catalog.clearAll')" class="cat-chips__clear" @click="clearAll" />
        </div>

        <!-- Grid or list -->
        <div v-if="!loading && items.length === 0" class="cat-empty">
          <q-icon name="o_search_off" size="36px" class="cat-empty__icon" />
          <div class="cat-empty__title">{{ t('catalog.empty') }}</div>
          <div class="cat-empty__hint">{{ t('catalog.emptyHint') }}</div>
          <q-btn v-if="hasCatalogFilters(query)" outline no-caps color="primary" :label="t('catalog.clearAll')" class="q-mt-md" @click="clearAll" />
        </div>

        <div v-else-if="view === 'grid'" class="cat-grid" :class="{ 'cat-grid--loading': loading }">
          <router-link v-for="item in items" :key="item.id" :to="`/catalog/${item.id}`" class="cat-card">
            <span class="cat-card__cover">
              <img v-if="coverUrl(item)" :src="coverUrl(item)" alt="" loading="lazy" />
              <q-icon v-else :name="materialIcon(item.source.metadata.materialType)" size="28px" class="cat-card__cover-icon" />
              <q-badge
                v-if="item.source.metadata.materialType"
                class="badge-soft cat-type"
                :class="`badge-soft--${materialTone(item.source.metadata.materialType)}`"
              >
                {{ codeLabel(item.source.metadata.materialType) }}
              </q-badge>
            </span>
            <span class="cat-card__body">
              <span class="cat-card__title">{{ item.source.metadata.title }}</span>
              <span class="cat-card__creator">{{ creatorLine(item) }}</span>
              <span class="cat-card__foot">
                <span>{{ item.source.metadata.publicationDate1 }}</span>
                <span v-if="hasNoFiles(item)" class="cat-card__unscanned">{{ t('catalog.notScanned') }}</span>
                <span v-else>{{ extentLabel(item.source.metadata.extent) }}</span>
              </span>
            </span>
          </router-link>
        </div>

        <div v-else class="cat-list" :class="{ 'cat-grid--loading': loading }">
          <router-link v-for="item in items" :key="item.id" :to="`/catalog/${item.id}`" class="cat-row">
            <span class="cat-row__cover">
              <img v-if="coverUrl(item)" :src="coverUrl(item)" alt="" loading="lazy" />
              <q-icon v-else :name="materialIcon(item.source.metadata.materialType)" size="26px" />
            </span>
            <span class="cat-row__text">
              <span class="cat-row__meta">
                <q-badge
                  v-if="item.source.metadata.materialType"
                  class="badge-soft cat-type"
                  :class="`badge-soft--${materialTone(item.source.metadata.materialType)}`"
                >
                  {{ codeLabel(item.source.metadata.materialType) }}
                </q-badge>
                <span v-if="item.source.metadata.publicationDate1" class="cat-row__year">{{ item.source.metadata.publicationDate1 }}</span>
                <span v-if="hasNoFiles(item)" class="cat-card__unscanned">{{ t('catalog.notScanned') }}</span>
                <span v-else-if="extentLabel(item.source.metadata.extent)" class="cat-row__year">{{ extentLabel(item.source.metadata.extent) }}</span>
              </span>
              <span class="cat-row__title">{{ item.source.metadata.title }}</span>
              <span class="cat-row__creator">{{ creatorLine(item) }}</span>
            </span>
            <q-icon name="o_arrow_forward" size="16px" class="cat-row__arrow" />
          </router-link>
        </div>

        <!-- Pagination -->
        <nav v-if="pages > 1" class="cat-pages" :aria-label="t('catalog.pagination')">
          <span class="cat-pages__caption">{{ t('catalog.pageOf', { page: query.page, pages, size: PAGE_SIZE }) }}</span>
          <q-pagination
            :model-value="query.page"
            :max="pages"
            :max-pages="6"
            boundary-numbers
            direction-links
            icon-prev="o_chevron_left"
            icon-next="o_chevron_right"
            color="primary"
            active-design="unelevated"
            active-color="primary"
            flat
            class="cat-pages__nav"
            @update:model-value="goToPage"
          />
        </nav>
      </section>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { searchItems, suggestValues, type ResolvedCode, type SearchHit } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { useExtentLabel } from 'src/composables/useExtentLabel';
import { ERAS } from 'src/utils/eras';
import { coverUrl, creatorLine, hasNoFiles, materialIcon, materialTone } from 'src/utils/publicRecord';
import { hasCatalogFilters, parseCatalogQuery, toRouteQuery, type CatalogQuery } from 'src/utils/catalogQuery';
import CatalogFilterPanel, { type FacetOption } from 'src/components/catalog/CatalogFilterPanel.vue';

// The catalogue (design canvas: Catalogue board, filter direction 3). Every
// filter lives in the URL: the panel and the chips patch the route, a watcher
// on the route fetches. The search box is the only field that waits for Submit.

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { codeLabel } = useCodeLabel();
const { extentLabel } = useExtentLabel();
const $q = useQuasar();

const PAGE_SIZE = 20;

const query = computed(() => parseCatalogQuery(route.query));

// ── Search box (local until submitted) ─────────────────────────────────────
const searchText = ref(query.value.q);
const fullText = ref(query.value.fullText);
watch(query, (q) => {
  searchText.value = q.q;
  fullText.value = q.fullText;
});

function submitSearch() {
  void navigate({ ...query.value, q: (searchText.value ?? '').trim(), fullText: fullText.value, page: 1 }, true);
}

// ── URL state ──────────────────────────────────────────────────────────────
function navigate(next: CatalogQuery, push = false) {
  const location = { query: toRouteQuery(next) };
  return push ? router.push(location) : router.replace(location);
}

function patch(p: Partial<CatalogQuery>) {
  void navigate({ ...query.value, ...p, page: 1 });
}

function clearAll() {
  void navigate({ ...parseCatalogQuery({}), sort: query.value.sort });
}

function goToPage(page: number) {
  void navigate({ ...query.value, page }, true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Results ────────────────────────────────────────────────────────────────
const items = ref<SearchHit[]>([]);
const total = ref(0);
const pages = ref(1);
const loading = ref(false);
let requestId = 0;

const LIST_FIELDS = [
  'metadata.title',
  'metadata.firstResponsibility',
  'metadata.publicationDate1',
  'metadata.materialType',
  'metadata.publication.place',
  'metadata.publication.publisher',
  'metadata.extent',
  'file_attachments.id',
  'file_attachments.fileType',
].join(',');

async function fetchItems() {
  const q = query.value;
  const id = ++requestId;
  loading.value = true;
  try {
    const result = await searchItems({
      type: 'records',
      page: q.page,
      limit: PAGE_SIZE,
      fields: LIST_FIELDS,
      sort: q.sort,
      // The checkbox switches the text from the metadata to the scanned text
      ...(q.q ? (q.fullText ? { fullText: q.q } : { q: q.q }) : {}),
      ...(q.title ? { title: q.title } : {}),
      ...(q.author ? { author: q.author } : {}),
      ...(q.publisher ? { publisher: q.publisher } : {}),
      ...(q.materialType.length ? { materialType: q.materialType.join(',') } : {}),
      ...(q.language.length ? { language: q.language.join(',') } : {}),
      ...(q.collectionType ? { collectionType: q.collectionType } : {}),
      ...(q.yearFrom ? { yearFrom: q.yearFrom } : {}),
      ...(q.yearTo ? { yearTo: q.yearTo } : {}),
    });
    if (id !== requestId) return; // a newer request is on its way
    items.value = result.hits;
    total.value = result.total;
    pages.value = Math.max(1, result.pages);
  } catch {
    if (id !== requestId) return;
    items.value = [];
    total.value = 0;
    pages.value = 1;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

watch(() => route.query, () => void fetchItems(), { immediate: true });

const rangeFrom = computed(() => (query.value.page - 1) * PAGE_SIZE + 1);
const rangeTo = computed(() => Math.min(query.value.page * PAGE_SIZE, total.value));

// ── Filter options with counts (whole catalogue, from /search/suggest) ─────
const typeCodes = ref<{ value: ResolvedCode; count: number }[]>([]);
const languageCodes = ref<{ value: ResolvedCode; count: number }[]>([]);

const typeOptions = computed<FacetOption[]>(() =>
  typeCodes.value.map((s) => ({ value: s.value.en, label: codeLabel(s.value), count: s.count })),
);
const languageOptions = computed<FacetOption[]>(() =>
  languageCodes.value.map((s) => ({ value: s.value.en, label: codeLabel(s.value), count: s.count })),
);

onMounted(async () => {
  try {
    const [types, langs] = await Promise.all([
      suggestValues({ field: 'materialType', limit: 50, type: 'records' }),
      suggestValues({ field: 'language', limit: 50, type: 'records' }),
    ]);
    typeCodes.value = types.suggestions;
    languageCodes.value = langs.suggestions;
  } catch {
    typeCodes.value = [];
    languageCodes.value = [];
  }
});

// ── Toolbar ────────────────────────────────────────────────────────────────
const sortOptions = computed(() => [
  { label: t('catalog.sort.relevance'), value: 'relevance' },
  { label: t('catalog.sort.newest'), value: 'newest' },
]);

const VIEW_KEY = 'nbcg-catalog-view';
const view = ref<'grid' | 'list'>('grid');
try {
  if (localStorage.getItem(VIEW_KEY) === 'list') view.value = 'list';
} catch {
  // storage unavailable: grid
}
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // ignore
  }
});

const viewOptions = computed(() => [
  { value: 'grid', icon: 'o_grid_view', attrs: { 'aria-label': t('catalog.gridView') } },
  { value: 'list', icon: 'o_view_list', attrs: { 'aria-label': t('catalog.listView') } },
]);

const filtersOpen = ref(false);

// ── Active-filter chips ────────────────────────────────────────────────────
interface Chip {
  key: string;
  label: string;
  remove: () => void;
}

const activeChips = computed<Chip[]>(() => {
  const q = query.value;
  const chips: Chip[] = [];
  if (q.q) chips.push({ key: 'q', label: t('catalog.chipSearch', { q: q.q }), remove: () => patch({ q: '', fullText: false }) });
  if (q.title) chips.push({ key: 'title', label: t('catalog.chipTitle', { v: q.title }), remove: () => patch({ title: '' }) });
  if (q.author) chips.push({ key: 'author', label: t('catalog.chipAuthor', { v: q.author }), remove: () => patch({ author: '' }) });
  if (q.publisher) {
    chips.push({ key: 'publisher', label: t('catalog.chipPublisher', { v: q.publisher }), remove: () => patch({ publisher: '' }) });
  }
  for (const type of q.materialType) {
    chips.push({
      key: `type:${type}`,
      label: typeOptions.value.find((o) => o.value === type)?.label ?? type,
      remove: () => patch({ materialType: q.materialType.filter((v) => v !== type) }),
    });
  }
  for (const lang of q.language) {
    chips.push({
      key: `lang:${lang}`,
      label: languageOptions.value.find((o) => o.value === lang)?.label ?? lang,
      remove: () => patch({ language: q.language.filter((v) => v !== lang) }),
    });
  }
  if (q.collectionType) {
    chips.push({
      key: 'collection',
      label: q.collectionType === '0' ? t('catalog.collection.single') : t('catalog.collection.only'),
      remove: () => patch({ collectionType: '' }),
    });
  }
  if (q.yearFrom || q.yearTo) {
    const era = ERAS.find((e) => (e.from ?? '') === q.yearFrom && (e.to ?? '') === q.yearTo);
    chips.push({
      key: 'period',
      label: t('catalog.chipPeriod', { v: era ? t(`catalog.eras.${era.key}`) : `${q.yearFrom || '…'}–${q.yearTo || '…'}` }),
      remove: () => patch({ yearFrom: '', yearTo: '' }),
    });
  }
  return chips;
});

</script>

<style scoped lang="sass">
// ── Search band ────────────────────────────────────────────────────────────
.cat-band
  background: $primary
  padding: 20px 0

.cat-band__form
  display: flex
  align-items: center
  gap: 16px

.cat-band__input
  flex-grow: 1
  min-width: 0
  height: 52px
  padding: 0 8px 0 16px
  background: $surface
  border-radius: $radius
  :deep(.q-field__control)
    height: 52px
  :deep(.q-field__native)
    font-size: 16px
    color: $ink
  :deep(.q-field__prepend)
    color: $muted
  :deep(.q-field__append)
    color: $muted

.cat-band__fulltext
  color: $on-navy-strong
  white-space: nowrap
  :deep(.q-checkbox__label)
    color: $on-navy-strong
    font-size: 14.5px

.cat-band__submit
  height: 52px
  padding: 0 24px
  font-size: 15px
  font-weight: 700
  border-radius: $radius

@media (max-width: 699px)
  .cat-band__form
    flex-wrap: wrap
    gap: 12px
  .cat-band__input
    flex-basis: 100%
  .cat-band__submit
    margin-left: auto
    height: 44px

// ── Columns ────────────────────────────────────────────────────────────────
.cat-main
  display: grid
  grid-template-columns: 280px minmax(0, 1fr)
  gap: 36px
  align-items: start
  padding-top: 28px
  padding-bottom: 48px

@media (max-width: 1023px)
  .cat-main
    grid-template-columns: minmax(0, 1fr)
    padding-top: 20px

.cat-aside
  padding-right: 24px
  border-right: 1px solid #D8CCB3
  align-self: stretch

.cat-drawer
  width: 340px
  max-width: 90vw
  display: flex
  flex-direction: column
  background: $paper

.cat-drawer__bar
  display: flex
  justify-content: flex-end
  padding: 8px 8px 0

.cat-drawer__panel
  padding: 0 20px 24px
  overflow: auto

// ── Results head ───────────────────────────────────────────────────────────
.cat-results
  display: flex
  flex-direction: column
  gap: 18px
  min-width: 0

.cat-crumb
  display: flex
  align-items: center
  gap: 8px
  font-size: 13.5px
  color: $muted

.cat-crumb__link
  color: $muted
  text-decoration: none
  &:hover
    color: $primary

.cat-crumb__current
  color: $ink
  font-weight: 600

.cat-head
  display: flex
  align-items: flex-end
  justify-content: space-between
  gap: 24px
  flex-wrap: wrap

.cat-head__text
  display: flex
  flex-direction: column
  gap: 6px

.cat-head__title
  margin: 0
  font-family: $serif
  font-size: 32px
  font-weight: 600
  line-height: 1.15
  color: $ink

.cat-head__summary
  font-size: 14.5px
  color: $muted
  strong
    color: $ink
    font-weight: 600

.cat-head__tools
  display: flex
  align-items: center
  gap: 10px
  flex-wrap: wrap

.cat-head__sort
  display: flex
  align-items: center
  gap: 10px

.cat-head__sort-label
  font-size: 13.5px
  color: $muted

.cat-tool
  :deep(.q-field__control)
    height: 40px
    min-height: 40px
    border-radius: $radius
    background: $surface
    &:before
      border-color: $field-border
  :deep(.q-field__native)
    font-size: 14px
    font-weight: 600
    color: $primary
    padding: 0
  :deep(.q-field__marginal)
    height: 40px
  &--btn
    height: 40px
    border-radius: $radius
    font-weight: 600
    &:before
      border-color: $field-border

.cat-view
  border-radius: $radius
  :deep(.q-btn)
    width: 42px
    height: 40px
    padding: 0
  :deep(.q-btn:before)
    border-color: $field-border

// ── Chips ──────────────────────────────────────────────────────────────────
.cat-chips
  display: flex
  align-items: center
  gap: 8px
  flex-wrap: wrap

.cat-chips__label
  font-size: 13px
  color: $muted
  margin-right: 4px

.cat-chip
  margin: 0
  height: 30px
  padding: 0 6px 0 12px
  background: $soft-primary
  color: $primary
  font-size: 13.5px
  font-weight: 600
  :deep(.q-chip__icon--remove)
    color: $primary
    opacity: 0.8

.cat-chips__clear
  margin-left: 4px
  color: $eyebrow
  font-weight: 600
  font-size: 13.5px

// ── Grid ───────────────────────────────────────────────────────────────────
.cat-grid
  display: grid
  grid-template-columns: repeat(4, minmax(0, 1fr))
  gap: 20px
  transition: opacity 0.15s
  &--loading
    opacity: 0.6

@media (max-width: 1279px)
  .cat-grid
    grid-template-columns: repeat(3, minmax(0, 1fr))

@media (max-width: 799px)
  .cat-grid
    grid-template-columns: repeat(2, minmax(0, 1fr))
    gap: 14px

.cat-card
  display: flex
  flex-direction: column
  background: $surface
  border: 1px solid $divider
  border-radius: $radius
  overflow: hidden
  color: $ink
  text-decoration: none
  transition: border-color 0.15s, box-shadow 0.15s
  &:hover
    border-color: $primary
    box-shadow: 0 4px 18px rgba($dark, 0.08)

.cat-card__cover
  position: relative
  display: flex
  align-items: center
  justify-content: center
  aspect-ratio: 3 / 4
  background: $divider-soft
  color: #9A9182
  img
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    object-fit: cover
    display: block

.cat-type
  position: absolute
  top: 10px
  left: 10px
  text-transform: uppercase
  letter-spacing: 0.04em
  font-size: 11.5px
  font-weight: 700

.cat-card__body
  display: flex
  flex-direction: column
  gap: 5px
  flex-grow: 1
  padding: 12px 14px 14px

.cat-card__title
  font-size: 15px
  font-weight: 600
  line-height: 1.3
  color: $primary
  overflow: hidden
  display: -webkit-box
  -webkit-line-clamp: 2
  -webkit-box-orient: vertical

.cat-card__creator
  font-size: 13.5px
  line-height: 1.35
  color: $muted
  overflow: hidden
  display: -webkit-box
  -webkit-line-clamp: 2
  -webkit-box-orient: vertical

.cat-card__foot
  margin-top: auto
  padding-top: 8px
  display: flex
  justify-content: space-between
  gap: 8px
  font-size: 13px
  color: $muted

.cat-card__unscanned
  color: $eyebrow

// ── List ───────────────────────────────────────────────────────────────────
.cat-list
  display: flex
  flex-direction: column
  gap: 12px
  transition: opacity 0.15s

.cat-row
  display: flex
  align-items: center
  gap: 18px
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

.cat-row__cover
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

.cat-row__text
  display: flex
  flex-direction: column
  gap: 5px
  flex-grow: 1
  min-width: 0

.cat-row__meta
  display: flex
  align-items: center
  gap: 10px
  flex-wrap: wrap
  .cat-type
    position: static

.cat-row__year
  font-size: 13px
  color: $muted

.cat-row__title
  font-family: $serif
  font-size: 19px
  font-weight: 600
  line-height: 1.2
  color: $primary

.cat-row__creator
  font-size: 13.5px
  color: $muted
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis

.cat-row__arrow
  flex-shrink: 0
  color: $primary

// ── Empty, pagination ──────────────────────────────────────────────────────
.cat-empty
  display: flex
  flex-direction: column
  align-items: center
  text-align: center
  padding: 56px 16px
  background: $surface
  border: 1px dashed $field-border
  border-radius: 10px

.cat-empty__icon
  color: $muted
  margin-bottom: 10px

.cat-empty__title
  font-family: $serif
  font-size: 22px
  font-weight: 600
  color: $ink

.cat-empty__hint
  margin-top: 4px
  font-size: 14.5px
  color: $muted

.cat-pages
  display: flex
  align-items: center
  justify-content: space-between
  gap: 16px
  flex-wrap: wrap
  margin-top: 8px
  padding-top: 18px
  border-top: 1px solid $divider

.cat-pages__caption
  font-size: 13.5px
  color: $muted

.cat-pages__nav
  :deep(.q-btn)
    min-width: 40px
    height: 40px
    border-radius: $radius
    font-weight: 600
</style>
