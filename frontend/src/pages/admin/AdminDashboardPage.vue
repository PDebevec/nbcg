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

      <!-- Tasks waiting on me. There are no notifications, so this is the one
           place a person notices that something is waiting for them. -->
      <template v-if="isStaff">
        <h2 class="text-subtitle1 text-weight-bold q-mt-xl q-mb-md">
          {{ t('admin.dashboard.myTasks') }}
        </h2>
        <q-card flat bordered class="tasks-card">
          <q-card-section class="row items-center q-gutter-md">
            <div class="col">
              <div v-if="myTasks === null" class="text-body2 text-library-muted">
                <q-skeleton type="text" width="200px" />
              </div>
              <div v-else-if="myTasks.length === 0" class="text-body2 text-library-muted">
                {{ t('admin.dashboard.myTasksNone') }}
              </div>
              <template v-else>
                <div class="text-body2 q-mb-sm">
                  {{ t('admin.dashboard.myTasksCount', { count: myTasks.length }) }}
                </div>
                <q-list dense>
                  <q-item
                    v-for="task in myTasks.slice(0, 5)"
                    :key="task.id"
                    clickable
                    :to="`/admin/tasks/${task.id}`"
                    class="rounded-borders"
                  >
                    <q-item-section>
                      <q-item-label>{{ task.title }}</q-item-label>
                      <q-item-label caption>
                        {{ t(`admin.tasks.kinds.${task.kind}`) }} · {{ task.createdByName }}
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <TaskStatusBadge :status="task.status" />
                    </q-item-section>
                  </q-item>
                </q-list>
              </template>
            </div>
            <q-btn
              outline
              no-caps
              color="primary"
              icon="assignment"
              :label="t('admin.dashboard.openInbox')"
              to="/admin/tasks?scope=mine"
            />
          </q-card-section>
        </q-card>
      </template>

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

      <!-- User directory sync. Worth surfacing: a sync failing silently for a
           week is otherwise invisible until the user picker is mysteriously empty. -->
      <template v-if="canManageUsers">
        <h2 class="text-subtitle1 text-weight-bold q-mt-xl q-mb-md">
          {{ t('admin.users.title') }}
        </h2>
        <q-card flat bordered class="users-card">
          <q-card-section class="row items-center q-gutter-md">
            <div class="col">
              <div v-if="syncStatus" class="text-body2">
                <template v-if="syncStatus.running">
                  {{ t('admin.users.syncRunning') }}
                </template>
                <template v-else-if="syncStatus.lastRun">
                  {{
                    t('admin.users.lastSync', {
                      when: new Date(syncStatus.lastRun.finishedAt).toLocaleString(),
                    })
                  }}
                </template>
                <template v-else>{{ t('admin.users.neverSynced') }}</template>
              </div>
              <div v-if="syncStatus" class="text-caption text-library-muted">
                {{ t('admin.users.profileCount', { count: syncStatus.profileCount }) }}
              </div>
              <div v-if="syncStatus?.lastError" class="text-caption text-negative q-mt-xs">
                {{
                  t('admin.users.lastError', {
                    when: new Date(syncStatus.lastError.at).toLocaleString(),
                    message: syncStatus.lastError.message,
                  })
                }}
              </div>
            </div>
            <q-btn
              outline
              no-caps
              color="primary"
              icon="sync"
              :loading="syncTriggering || syncStatus?.running"
              :label="t('admin.users.refresh')"
              @click="runUserSync"
            />
          </q-card-section>
        </q-card>
      </template>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { getItemStats, type ItemStats } from 'src/api/admin';
import { getUserSyncStatus, triggerUserSync, type UserSyncStatus } from 'src/api/users';
import { ACTIVE_TASK_STATUSES, listTasks, type Task } from 'src/api/tasks';
import { useAuthz } from 'src/composables/useAuthz';
import StatsCard from 'src/components/admin/StatsCard.vue';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';

const { t } = useI18n();
const $q = useQuasar();
const { canManageRecords, canManageDrafts, canImport, canManageUsers, isStaff } = useAuthz();

const stats = ref<ItemStats | null>(null);
const loading = ref(true);

// ── Tasks waiting on me ──

/** null while loading; the active subset of what is assigned to me. */
const myTasks = ref<Task[] | null>(null);

async function loadMyTasks() {
  try {
    const result = await listTasks({ assignedTo: 'me', limit: 200 });
    myTasks.value = result.tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  } catch {
    myTasks.value = [];
    $q.notify({ type: 'negative', message: t('admin.dashboard.myTasksFailed') });
  }
}

// ── User directory sync ──

const syncStatus = ref<UserSyncStatus | null>(null);
const syncTriggering = ref(false);
let syncPollTimer: ReturnType<typeof setTimeout> | undefined;

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

.users-card,
.tasks-card
  background: $surface
  border-radius: $radius
</style>
