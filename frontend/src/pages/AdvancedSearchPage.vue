<template>
  <q-page>
    <div class="site-container pub-page">
      <PageHead :title="t('advanced.title')" :lead="t('advanced.lead')" :crumb="t('nav.advancedSearch')" />

      <div class="pub-grid pub-grid--wide">
        <q-form class="pub-card adv" @submit="search" @reset="reset">
          <fieldset class="adv__group">
            <legend class="adv__legend">{{ t('advanced.groupWhat') }}</legend>
            <div class="adv__fields">
              <div class="field">
                <label for="adv-title" class="field__label">{{ t('advanced.titleField') }}</label>
                <q-input v-model="title" for="adv-title" outlined :placeholder="t('advanced.titlePlaceholder')" />
              </div>
              <div class="field">
                <label for="adv-author" class="field__label">{{ t('advanced.author') }}</label>
                <q-input v-model="author" for="adv-author" outlined :placeholder="t('advanced.authorPlaceholder')" />
              </div>
              <div class="field">
                <label for="adv-publisher" class="field__label">{{ t('advanced.publisher') }}</label>
                <q-select
                  :model-value="publisher"
                  :options="publisherOptions"
                  for="adv-publisher"
                  outlined
                  use-input
                  fill-input
                  hide-selected
                  clearable
                  input-debounce="300"
                  :placeholder="publisher ? undefined : t('advanced.publisherPlaceholder')"
                  @filter="filterPublisher"
                  @input-value="publisher = $event"
                  @update:model-value="publisher = $event ?? ''"
                  @clear="publisher = ''"
                >
                  <template #append><q-icon name="o_search" size="18px" /></template>
                </q-select>
              </div>
              <div class="field">
                <label for="adv-keywords" class="field__label">{{ t('advanced.keywords') }}</label>
                <q-input v-model="keywords" for="adv-keywords" outlined :placeholder="t('advanced.keywordsPlaceholder')" />
              </div>
            </div>
          </fieldset>

          <fieldset class="adv__group adv__group--next">
            <legend class="adv__legend">{{ t('advanced.groupNarrow') }}</legend>
            <div class="adv__fields">
              <div class="field">
                <label for="adv-type" class="field__label">{{ t('advanced.materialType') }}</label>
                <q-select v-model="materialType" :options="typeOptions" for="adv-type" outlined emit-value map-options dropdown-icon="o_expand_more" />
              </div>
              <div class="field">
                <label for="adv-lang" class="field__label">{{ t('advanced.language') }}</label>
                <q-select v-model="language" :options="languageOptions" for="adv-lang" outlined emit-value map-options dropdown-icon="o_expand_more" />
              </div>
              <div class="field">
                <label for="adv-coll" class="field__label">{{ t('advanced.collection') }}</label>
                <q-select v-model="collection" :options="collectionOptions" for="adv-coll" outlined emit-value map-options dropdown-icon="o_expand_more" />
              </div>
              <div class="field">
                <span class="field__label">{{ t('advanced.year') }}</span>
                <div class="field__range">
                  <q-input v-model="yearFrom" outlined inputmode="numeric" :placeholder="t('advanced.yearFrom')" :aria-label="t('advanced.yearFrom')" />
                  <span class="field__dash" aria-hidden="true">–</span>
                  <q-input v-model="yearTo" outlined inputmode="numeric" :placeholder="t('advanced.yearTo')" :aria-label="t('advanced.yearTo')" />
                </div>
              </div>
            </div>
            <div class="adv__chips">
              <span class="adv__chips-label">{{ t('advanced.quickPeriods') }}</span>
              <q-btn
                v-for="era in ERAS"
                :key="era.key"
                outline
                rounded
                dense
                no-caps
                :label="t(`catalog.eras.${era.key}`)"
                class="adv__chip"
                :class="{ 'adv__chip--on': yearFrom === (era.from ?? '') && yearTo === (era.to ?? '') }"
                @click="pickEra(era)"
              />
            </div>
          </fieldset>

          <fieldset class="adv__group adv__group--next">
            <legend class="adv__legend">{{ t('advanced.groupAvailability') }}</legend>
            <q-checkbox v-model="fullText" :label="t('advanced.fullText')" class="adv__check" />
          </fieldset>

          <div class="adv__actions">
            <q-btn flat no-caps type="reset" icon="o_restart_alt" :label="t('advanced.clear')" class="adv__reset" />
            <q-btn unelevated no-caps type="submit" color="secondary" icon="o_search" :label="t('advanced.search')" class="adv__submit" />
          </div>
        </q-form>

        <aside class="pub-aside">
          <section class="pub-card how" :aria-label="t('advanced.howTitle')">
            <div class="pub-eyebrow">{{ t('advanced.howKicker') }}</div>
            <h2 class="pub-h2 how__title">{{ t('advanced.howTitle') }}</h2>
            <ul class="pub-facts">
              <li v-for="n in 3" :key="n" class="pub-fact how__row">
                <span class="pub-fact__icon pub-fact__icon--sm">{{ n }}</span>
                <span class="pub-fact__text">{{ t(`advanced.how${n}`) }}</span>
              </li>
            </ul>
          </section>
          <LinkCard navy icon="o_menu_book" :title="t('advanced.browseTitle')" :text="t('advanced.browseText')" to="/catalog" />
        </aside>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { suggestValues, type ResolvedCode } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { ERAS, type Era } from 'src/utils/eras';
import PageHead from 'components/PageHead.vue';
import LinkCard from 'components/LinkCard.vue';

// Builds a catalogue query from several fields; the catalogue page reads it
// back from the URL and shows every field as a removable chip.

const router = useRouter();
const { t } = useI18n();
const { codeLabel } = useCodeLabel();

