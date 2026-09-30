<template>
  <q-page class="adm-page stats-page">
    <AdminPageHeader
      :eyebrow="t('admin.nav.groupInsight')"
      :title="t('admin.stats.title')"
      :caption="`${rangeLabel} · ${t('admin.stats.days', { count: rangeDays })}`"
    >
      <!-- Date range: one control above everything it scopes. Presets first, a custom range behind the picker. -->
      <template #actions>
        <q-btn-toggle
          :model-value="activePreset"
          :options="presetOptions"
          unelevated
          no-caps
          dense
          color="transparent"
          text-color="grey-9"
          toggle-color="white"
          toggle-text-color="primary"
          class="preset-toggle"
          @update:model-value="applyPreset"
        />
        <q-btn outline no-caps color="primary" icon="o_event" :label="rangeLabel" class="range-btn">
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
        </q-btn>
      </template>
    </AdminPageHeader>

    <!-- Refetch keeps the frame: previous render stays, dimmed, no layout jump -->
    <div class="stats-sections" :class="{ refetching: loading }">
      <!-- ── Activity ── -->
      <section class="stats-section">
        <h2 class="section-title">{{ t('admin.stats.activity') }}</h2>
        <div class="tile-grid">
          <StatTile
            v-for="(key, index) in ACTIVITY_KEYS"
            :key="key"
            :label="t(`admin.stats.tiles.${key}`)"
            :value="overview?.activity.totals[key] ?? 0"
            :loading="!overview"
            :color="SERIES_COLORS[index]"
          />
        </div>
        <q-card flat bordered>
          <div class="chart-card">
            <DayCountChart
              :series="activitySeries"
              :from="range.from"
              :to="range.to"
              :empty-label="t('admin.stats.noData')"
            />
          </div>
        </q-card>
      </section>

      <!-- ── Usage ── -->
      <section class="stats-section">
        <h2 class="section-title">{{ t('admin.stats.usage') }}</h2>
        <div class="tile-grid">
          <StatTile
            :label="t('admin.stats.tiles.views')"
            :value="overview?.usage.totals.views ?? 0"
            :loading="!overview"
            :color="SERIES_COLORS[0]"
          />
          <StatTile
            :label="t('admin.stats.tiles.downloads')"
            :value="overview?.usage.totals.downloads ?? 0"
            :loading="!overview"
            :color="SERIES_COLORS[1]"
          />
        </div>
        <q-card flat bordered>
          <div class="chart-card">
            <DayCountChart
              :series="usageSeries"
              :from="range.from"
              :to="range.to"
              :empty-label="t('admin.stats.noData')"
            />
          </div>
        </q-card>
      </section>

      <!-- ── Per user ── -->
      <section class="stats-section">
        <h2 class="section-title">{{ t('admin.stats.byUser') }}</h2>
        <q-table
          :rows="userStats?.users ?? []"
          :columns="userColumns"
          row-key="userId"
          flat
          bordered
          hide-pagination
          :pagination="{ rowsPerPage: 0, sortBy: 'total', descending: true }"
          :loading="loading && !userStats"
          class="admin-table users-table"
        >
          <template #body-cell-displayName="cellProps">
            <q-td :props="cellProps">
              <div class="row items-center no-wrap q-gutter-x-sm">
                <UserAvatar :name="cellProps.value" :size="26" />
                <span class="text-weight-medium">{{ cellProps.value }}</span>
              </div>
            </q-td>
          </template>
          <template #body-cell-total="cellProps">
            <q-td :props="cellProps" class="text-weight-bold">{{ formatCount(cellProps.value) }}</q-td>
          </template>
          <template #no-data>
            <div class="full-width adm-empty">{{ t('admin.stats.usersEmpty') }}</div>
          </template>
        </q-table>
      </section>

      <!-- ── Top items / files ── -->
      <section class="stats-section">
        <h2 class="section-title">{{ t('admin.stats.topItems') }}</h2>
        <div class="top-grid">
          <TopList :title="t('admin.stats.mostViewed')" icon="o_visibility" :rows="topViewedRows" />
          <TopList :title="t('admin.stats.mostDownloaded')" icon="o_download" :rows="topDownloadedRows" />
          <TopList :title="t('admin.stats.topFiles')" icon="o_description" :rows="topFileRows" />
        </div>
      </section>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableColumn } from 'quasar';
import { dateLocale, formatCount } from 'src/utils/adminFormat';
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
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';

const { t, locale } = useI18n();
const $q = useQuasar();

// Chart series wear the brand tokens, in a fixed slot order: $primary,
// $secondary, $accent, $warning. Marks only; text stays in ink tokens.
const SERIES_COLORS = ['#1F2A52', '#B5652C', '#5C7A63', '#B5862C'];

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
    new Date(`${day}T00:00:00Z`).toLocaleDateString(dateLocale(locale.value), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return `${fmt(from.value)} – ${fmt(to.value)}`;
});

const rangeDays = computed(
  () => (Date.parse(`${to.value}T00:00:00Z`) - Date.parse(`${from.value}T00:00:00Z`)) / DAY_MS + 1,
);

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
.stats-page
  padding-bottom: 96px

.stats-sections
  display: flex
  flex-direction: column
  gap: 32px

.stats-section
  display: flex
  flex-direction: column
  gap: 16px

.section-title
  margin: 0
  font-size: 17px
  line-height: 1.3
  font-weight: 700
  letter-spacing: 0

.tile-grid
  display: grid
  grid-template-columns: repeat(4, minmax(0, 1fr))
  gap: 16px

.top-grid
  display: grid
  grid-template-columns: repeat(3, minmax(0, 1fr))
  gap: 16px

.chart-card
  padding: 16px 20px 12px

.users-table
  :deep(tbody td)
    height: 48px
    font-variant-numeric: tabular-nums

.preset-toggle
  padding: 3px
  background: $paper-deep
  border: 1px solid $divider
  border-radius: $radius
  :deep(.q-btn)
    min-height: 36px
    padding: 0 14px
    border-radius: 6px !important
    font-size: 13px
    color: $ink-soft

  :deep(.q-btn.bg-white)
    font-weight: 700
    box-shadow: 0 1px 2px rgba(28, 26, 21, 0.12)

.range-btn
  font-weight: 400
  color: $ink !important

.refetching
  opacity: 0.55
  transition: opacity 0.2s

@media (max-width: 1100px)
  .tile-grid
    grid-template-columns: repeat(2, minmax(0, 1fr))

  .top-grid
    grid-template-columns: minmax(0, 1fr)
</style>
