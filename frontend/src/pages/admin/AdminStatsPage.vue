<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <h1 class="text-h5 text-weight-bold q-mt-none q-mb-md">{{ t('admin.stats.title') }}</h1>

      <!-- Date range: one row above everything it scopes. Presets first, custom range behind the picker. -->
      <div class="row items-center q-gutter-md q-mb-lg">
        <q-btn-toggle
          :model-value="activePreset"
          :options="presetOptions"
          unelevated
          no-caps
          dense
          toggle-color="primary"
          class="preset-toggle"
          @update:model-value="applyPreset"
        />
        <q-input
          :model-value="rangeLabel"
          dense
          outlined
          readonly
          :label="t('admin.stats.period')"
          class="range-input cursor-pointer"
        >
          <template #prepend>
            <q-icon name="event" color="primary" />
          </template>
          <q-popup-proxy transition-show="scale" transition-hide="scale">
            <q-date
              :model-value="{ from, to }"
              range
              mask="YYYY-MM-DD"
              minimal
              color="primary"
              @update:model-value="onDatePick"
            />
          </q-popup-proxy>
        </q-input>
      </div>

      <!-- Refetch keeps the frame: previous render stays, dimmed, no layout jump -->
      <div :class="{ refetching: loading }">
        <!-- ── Activity ── -->
        <h2 class="section-title">{{ t('admin.stats.activity') }}</h2>
        <div class="row q-gutter-sm q-mb-md">
          <StatTile
            v-for="key in ACTIVITY_KEYS"
            :key="key"
            :label="t(`admin.stats.tiles.${key}`)"
            :value="overview?.activity.totals[key] ?? 0"
            :loading="!overview"
          />
        </div>
        <q-card flat bordered class="chart-card q-mb-xl">
          <q-card-section>
            <DayCountChart
              :series="activitySeries"
              :from="range.from"
              :to="range.to"
              :empty-label="t('admin.stats.noData')"
            />
          </q-card-section>
        </q-card>

        <!-- ── Usage ── -->
        <h2 class="section-title">{{ t('admin.stats.usage') }}</h2>
        <div class="row q-gutter-sm q-mb-md">
          <StatTile
            :label="t('admin.stats.tiles.views')"
            :value="overview?.usage.totals.views ?? 0"
            :loading="!overview"
          />
          <StatTile
            :label="t('admin.stats.tiles.downloads')"
            :value="overview?.usage.totals.downloads ?? 0"
            :loading="!overview"
          />
        </div>
        <q-card flat bordered class="chart-card q-mb-xl">
          <q-card-section>
            <DayCountChart
              :series="usageSeries"
              :from="range.from"
              :to="range.to"
              :empty-label="t('admin.stats.noData')"
            />
          </q-card-section>
        </q-card>

        <!-- ── Per user ── -->
        <h2 class="section-title">{{ t('admin.stats.byUser') }}</h2>
        <q-table
          :rows="userStats?.users ?? []"
          :columns="userColumns"
          row-key="userId"
          flat
          bordered
          dense
          hide-pagination
          :pagination="{ rowsPerPage: 0 }"
          :loading="loading && !userStats"
          class="stats-table q-mb-xl"
        >
          <template #no-data>
            <div class="full-width text-center q-pa-md text-library-muted">
              {{ t('admin.stats.usersEmpty') }}
            </div>
          </template>
        </q-table>

        <!-- ── Top items / files ── -->
        <h2 class="section-title">{{ t('admin.stats.topItems') }}</h2>
        <div class="row q-col-gutter-md">
          <div class="col-12 col-md-4">
            <TopList
              :title="t('admin.stats.mostViewed')"
              icon="visibility"
              :rows="topViewedRows"
            />
          </div>
          <div class="col-12 col-md-4">
            <TopList
              :title="t('admin.stats.mostDownloaded')"
              icon="download"
              :rows="topDownloadedRows"
            />
          </div>
          <div class="col-12 col-md-4">
            <TopList
              :title="t('admin.stats.topFiles')"
              icon="description"
              :rows="topFileRows"
            />
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableColumn } from 'quasar';
import {
  getStatsOverview,
  getTopItems,
  getUserStats,
  type StatsOverview,
  type TopItems,
  type UserStats,
  type UserTotals,
} from 'src/api/admin';
import DayCountChart, { type ChartSeries } from 'src/components/admin/DayCountChart.vue';
import StatTile from 'src/components/admin/StatTile.vue';
import TopList, { type TopListRow } from 'src/components/admin/TopList.vue';

const { t } = useI18n();
const $q = useQuasar();

// Categorical palette, fixed slot order (validated against the app surface —
// see docs in the task file). Marks only; text stays in ink tokens.
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

const ACTIVITY_KEYS = ['created', 'published', 'updated', 'deleted'] as const;

const DAY_MS = 86_400_000;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return utcDay(new Date(Date.now() - days * DAY_MS));
}

// ── Range state ──

const from = ref(daysAgo(29));
const to = ref(daysAgo(0));

/** The range the loaded data actually covers (server echo) — drives the chart axis. */
const range = ref({ from: from.value, to: to.value });

const presets = [
  { key: 'last7', days: 7 },
  { key: 'last30', days: 30 },
  { key: 'last90', days: 90 },
  { key: 'lastYear', days: 365 },
];

