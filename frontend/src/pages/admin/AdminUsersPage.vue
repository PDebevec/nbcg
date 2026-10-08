<template>
  <q-page class="adm-page">
    <AdminPageHeader
      :eyebrow="t('admin.nav.groupAdmin')"
      :title="t('admin.users.pageTitle')"
      :caption="t('admin.users.caption')"
    >
      <template #actions>
        <q-btn
          outline
          no-caps
          color="primary"
          icon="o_sync"
          :loading="syncTriggering || syncStatus?.running"
          :label="t('admin.users.refresh')"
          @click="runUserSync"
        />
      </template>
    </AdminPageHeader>

    <!-- Directory sync. Worth surfacing: a sync failing silently for a week is
         otherwise invisible until the user picker is mysteriously empty. -->
    <q-card v-if="syncStatus" flat bordered class="sync-bar">
      <q-icon name="o_sync" size="18px" class="adm-muted" />
      <span>{{ syncLine }}</span>
      <span class="adm-muted">· {{ t('admin.users.profileCount', { count: syncStatus.profileCount }) }}</span>
      <span v-if="syncStatus.lastError" class="text-negative sync-bar__error">
        {{
          t('admin.users.lastError', {
            when: formatDateTime(syncStatus.lastError.at, locale),
            message: syncStatus.lastError.message,
          })
        }}
      </span>
    </q-card>

    <q-table
      v-model:pagination="pagination"
      :rows="filteredUsers"
      :columns="columns"
      :loading="loading"
      row-key="userId"
      flat
      bordered
      :rows-per-page-options="[20, 50, 100, 0]"
      class="admin-table users-table"
    >
      <template #top>
        <div class="full-width column">
          <div class="row items-center q-gutter-md">
            <q-input
              v-model="query"
              dense
              outlined
              clearable
              debounce="200"
              :placeholder="t('admin.users.searchPlaceholder')"
              class="col users-search"
            >
              <template #prepend><q-icon name="o_search" /></template>
            </q-input>
            <q-toggle v-model="showInactive" dense :label="t('admin.users.showInactive')" />
          </div>
          <div class="users-summary">{{ t('admin.users.results', { count: filteredUsers.length }) }}</div>
        </div>
      </template>

      <template #body-cell-user="cellProps">
        <q-td :props="cellProps">
          <div class="row items-center no-wrap q-gutter-x-md">
            <UserAvatar :name="cellProps.row.displayName" :size="34" />
            <div class="column user-cell">
              <span class="user-cell__name ellipsis">{{ cellProps.row.displayName }}</span>
              <span class="user-cell__sub ellipsis adm-mono">{{ cellProps.row.username }}</span>
            </div>
          </div>
        </q-td>
      </template>

      <template #body-cell-email="cellProps">
        <q-td :props="cellProps">
          <a v-if="cellProps.value" :href="`mailto:${cellProps.value}`" class="adm-link">{{ cellProps.value }}</a>
          <span v-else class="adm-muted">—</span>
        </q-td>
      </template>

      <template #body-cell-role="cellProps">
        <q-td :props="cellProps">
          <span class="row items-center no-wrap q-gutter-x-sm">
            <span>{{ roleLabel(cellProps.row) }}</span>
            <q-badge v-if="cellProps.row.canPublish" class="badge-soft badge-soft--sm badge-soft--info">
              {{ t('admin.shell.canPublish') }}
            </q-badge>
          </span>
        </q-td>
      </template>

      <template #body-cell-status="cellProps">
        <q-td :props="cellProps">
          <q-badge class="badge-soft badge-soft--sm" :class="STATUS_CLASS[statusOf(cellProps.row)]">
            {{ t(`admin.users.status.${statusOf(cellProps.row)}`) }}
          </q-badge>
        </q-td>
      </template>

      <template #no-data>
        <div class="full-width adm-empty">
          {{ loadError ? t('admin.users.loadFailed') : t('admin.users.empty') }}
        </div>
      </template>
    </q-table>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableColumn } from 'quasar';