const title = ref('');
const author = ref('');
const publisher = ref('');
const keywords = ref('');
const materialType = ref('');
const language = ref('');
const collection = ref('');
const yearFrom = ref('');
const yearTo = ref('');
const fullText = ref(false);

// Option values are the `en` names — the backend filters match on metadata.*.en
const materialTypeCodes = ref<ResolvedCode[]>([]);
const languageCodes = ref<ResolvedCode[]>([]);

const typeOptions = computed(() => [
  { label: t('advanced.types.all'), value: '' },
  ...materialTypeCodes.value.map((c) => ({ label: codeLabel(c), value: c.en })),
]);

const languageOptions = computed(() => [
  { label: t('advanced.languages.all'), value: '' },
  ...languageCodes.value.map((c) => ({ label: codeLabel(c), value: c.en })),
]);

// `collectionType`: `>0` is every collection, `0` a single item (search filters W3)
const collectionOptions = computed(() => [
  { label: t('catalog.collection.any'), value: '' },
  { label: t('catalog.collection.only'), value: '>0' },
  { label: t('catalog.collection.single'), value: '0' },
]);

onMounted(async () => {
  try {
    const [types, langs] = await Promise.all([
      suggestValues({ field: 'materialType', limit: 50, type: 'records' }),
      suggestValues({ field: 'language', limit: 50, type: 'records' }),
    ]);
    materialTypeCodes.value = types.suggestions.map((s) => s.value);
    languageCodes.value = langs.suggestions.map((s) => s.value);
  } catch {
    materialTypeCodes.value = [];
    languageCodes.value = [];
  }
});

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

function pickEra(era: Era) {
  yearFrom.value = era.from ?? '';
  yearTo.value = era.to ?? '';
}

// Backend requires exactly 4 digits ("YYYY")
function toYearParam(value: string): string | undefined {
  const n = value.trim();
  if (!/^\d{1,4}$/.test(n)) return undefined;
  return n.padStart(4, '0');
}

function reset() {
  title.value = '';
  author.value = '';
  publisher.value = '';
  keywords.value = '';
  materialType.value = '';
  language.value = '';
  collection.value = '';
  yearFrom.value = '';
  yearTo.value = '';
  fullText.value = false;
}

async function search() {
  const q = keywords.value.trim();
  const from = toYearParam(yearFrom.value);
  const to = toYearParam(yearTo.value);
  await router.push({
    path: '/catalog',
    query: {
      ...(q ? { q, ...(fullText.value ? { fullText: '1' } : {}) } : {}),
      ...(title.value.trim() ? { title: title.value.trim() } : {}),
      ...(author.value.trim() ? { author: author.value.trim() } : {}),
      ...(publisher.value.trim() ? { publisher: publisher.value.trim() } : {}),
      ...(materialType.value ? { materialType: materialType.value } : {}),
      ...(language.value ? { language: language.value } : {}),
      ...(collection.value ? { collectionType: collection.value } : {}),
      ...(from ? { yearFrom: from } : {}),
      ...(to ? { yearTo: to } : {}),
    },
  });
}
</script>

<style scoped lang="sass">
.adv
  display: flex
  flex-direction: column
  gap: 28px
  padding: 36px 40px 32px

@media (max-width: 599px)
  .adv
    padding: 22px 18px

.adv__group
  margin: 0
  padding: 0
  border: none
  min-width: 0
  display: flex
  flex-direction: column
  gap: 16px
  &--next
    padding-top: 24px
    border-top: 1px solid $divider-soft

.adv__legend
  padding: 0
  margin-bottom: 4px
  font-family: $serif
  font-size: 20px
  font-weight: 600
  color: $ink

.adv__fields
  display: grid
  grid-template-columns: repeat(2, minmax(0, 1fr))
  gap: 16px 20px

@media (max-width: 699px)
  .adv__fields
    grid-template-columns: minmax(0, 1fr)

.field
  display: flex
  flex-direction: column
  gap: 6px

.field__label
  font-size: 13.5px
  font-weight: 600
  color: $ink-soft

.field__range
  display: flex
  align-items: center
  gap: 10px
  .q-field
    flex: 1 1 0
    min-width: 0

.field__dash
  color: #9A9282

// Quasar fields: 46px, hairline border, surface background
.adv :deep(.q-field--outlined .q-field__control)
  height: 46px
  min-height: 46px
  border-radius: $radius
  background: $surface
  &:before
    border-color: $field-border
.adv :deep(.q-field--outlined .q-field__native),
.adv :deep(.q-field--outlined .q-field__input)
  font-size: 15px
  color: $ink
  padding-top: 0
  padding-bottom: 0
.adv :deep(.q-field__marginal)
  height: 46px

.adv__chips
  display: flex
  align-items: center
  flex-wrap: wrap
  gap: 10px
  margin-top: 2px

.adv__chips-label
  margin-right: 4px
  font-size: 13px
  color: $muted

.adv__chip
  height: 32px
  padding: 0 14px
  font-size: 13.5px
  font-weight: 400
  color: $ink
  &:before
    border-color: $field-border
  &--on
    color: $primary
    font-weight: 600
    &:before
      border-color: $primary

.adv__check
  font-size: 15px
  color: $ink

.adv__actions
  display: flex
  align-items: center
  justify-content: space-between
  gap: 16px
  flex-wrap: wrap
  padding-top: 24px
  border-top: 1px solid $divider-soft

.adv__reset
  color: $muted
  font-weight: 600

.adv__submit
  min-height: 48px
  padding: 0 28px
  font-size: 16px
  font-weight: 700
  border-radius: $radius

.how
  display: flex
  flex-direction: column
  gap: 4px

.how__title
  margin-bottom: 10px

.how__row
  padding: 12px 0
  gap: 12px
</style>
