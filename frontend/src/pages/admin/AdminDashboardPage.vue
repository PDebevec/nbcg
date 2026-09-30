<template>
  <q-page class="adm-page">
    <AdminPageHeader
      :eyebrow="t('admin.dashboard.eyebrow')"
      :title="t('admin.dashboard.title')"
      :caption="today"
    >
      <template #actions>
        <q-btn
          v-if="canImport"
          outline
          no-caps
          color="primary"
          icon="o_cloud_download"
          :label="t('admin.dashboard.runImport')"
          to="/admin/import"
        />
        <q-btn
          v-if="canManageRecords"
          outline
          no-caps
          color="primary"
          icon="o_add"
          :label="t('admin.dashboard.newRecord')"
          to="/admin/items/new?type=RECORD"
        />
        <q-btn
          v-if="canManageDrafts"
          unelevated
          no-caps
          color="primary"
          icon="o_add"
          :label="t('admin.dashboard.newDraft')"
          to="/admin/items/new?type=DRAFT"
        />
      </template>
    </AdminPageHeader>

    <!-- KPI tiles -->
    <div class="kpi-grid q-mb-lg">
      <StatsCard
        v-if="canManageDrafts"
        :title="t('admin.nav.drafts')"
        icon="o_edit_note"
        :counts="stats?.drafts"
        :loading="loading"
        to="/admin/drafts"
      />
      <StatsCard
        v-if="canManageRecords"
        :title="t('admin.nav.records')"
        icon="o_menu_book"
        :counts="stats?.records"
        :loading="loading"
        to="/admin/records"
      />
      <router-link v-if="isStaff" to="/admin/tasks?scope=mine" class="kpi-tile">
        <div class="kpi-tile__head">
          <span>{{ t('admin.dashboard.myTasks') }}</span>
          <q-icon name="o_assignment_turned_in" size="18px" />
        </div>
        <div class="kpi-tile__value">
          <q-skeleton v-if="myTasks === null" type="text" width="48px" />
          <template v-else>{{ formatCount(myTasksTotal) }}</template>
        </div>
        <div class="kpi-tile__legend">
          <span v-if="returnedCount > 0">
            <span class="adm-dot adm-dot--warning" />
            {{ t('admin.dashboard.returnedToYou', { n: returnedCount }) }}
          </span>
          <span>
            <span class="adm-dot adm-dot--info" />
            {{ t('admin.dashboard.nOpen', { n: myTasksTotal }) }}
          </span>
        </div>
      </router-link>
      <div v-if="canManageUsers" class="kpi-tile">
        <div class="kpi-tile__head">
          <span>{{ t('admin.users.title') }}</span>
          <q-icon name="o_group" size="18px" />
        </div>
        <div class="kpi-tile__value">
          <q-skeleton v-if="!syncStatus" type="text" width="48px" />
          <template v-else>{{ formatCount(syncStatus.profileCount) }}</template>
        </div>
        <div class="kpi-tile__legend">
          <span>{{ syncLine }}</span>
        </div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-col">
        <!-- Tasks waiting on me. There are no notifications, so this is the one
             place a person notices that something is waiting for them. -->
        <q-card v-if="isStaff" flat bordered>
          <div class="adm-card__head">
            <h2 class="adm-card__title">{{ t('admin.dashboard.myTasks') }}</h2>
            <q-space />
            <router-link to="/admin/tasks?scope=mine" class="adm-link">
              <span>{{ t('admin.dashboard.openInbox') }}</span>
              <q-icon name="o_arrow_forward" size="16px" />
            </router-link>
          </div>
          <div v-if="myTasks === null" class="q-pa-md">
            <q-skeleton v-for="i in 3" :key="i" type="text" class="q-mb-sm" />
          </div>
          <div v-else-if="myTasks.length === 0" class="adm-empty">
            {{ t('admin.dashboard.myTasksNone') }}
          </div>
          <template v-else>
            <router-link
              v-for="task in myTasks.slice(0, LIST_SIZE)"
              :key="task.id"
              :to="`/admin/tasks/${task.id}`"
              class="adm-row"
            >
              <div class="adm-row__text">
                <span class="adm-row__title">{{ task.title }}</span>
                <span class="adm-row__sub">
                  {{ t(`admin.tasks.kinds.${task.kind}`) }}
                  <template v-if="task.itemType"> · {{ t(`admin.itemType.${task.itemType}`) }}</template>
                  · {{ t('admin.dashboard.filedBy', { name: task.createdByName }) }}
                </span>
              </div>
              <TaskStatusBadge :status="task.status" :returned="task.lastHandoff === 'RETURNED'" />
              <RelativeTime :value="task.updatedAt" class="adm-row__time" />
            </router-link>
            <div v-if="myTasksTotal > LIST_SIZE" class="dash-more">
              {{ t('admin.dashboard.moreInInbox', { n: myTasksTotal - LIST_SIZE }) }}
            </div>
          </template>
        </q-card>

        <!-- Review queue (nice-to-have A4): open review tasks, whoever holds them. Publishers only. -->
        <q-card v-if="canTransition" flat bordered>
          <div class="adm-card__head">
            <h2 class="adm-card__title">{{ t('admin.dashboard.review.title') }}</h2>
            <q-badge v-if="reviewTotal > 0" class="badge-soft badge-soft--sm badge-soft--info">
              {{ reviewTotal }}
            </q-badge>
            <span class="text-caption adm-muted gt-md">{{ t('admin.dashboard.review.caption') }}</span>
            <q-space />
            <router-link to="/admin/tasks?scope=all&kind=REVIEW_PUBLISH" class="adm-link">
              <span>{{ t('admin.dashboard.review.all') }}</span>
              <q-icon name="o_arrow_forward" size="16px" />
            </router-link>
          </div>
          <div v-if="reviewTasks === null" class="q-pa-md">
            <q-skeleton v-for="i in 3" :key="i" type="text" class="q-mb-sm" />
          </div>
          <div v-else-if="reviewTasks.length === 0" class="adm-empty">
            {{ t('admin.dashboard.review.none') }}
          </div>
          <template v-else>
            <router-link
              v-for="task in reviewTasks"
              :key="task.id"
              :to="`/admin/tasks/${task.id}`"
              class="adm-row"
            >
              <div class="adm-row__text">
                <span class="adm-row__title">{{ task.title }}</span>
                <span class="adm-row__sub">
                  <template v-if="task.itemType">{{ t(`admin.itemType.${task.itemType}`) }} · </template>
                  {{
                    task.assignedToUserId === auth.userId
                      ? t('admin.dashboard.review.assignedToYou')
                      : t('admin.dashboard.review.assignedTo', { name: task.assignedToName })
                  }}
                  · {{ t('admin.dashboard.filedBy', { name: task.createdByName }) }}
                </span>
              </div>
              <TaskStatusBadge :status="task.status" :returned="task.lastHandoff === 'RETURNED'" />
              <RelativeTime :value="task.updatedAt" class="adm-row__time" />
            </router-link>
            <div class="dash-more">
              <template v-if="reviewTotal > reviewTasks.length">
                {{ t('admin.dashboard.review.more', { n: reviewTotal - reviewTasks.length }) }} ·
              </template>
              {{ t('admin.dashboard.review.publishersOnly') }}
            </div>
          </template>
        </q-card>
      </div>

      <div class="dash-col">
        <!-- Recently opened (nice-to-have A3b): kept in this browser -->
        <q-card flat bordered>
          <div class="adm-card__head">
            <h2 class="adm-card__title">{{ t('admin.dashboard.recent.title') }}</h2>
            <span class="text-caption adm-muted">{{ t('admin.dashboard.recent.caption') }}</span>
          </div>
          <div v-if="recent.length === 0" class="adm-empty">{{ t('admin.dashboard.recent.none') }}</div>
          <router-link
            v-for="item in recent"
            :key="item.id"
            :to="`/admin/items/${item.id}`"
            class="adm-row recent-row"
          >
            <q-badge
              v-if="item.itemType"
              class="badge-soft badge-soft--sm"
              :class="item.itemType === 'RECORD' ? 'badge-soft--positive' : 'badge-soft--warning'"
            >
              {{ t(`admin.itemType.${item.itemType}`) }}
            </q-badge>
            <span class="recent-row__title ellipsis">{{ item.title || '—' }}</span>
            <RelativeTime :value="item.openedAt" class="adm-row__time" />
          </router-link>
        </q-card>

        <q-card flat bordered>
          <div class="adm-card__body column q-gutter-y-md">
            <h2 class="adm-card__title">{{ t('admin.dashboard.glance') }}</h2>
            <div v-for="row in glanceRows" :key="row.key" class="column q-gutter-y-sm">
              <div class="row justify-between text-caption">
                <span class="text-weight-bold">{{ row.label }}</span>
                <span class="adm-muted">{{ formatCount(row.total) }}</span>
              </div>
              <div class="glance-bar">
                <div
                  v-for="part in row.parts"
                  :key="part.status"
                  :class="`glance-bar__part glance-bar__part--${part.status}`"
                  :style="{ flexGrow: part.count }"
                />
              </div>
            </div>
            <div class="row q-gutter-x-md text-caption adm-muted">
              <span v-for="status in VISIBILITY_STATUSES" :key="status" class="row items-center q-gutter-x-xs">
                <span class="adm-dot" :class="DOT_CLASS[status]" />
                <span>{{ t(`admin.visibility.${status}`) }}</span>
              </span>
            </div>
          </div>
        </q-card>

        <!-- User directory sync. Worth surfacing: a sync failing silently for a
             week is otherwise invisible until the user picker is mysteriously empty. -->
        <q-card v-if="canManageUsers" flat bordered>
          <div class="adm-card__body column q-gutter-y-md">
            <h2 class="adm-card__title">{{ t('admin.users.title') }}</h2>
            <div v-if="syncStatus" class="column">
              <span>{{ syncLine }}</span>
              <span class="text-caption adm-muted">
                {{ t('admin.users.profileCount', { count: syncStatus.profileCount }) }}
              </span>
              <span v-if="syncStatus.lastError" class="text-caption text-negative q-mt-xs">
                {{
                  t('admin.users.lastError', {
                    when: formatDateTime(syncStatus.lastError.at, locale),
                    message: syncStatus.lastError.message,
                  })
                }}
              </span>
            </div>
            <div>
              <q-btn
                outline
                no-caps
                color="primary"
                icon="o_sync"
                :loading="syncTriggering || syncStatus?.running"
                :label="t('admin.users.refresh')"
                @click="runUserSync"
              />
            </div>
          </div>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { getItemStats, VISIBILITY_STATUSES, type ItemStats, type VisibilityStatus } from 'src/api/admin';