import {
  getUserSyncStatus,
  listUsers,
  triggerUserSync,
  type UserProfile,
  type UserSyncStatus,
} from 'src/api/users';
import { formatDateTime } from 'src/utils/adminFormat';
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';

// The user directory: who has an account, their role and whether it is still
// active. Read-only — accounts are managed in Keycloak; this page only shows
// the synced copy and can ask for a fresh sync.

const { t, locale } = useI18n();
const $q = useQuasar();

/** The API caps a page at 500 — far more staff than the library has, so the list is filtered here. */
const LIMIT = 500;

type UserStatus = 'active' | 'disabled' | 'removed';

const STATUS_CLASS: Record<UserStatus, string> = {
  active: 'badge-soft--positive',
  disabled: 'badge-soft--warning',
  removed: 'badge-soft--muted',
};

const users = ref<UserProfile[]>([]);
const loading = ref(true);
const loadError = ref(false);
const query = ref<string | null>('');
const showInactive = ref(false);
const pagination = ref({ sortBy: 'user', descending: false, page: 1, rowsPerPage: 20 });

function statusOf(user: UserProfile): UserStatus {
  if (user.deletedAt) return 'removed';
  return user.enabled ? 'active' : 'disabled';
}

/** The same reading of the scopes as the drawer's role caption. */
function roleLabel(user: UserProfile): string {
  const scopes = user.scopes ?? [];
  if (scopes.includes('users:manage')) return t('admin.shell.roles.admin');
  const drafts = scopes.includes('drafts:manage');
  const records = scopes.includes('records:manage');
  if (drafts && records) return t('admin.shell.roles.editor');
  if (drafts || records) return t('admin.shell.roles.cataloguer');
  return t('admin.shell.roles.reader');
}

const filteredUsers = computed(() => {
  const q = (query.value ?? '').trim().toLowerCase();
  return users.value.filter(
    (user) =>
      (showInactive.value || user.isActive) &&
      (!q || [user.displayName, user.username, user.email ?? ''].some((v) => v.toLowerCase().includes(q))),
  );
});

const columns = computed<QTableColumn<UserProfile>[]>(() => [
  {
    name: 'user',
    label: t('admin.users.columns.user'),
    field: 'displayName',
    align: 'left',
    sortable: true,
  },
  {
    name: 'email',
    label: t('admin.users.columns.email'),
    field: (row) => row.email ?? '',
    align: 'left',
    sortable: true,
  },
  {
    name: 'role',
    label: t('admin.users.columns.role'),
    field: (row) => roleLabel(row),
    align: 'left',
    sortable: true,
  },
  {
    name: 'status',
    label: t('admin.users.columns.status'),
    field: (row) => statusOf(row),
    align: 'left',
    sortable: true,
  },
]);

async function loadUsers() {
  loading.value = true;
  try {
    // Every account, active or not; the toggle filters on the client.
    const result = await listUsers({ active: false, limit: LIMIT });
    users.value = result.users;
    loadError.value = false;
  } catch {
    users.value = [];
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

// ── Directory sync (moved here from the dashboard) ──

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

// The sync runs in a queue worker; poll until it reports done, then reload the
// list so it shows what the sync brought in.
function pollSyncStatus(attempt = 0) {
  clearTimeout(syncPollTimer);
  syncPollTimer = setTimeout(() => {
    void loadSyncStatus().then(() => {
      if (syncStatus.value?.running && attempt < 30) pollSyncStatus(attempt + 1);
      else void loadUsers();
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

onMounted(() => {
  void loadUsers();
  void loadSyncStatus();
});
onBeforeUnmount(() => clearTimeout(syncPollTimer));
</script>

<style scoped lang="sass">
.sync-bar
  display: flex
  flex-wrap: wrap
  align-items: center
  gap: 8px
  padding: 12px 20px
  margin-bottom: 16px
  font-size: 13px

.sync-bar__error
  flex-basis: 100%

.users-search
  max-width: 420px

.users-summary
  margin-top: 10px
  font-size: 13px
  color: $muted

.user-cell
  min-width: 0

.user-cell__name
  font-weight: 600

.user-cell__sub
  font-size: 12px
  color: $muted
</style>
