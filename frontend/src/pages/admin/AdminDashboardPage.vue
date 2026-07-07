<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <h1 class="text-h5 text-weight-bold q-mt-none q-mb-lg">{{ t('admin.dashboard.title') }}</h1>

      <div class="row q-col-gutter-lg">
        <div v-if="canManageDrafts" class="col-12 col-md-6">
          <StatsCard
            :title="t('admin.nav.drafts')"
            icon="edit_note"
            :counts="stats?.drafts"
            :loading="loading"
            to="/admin/drafts"
          />
        </div>
        <div v-if="canManageRecords" class="col-12 col-md-6">
          <StatsCard
            :title="t('admin.nav.records')"
            icon="library_books"
            :counts="stats?.records"
            :loading="loading"
            to="/admin/records"
          />
        </div>
      </div>

      <h2 class="text-subtitle1 text-weight-bold q-mt-xl q-mb-md">
        {{ t('admin.dashboard.quickActions') }}
      </h2>
      <div class="row q-gutter-sm">
        <q-btn
          v-if="canManageDrafts"
          unelevated
          no-caps
          color="primary"
          icon="add"
          :label="t('admin.dashboard.newDraft')"
          to="/admin/items/new?type=DRAFT"
        />
        <q-btn
          v-if="canManageRecords"
          unelevated
          no-caps
          color="primary"
          icon="add"
          :label="t('admin.dashboard.newRecord')"
          to="/admin/items/new?type=RECORD"
        />
        <q-btn
          v-if="canImport"
          outline
          no-caps
          color="primary"
          icon="cloud_download"
          :label="t('admin.dashboard.runImport')"
          to="/admin/import"
        />
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { getItemStats, type ItemStats } from 'src/api/admin';
import { useAuthz } from 'src/composables/useAuthz';
import StatsCard from 'src/components/admin/StatsCard.vue';

const { t } = useI18n();
const $q = useQuasar();
const { canManageRecords, canManageDrafts, canImport } = useAuthz();

const stats = ref<ItemStats | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    stats.value = await getItemStats();
  } catch {
    $q.notify({ type: 'negative', message: t('admin.dashboard.statsFailed') });
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped lang="sass">
.page-body
  max-width: 1280px
  margin: 0 auto
</style>
