<template>
  <q-page>
    <div class="sub-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="header-kicker q-mb-xs">{{ t('common.library') }}</div>
        <h1 class="text-h4 text-weight-bold text-white q-my-none">{{ t('advanced.title') }}</h1>
      </div>
    </div>

    <div class="page-body q-px-md q-py-xl">
      <div class="content-card q-pa-xl">
        <div class="row q-col-gutter-md">
          <q-input v-model="title" outlined dense :label="t('advanced.titleField')" class="col-12 col-md-6" />
          <q-input v-model="author" outlined dense :label="t('advanced.author')" class="col-12 col-md-6" />
          <q-select
            :model-value="publisher"
            :options="publisherOptions"
            outlined dense use-input fill-input hide-selected clearable
            input-debounce="300"
            :label="t('advanced.publisher')"
            class="col-12 col-md-6"
            @filter="filterPublisher"
            @input-value="publisher = $event"
            @update:model-value="publisher = $event ?? ''"
            @clear="publisher = ''"
          />
          <q-select
            v-model="materialType"
            :options="typeOptions"
            outlined dense emit-value map-options
            :label="t('advanced.materialType')"
            class="col-12 col-md-6"
          />
          <q-select
            v-model="language"
            :options="languageOptions"
            outlined dense emit-value map-options
            :label="t('advanced.language')"
            class="col-12 col-md-6"
          />
          <q-input v-model="yearFrom" outlined dense :label="t('advanced.yearFrom')" type="number" class="col-6 col-md-3" />
          <q-input v-model="yearTo" outlined dense :label="t('advanced.yearTo')" type="number" class="col-6 col-md-3" />
        </div>

        <div class="row justify-end q-gutter-sm q-mt-lg">
          <q-btn flat no-caps color="negative" :label="t('common.reset')" icon="restart_alt" @click="reset" />
          <q-btn unelevated no-caps color="primary" text-color="white" :label="t('common.search')" icon="search" @click="search" />
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { suggestValues, type ResolvedCode } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';

const router = useRouter();
const { t } = useI18n();
const { codeLabel } = useCodeLabel();

const title = ref('');
const author = ref('');
const publisher = ref('');
const materialType = ref('vse');
const language = ref('vse');
const yearFrom = ref('');
const yearTo = ref('');

// Option values are the `en` names — the backend filters match on metadata.*.en
const materialTypeCodes = ref<ResolvedCode[]>([]);
const languageCodes = ref<ResolvedCode[]>([]);

const typeOptions = computed(() => [
  { label: t('advanced.types.all'), value: 'vse' },
  ...materialTypeCodes.value.map((c) => ({ label: codeLabel(c), value: c.en })),
]);

const languageOptions = computed(() => [
  { label: t('advanced.languages.all'), value: 'vse' },
  ...languageCodes.value.map((c) => ({ label: codeLabel(c), value: c.en })),
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
  materialType.value = 'vse';
  language.value = 'vse';
  yearFrom.value = '';
  yearTo.value = '';
}

async function search() {
  const q = [title.value, author.value].filter((s) => s.trim()).join(' ').trim();
  const from = toYearParam(yearFrom.value);
  const to = toYearParam(yearTo.value);
  await router.push({
    path: '/catalog',
    query: {
      ...(q ? { q } : {}),
      ...(publisher.value.trim() ? { publisher: publisher.value.trim() } : {}),
      ...(materialType.value !== 'vse' ? { materialType: materialType.value } : {}),
      ...(language.value !== 'vse' ? { language: language.value } : {}),
      ...(from ? { yearFrom: from } : {}),
      ...(to ? { yearTo: to } : {}),
    },
  });
}
</script>

<style scoped lang="sass">
@use 'sass:color'

.sub-header
  background: linear-gradient(90deg, $primary 0%, color.adjust($primary, $lightness: -10%) 100%)

.header-kicker
  font-size: 0.72rem
  font-weight: 700
  letter-spacing: 0.14em
  text-transform: uppercase
  color: rgba($paper, 0.6)

.page-body
  max-width: 1024px
  margin: 0 auto

.content-card
  background: $surface
  border: 1px solid $divider
  border-radius: $radius
  box-shadow: 0 4px 20px rgba($dark, 0.06)
</style>