const presetOptions = computed(() =>
  presets.map((p) => ({ label: t(`admin.stats.presets.${p.key}`), value: p.key })),
);

const activePreset = computed(() => {
  const match = presets.find((p) => from.value === daysAgo(p.days - 1) && to.value === daysAgo(0));
  return match?.key ?? null;
});

function applyPreset(key: string) {
  const preset = presets.find((p) => p.key === key);
  if (!preset) return;
  setRange(daysAgo(preset.days - 1), daysAgo(0));
}

const rangeLabel = computed(() => {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return `${fmt(from.value)} – ${fmt(to.value)}`;
});

/** QDate emits a string for a single-day pick, an object for a range, null mid-selection. */
function onDatePick(value: string | { from: string; to: string } | null) {
  if (!value) return;
  if (typeof value === 'string') setRange(value, value);
  else setRange(value.from, value.to);
}

function setRange(nextFrom: string, nextTo: string) {
  if (!nextFrom || !nextTo) return;
  if (nextFrom > nextTo) {
    $q.notify({ type: 'negative', message: t('admin.stats.invalidRange') });
    return;
  }
  const days = (Date.parse(`${nextTo}T00:00:00Z`) - Date.parse(`${nextFrom}T00:00:00Z`)) / DAY_MS + 1;
  if (days > 366) {
    $q.notify({ type: 'negative', message: t('admin.stats.rangeTooWide') });
    return;
  }
  from.value = nextFrom;
  to.value = nextTo;
  void load();
}

// ── Data ──

const overview = ref<StatsOverview | null>(null);
const userStats = ref<UserStats | null>(null);
const topItems = ref<TopItems | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  const params = { from: from.value, to: to.value };
  try {
    const [ov, us, top] = await Promise.all([
      getStatsOverview(params),
      getUserStats(params),
      getTopItems(params),
    ]);
    overview.value = ov;
    userStats.value = us;
    topItems.value = top;
    range.value = ov.range;
  } catch (err) {
    const detail =
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: detail ? String(detail) : t('admin.stats.loadFailed'),
    });
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// ── Charts ──

const activitySeries = computed<ChartSeries[]>(() =>
  ACTIVITY_KEYS.map((key, i) => ({
    label: t(`admin.stats.tiles.${key}`),
    color: SERIES_COLORS[i]!,
    data: overview.value?.activity[key] ?? [],
  })),
);

const usageSeries = computed<ChartSeries[]>(() => [
  {
    label: t('admin.stats.tiles.views'),
    color: SERIES_COLORS[0]!,
    data: overview.value?.usage.views ?? [],
  },
  {
    label: t('admin.stats.tiles.downloads'),
    color: SERIES_COLORS[1]!,
    data: overview.value?.usage.downloads ?? [],
  },
]);

// ── Tables ──

const userColumns = computed<QTableColumn<UserTotals>[]>(() => [
  {
    name: 'displayName',
    label: t('admin.stats.columns.user'),
    field: 'displayName',
    align: 'left',
    sortable: true,
  },
  { name: 'created', label: t('admin.stats.columns.created'), field: 'created', align: 'right', sortable: true },
  { name: 'published', label: t('admin.stats.columns.published'), field: 'published', align: 'right', sortable: true },
  { name: 'edited', label: t('admin.stats.columns.edited'), field: 'edited', align: 'right', sortable: true },
  { name: 'deleted', label: t('admin.stats.columns.deleted'), field: 'deleted', align: 'right', sortable: true },
  { name: 'total', label: t('admin.stats.columns.total'), field: 'total', align: 'right', sortable: true },
]);

// A null title/filename is a deleted item whose counts are still real — rendered
// as "deleted", never filtered out, or the list stops adding up.
const topViewedRows = computed<TopListRow[]>(() =>
  (topItems.value?.mostViewed ?? []).map((item) => ({
    key: item.itemId,
    label: item.title ?? t('admin.stats.deletedItem'),
    deleted: item.title === null,
    count: item.count,
    to: item.title === null ? undefined : `/admin/items/${item.itemId}`,
  })),
);

const topDownloadedRows = computed<TopListRow[]>(() =>
  (topItems.value?.mostDownloaded ?? []).map((item) => ({
    key: item.itemId,
    label: item.title ?? t('admin.stats.deletedItem'),
    deleted: item.title === null,
    count: item.count,
    to: item.title === null ? undefined : `/admin/items/${item.itemId}`,
  })),
);

const topFileRows = computed<TopListRow[]>(() =>
  (topItems.value?.topFiles ?? []).map((file) => ({
    key: file.fileId,
    label: file.filename ?? t('admin.stats.deletedFile'),
    deleted: file.filename === null,
    count: file.count,
    to: `/admin/items/${file.itemId}`,
  })),
);
</script>

<style scoped lang="sass">
.page-body
  max-width: 1280px
  margin: 0 auto
  padding-bottom: 128px

.section-title
  font-size: 1rem
  font-weight: 700
  margin: 0 0 12px

.chart-card,
.stats-table
  background: $surface
  border-radius: $radius

.preset-toggle
  background: $surface
  border: 1px solid $divider
  border-radius: $radius
  :deep(.q-btn)
    padding: 4px 14px
    font-weight: 500

.range-input
  width: 250px
  :deep(.q-field__control)
    background: $surface

.refetching
  opacity: 0.55
  transition: opacity 0.2s
</style>
