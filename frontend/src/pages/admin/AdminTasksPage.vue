<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <h1 class="text-h5 text-weight-bold q-mt-none q-mb-lg">{{ t('admin.tasks.title') }}</h1>

      <q-table
        flat
        bordered
        :rows="visibleRows"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :pagination="{ rowsPerPage: 20 }"
        class="tasks-table"
      >
        <template #top>
          <div class="row items-center full-width q-col-gutter-sm">
            <q-btn-toggle
              v-model="scope"
              no-caps
              unelevated
              toggle-color="primary"
              color="white"
              text-color="primary"
              :options="scopeOptions"
            />
            <q-select
              v-model="statusFilter"
              :options="statusOptions"
              emit-value
              map-options
              dense
              outlined
              clearable
              :label="t('admin.tasks.statusFilter')"
              class="status-filter"
            />
            <q-checkbox
              v-model="hideClosed"
              dense
              :disable="!!statusFilter"
              :label="t('admin.tasks.hideClosed')"
            />
          </div>
          <q-banner v-if="truncated" dense class="bg-warning text-dark full-width q-mt-sm" rounded>
            {{ t('admin.tasks.truncated', { limit: PAGE_LIMIT }) }}
          </q-banner>
        </template>

        <template #body-cell-title="cellProps">
          <q-td :props="cellProps">
            <router-link :to="`/admin/tasks/${cellProps.row.id}`" class="title-link">
              {{ cellProps.value }}
            </router-link>
          </q-td>
        </template>

        <template #body-cell-kind="cellProps">
          <q-td :props="cellProps">{{ t(`admin.tasks.kinds.${cellProps.value}`) }}</q-td>
        </template>

        <template #body-cell-status="cellProps">
          <q-td :props="cellProps">
            <TaskStatusBadge :status="cellProps.value" />
          </q-td>
        </template>

        <template #body-cell-item="cellProps">
          <q-td :props="cellProps">
            <router-link
              v-if="cellProps.row.itemType"
              :to="`/admin/items/${cellProps.row.itemId}`"
              class="item-link"
            >
              {{ t(`admin.tasks.itemType.${cellProps.row.itemType}`) }}
              <q-icon name="open_in_new" size="14px" />
            </router-link>
            <span v-else class="text-library-muted">{{ t('admin.tasks.itemType.gone') }}</span>
          </q-td>
        </template>

        <template #no-data>
          <div class="full-width text-center q-pa-lg text-library-muted">
            {{ t('admin.tasks.empty') }}
          </div>
        </template>
      </q-table>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableColumn } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import {
  ACTIVE_TASK_STATUSES,
  listTasks,
  TASK_STATUSES,
  type Task,
  type TaskListParams,
  type TaskStatus,
} from 'src/api/tasks';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';

// ---------------------------------------------------------------------------
// The inbox. "Assigned to me" is a filter, not a wall — all staff see all
// tasks, because the point is being able to see who a draft is waiting on.
//
// One request per view with a generous limit, then client-side paging: the
// list is bounded by staff activity, not the collection, and the server
// endpoint takes one `status`, whereas "active" is three of them.
// ---------------------------------------------------------------------------

type Scope = 'mine' | 'created' | 'all';

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();

const PAGE_LIMIT = 200;

const scope = ref<Scope>(
  (['mine', 'created', 'all'] as const).find((s) => s === route.query.scope) ?? 'mine',
);
const statusFilter = ref<TaskStatus | null>(null);
const hideClosed = ref(true);

const rows = ref<Task[]>([]);
const total = ref(0);
const loading = ref(false);

const scopeOptions = computed(() => [
  { label: t('admin.tasks.scopeMine'), value: 'mine' },
  { label: t('admin.tasks.scopeCreated'), value: 'created' },
  { label: t('admin.tasks.scopeAll'), value: 'all' },
]);

const statusOptions = computed(() =>
  TASK_STATUSES.map((s) => ({ label: t(`admin.tasks.statuses.${s}`), value: s })),
);

const truncated = computed(() => total.value > rows.value.length);

const visibleRows = computed(() =>
  hideClosed.value && !statusFilter.value
    ? rows.value.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status))
    : rows.value,
);

const columns = computed<QTableColumn<Task>[]>(() => [
  { name: 'title', label: t('admin.tasks.columns.title'), field: 'title', align: 'left' },
  { name: 'kind', label: t('admin.tasks.columns.kind'), field: 'kind', align: 'left' },
  { name: 'status', label: t('admin.tasks.columns.status'), field: 'status', align: 'left' },
  { name: 'item', label: t('admin.tasks.columns.item'), field: 'itemId', align: 'left' },
  {
    name: 'assignedTo',
    label: t('admin.tasks.columns.assignedTo'),
    field: 'assignedToName',
    align: 'left',
  },
  {
    name: 'createdBy',
    label: t('admin.tasks.columns.createdBy'),
    field: 'createdByName',
    align: 'left',
  },
  {
    name: 'updatedAt',
    label: t('admin.tasks.columns.updated'),
    field: 'updatedAt',
    align: 'left',
    format: (v: string) => (v ? new Date(v).toLocaleString() : '—'),
  },
]);

async function load() {
  loading.value = true;
  try {
    const params: TaskListParams = { limit: PAGE_LIMIT };
    if (scope.value === 'mine') params.assignedTo = 'me';
    if (scope.value === 'created') params.createdBy = 'me';
    if (statusFilter.value) params.status = statusFilter.value;
    const result = await listTasks(params);
    rows.value = result.tasks;
    total.value = result.total;
  } catch {
    $q.notify({ type: 'negative', message: t('admin.tasks.loadFailed') });
  } finally {
    loading.value = false;
  }
}

watch(scope, (s) => {
  void router.replace({ query: { ...route.query, scope: s } });
  void load();
});
watch(statusFilter, () => void load());
onMounted(() => void load());
</script>

<style scoped lang="sass">
.page-body
  max-width: 1280px
  margin: 0 auto

.tasks-table
  background: $surface
  border-radius: $radius

.status-filter
  min-width: 180px

.title-link
  color: $primary
  text-decoration: none
  font-weight: 600
  &:hover
    text-decoration: underline

.item-link
  color: $primary
  text-decoration: none
  &:hover
    text-decoration: underline
</style>