import { getUserSyncStatus, triggerUserSync, type UserSyncStatus } from 'src/api/users';
import { listTasks, type Task } from 'src/api/tasks';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { dateLocale, formatCount, formatDateTime } from 'src/utils/adminFormat';
import { recentItems } from 'src/utils/recentItems';
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import RelativeTime from 'src/components/admin/RelativeTime.vue';
import StatsCard from 'src/components/admin/StatsCard.vue';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';

const { t, locale } = useI18n();
const $q = useQuasar();
const {
  canManageRecords,
  canManageDrafts,
  canTransition,
  canImport,
  canManageUsers,
  isStaff,
} = useAuthz();

const LIST_SIZE = 5;
const REVIEW_SIZE = 3;

const DOT_CLASS: Record<VisibilityStatus, string> = {
  PUBLIC: 'adm-dot--positive',
  PRIVATE: 'adm-dot--warning',
  HIDDEN: '',
};

const today = computed(() =>
  new Date().toLocaleDateString(dateLocale(locale.value), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
);

const stats = ref<ItemStats | null>(null);
const loading = ref(true);

// ── Tasks waiting on me ──

/** null while loading. Returned tasks first, then the most recently touched. */
const myTasks = ref<Task[] | null>(null);
const myTasksTotal = ref(0);

const returnedCount = computed(
  () => (myTasks.value ?? []).filter((task) => task.lastHandoff === 'RETURNED').length,
);

async function loadMyTasks() {
  try {
    const result = await listTasks({ assignedTo: 'me', status: 'OPEN', limit: 200 });
    myTasksTotal.value = result.total;
    myTasks.value = [...result.tasks].sort(
      (a, b) =>
        Number(b.lastHandoff === 'RETURNED') - Number(a.lastHandoff === 'RETURNED') ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  } catch {
    myTasks.value = [];
    $q.notify({ type: 'negative', message: t('admin.dashboard.myTasksFailed') });
  }
}

// ── Review queue ──

const reviewTasks = ref<Task[] | null>(null);
const reviewTotal = ref(0);

async function loadReviewQueue() {
  try {
    const result = await listTasks({ status: 'OPEN', kind: 'REVIEW_PUBLISH', limit: REVIEW_SIZE });
    reviewTasks.value = result.tasks;
    reviewTotal.value = result.total;
  } catch {
    // The card is an extra; the inbox still shows these tasks.
    reviewTasks.value = [];
  }
}

// ── Recently opened ──

const recent = computed(() => recentItems(auth.userId).slice(0, 5));

// ── Catalogue at a glance ──

const glanceRows = computed(() =>
  (
    [
      { key: 'records', label: t('admin.nav.records'), show: canManageRecords.value },
      { key: 'drafts', label: t('admin.nav.drafts'), show: canManageDrafts.value },
    ] as const
  )
    .filter((row) => row.show)
    .map((row) => {
      const counts = stats.value?.[row.key];
      const parts = VISIBILITY_STATUSES.map((status) => ({ status, count: counts?.[status] ?? 0 }));
      return {
        key: row.key,
        label: row.label,
        total: parts.reduce((sum, p) => sum + p.count, 0),
        parts: parts.filter((p) => p.count > 0),
      };
    }),
);

// ── User directory sync ──

const syncStatus = ref<UserSyncStatus | null>(null);
const syncTriggering = ref(false);
let syncPollTimer: ReturnType<typeof setTimeout> | undefined;

const syncLine = computed(() => {
  const status = syncStatus.value;
  if (!status) return '';
  if (status.running) return t('admin.users.syncRunning');
  if (status.lastRun) {
    return t('admin.users.lastSync', { when: formatDateTime(status.lastRun.finishedAt, locale.value) });
  }
  return t('admin.users.neverSynced');
});

async function loadSyncStatus() {
  try {
    syncStatus.value = await getUserSyncStatus();
  } catch {
    $q.notify({ type: 'negative', message: t('admin.users.statusFailed') });
  }
}

// The sync runs in a queue worker; poll until it reports done so the card does
// not show a stale "last synced" from before the click.
function pollSyncStatus(attempt = 0) {
  clearTimeout(syncPollTimer);
  syncPollTimer = setTimeout(() => {
    void loadSyncStatus().then(() => {
      if (syncStatus.value?.running && attempt < 30) pollSyncStatus(attempt + 1);
    });
  }, 2000);
}

async function runUserSync() {
  syncTriggering.value = true;
  try {
    await triggerUserSync();
    $q.notify({ type: 'positive', message: t('admin.users.syncQueued') });
    pollSyncStatus();
  } catch {
    $q.notify({ type: 'negative', message: t('admin.users.syncFailed') });
  } finally {
    syncTriggering.value = false;
  }
}

onBeforeUnmount(() => clearTimeout(syncPollTimer));

onMounted(async () => {
  if (canManageUsers.value) void loadSyncStatus();
  if (isStaff.value) void loadMyTasks();
  if (canTransition.value) void loadReviewQueue();
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
.kpi-grid
  display: grid
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))
  gap: 16px

.dash-grid
  display: grid
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr)
  gap: 24px
  align-items: start

.dash-col
  display: flex
  flex-direction: column
  gap: 24px
  min-width: 0

.dash-more
  padding: 10px 20px
  border-top: 1px solid $divider-soft
  font-size: 12px
  color: $muted

.recent-row
  gap: 12px
  padding: 10px 20px

.recent-row__title
  flex: 1 1 auto
  min-width: 0
  font-size: 14px
  font-weight: 600

.glance-bar
  display: flex
  gap: 2px
  height: 10px
  border-radius: 999px
  overflow: hidden
  background: $divider-soft

.glance-bar__part
  flex-basis: 0

.glance-bar__part--PUBLIC
  background: $positive

.glance-bar__part--PRIVATE
  background: $warning

.glance-bar__part--HIDDEN
  background: #9A9182

@media (max-width: 1100px)
  .dash-grid
    grid-template-columns: minmax(0, 1fr)
</style>
