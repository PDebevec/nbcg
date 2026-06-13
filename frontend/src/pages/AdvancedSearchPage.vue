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
            v-model="materialType"
            :options="typeOptions"
            outlined dense emit-value map-options
            :label="t('advanced.materialType')"
            class="col-12 col-md-6"
          />
          <q-input v-model="yearFrom" outlined dense :label="t('advanced.yearFrom')" type="number" class="col-6 col-md-3" />
          <q-input v-model="yearTo" outlined dense :label="t('advanced.yearTo')" type="number" class="col-6 col-md-3" />
        </div>

        <div class="row justify-end q-gutter-sm q-mt-lg">
          <q-btn flat no-caps color="negative" :label="t('common.reset')" icon="restart_alt" @click="reset" />
          <q-btn unelevated no-caps color="secondary" text-color="white" :label="t('common.search')" icon="search" @click="search" />
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

const router = useRouter();
const { t } = useI18n();

const title = ref('');
const author = ref('');
const materialType = ref('vse');
const yearFrom = ref('');
const yearTo = ref('');

const typeOptions = computed(() => [
  { label: t('advanced.types.all'),         value: 'vse' },
  { label: t('advanced.types.books'),       value: 'Monograph' },
  { label: t('advanced.types.periodicals'), value: 'Serial publication' },
  { label: t('advanced.types.manuscripts'), value: 'Manuscript' },
  { label: t('advanced.types.maps'),        value: 'Map' },
  { label: t('advanced.types.music'),       value: 'Sound recording' },
  { label: t('advanced.types.visual'),      value: 'Visual material' },
]);

function reset() {
  title.value = '';
  author.value = '';
  materialType.value = 'vse';
  yearFrom.value = '';
  yearTo.value = '';
}

async function search() {
  const q = [title.value, author.value].filter((s) => s.trim()).join(' ').trim();
  await router.push({
    path: '/catalog',
    query: {
      ...(q ? { q } : {}),
      ...(materialType.value !== 'vse' ? { materialType: materialType.value } : {}),
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
  background: $paper
  border: 1px solid $divider
  border-radius: 16px
  box-shadow: 0 4px 20px rgba($dark, 0.06)
</style>
