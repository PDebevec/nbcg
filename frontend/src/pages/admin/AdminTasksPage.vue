<template>
  <q-page class="adm-page">
    <AdminPageHeader :eyebrow="t('admin.nav.groupWork')" :title="t('admin.tasks.title')" :caption="caption">
      <template #actions>
        <q-btn-toggle
          :model-value="scope"
          no-caps
          unelevated
          dense
          toggle-color="primary"
          color="transparent"
          text-color="grey-9"
          class="scope-toggle"
          :options="scopeOptions"
          @update:model-value="setQuery({ scope: $event, task: undefined })"
        >
          <template v-for="option in scopeOptions" :key="option.value" #[option.slot]>
            <span>{{ option.text }}</span>
            <span v-if="scopeCounts[option.value] !== null" class="scope-toggle__count">
              {{ scopeCounts[option.value] }}
            </span>
          </template>
        </q-btn-toggle>
      </template>
    </AdminPageHeader>

    <q-banner v-if="truncated" dense rounded class="adm-note adm-note--warning q-mb-md">
      {{ t('admin.tasks.truncated', { limit: PAGE_LIMIT }) }}
    </q-banner>

    <!-- D1: the full-width list -->
    <q-table
      v-if="!selectedId"
      flat
      bordered
      :rows="visibleRows"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :pagination="{ rowsPerPage: 20 }"
      :rows-per-page-options="[10, 20, 50]"
      class="admin-table tasks-table"
      @row-click="(_evt, row) => open(row.id)"
    >
      <template #top>
        <div class="row items-center full-width q-gutter-sm">
          <q-input
            v-model="searchText"
            dense
            outlined
            clearable
            debounce="200"
            :placeholder="t('admin.tasks.searchPlaceholder')"
            class="tasks-search"
          >
            <template #prepend><q-icon name="o_search" /></template>
          </q-input>
          <q-select
            :model-value="kind"
            :options="kindOptions"
            emit-value
            map-options
            dense
            outlined
            options-dense
            :display-value="`${t('admin.tasks.columns.kind')}: ${kindLabel}`"
            class="filter-select"
            @update:model-value="setQuery({ kind: $event || undefined })"
          />
          <q-select
            :model-value="status || 'ALL'"
            :options="statusOptions"
            emit-value
            map-options
            dense
            outlined
            options-dense
            :display-value="`${t('admin.tasks.columns.status')}: ${statusLabel}`"
            class="filter-select"
            @update:model-value="setQuery({ status: $event })"
          />
          <q-checkbox
            :model-value="returnedOnly"
            dense
            :label="t('admin.tasks.returnedOnly')"
            class="returned-toggle"
            @update:model-value="setQuery({ returned: $event ? '1' : undefined })"
          />
        </div>
      </template>

      <template #body-cell-title="cellProps">
        <q-td :props="cellProps">
          <div class="column task-cell">
            <span class="task-cell__title ellipsis">{{ cellProps.row.title }}</span>
            <span v-if="cellProps.row.description" class="task-cell__sub ellipsis">
              {{ cellProps.row.description }}
            </span>
          </div>
        </q-td>
      </template>

      <template #body-cell-item="cellProps">
        <q-td :props="cellProps">
          <!-- A task carries the item's id and type, not its title — that is on the task itself -->
          <router-link
            v-if="cellProps.row.itemType"
            :to="`/admin/items/${cellProps.row.itemId}`"
            class="item-chip"
            @click.stop
          >
            <q-avatar square size="32px" class="item-chip__tile">
              <q-icon :name="cellProps.row.itemType === 'RECORD' ? 'o_menu_book' : 'o_edit_note'" size="16px" />
            </q-avatar>
            <span>{{ t(`admin.itemType.${cellProps.row.itemType}`) }}</span>
            <q-icon name="o_open_in_new" size="14px" class="adm-muted" />
          </router-link>
          <span v-else class="adm-muted">{{ t('admin.tasks.itemType.gone') }}</span>
        </q-td>
      </template>

      <template #body-cell-kind="cellProps">
        <q-td :props="cellProps">
          <q-badge class="badge-soft badge-soft--outline">{{ t(`admin.tasks.kinds.${cellProps.value}`) }}</q-badge>
        </q-td>
      </template>

      <template #body-cell-status="cellProps">
        <q-td :props="cellProps">
          <TaskStatusBadge :status="cellProps.value" :returned="cellProps.row.lastHandoff === 'RETURNED'" />
        </q-td>
      </template>

      <template #body-cell-person="cellProps">
        <q-td :props="cellProps">
          <div class="row items-center no-wrap q-gutter-x-sm">
            <UserAvatar :name="cellProps.value" :size="24" />
            <span class="ellipsis">{{ cellProps.value }}</span>
          </div>
        </q-td>
      </template>

      <template #body-cell-updatedAt="cellProps">
        <q-td :props="cellProps">
          <RelativeTime :value="cellProps.value" />
        </q-td>
      </template>

      <template #no-data>
        <div class="full-width adm-empty">{{ t('admin.tasks.empty') }}</div>
      </template>
    </q-table>

    <!-- D2: a task is open — narrow list on the left, the task on the right -->
    <div v-else class="split">
      <q-card flat bordered class="split__list">
        <div class="split__search">
          <q-input
            v-model="searchText"
            dense
            outlined
            clearable
            debounce="200"
            :placeholder="t('admin.tasks.searchPlaceholder')"
          >
            <template #prepend><q-icon name="o_search" /></template>
          </q-input>
        </div>
        <q-scroll-area class="col">
          <div v-if="visibleRows.length === 0" class="adm-empty">{{ t('admin.tasks.empty') }}</div>
          <router-link
            v-for="row in visibleRows"
            :key="row.id"
            :to="{ query: { ...route.query, task: row.id } }"
            replace
            class="mini-row"
            :class="{ 'mini-row--active': row.id === selectedId }"
            :aria-current="row.id === selectedId ? 'true' : undefined"
          >
            <q-avatar square size="32px" class="item-chip__tile">
              <q-icon :name="row.itemType === 'RECORD' ? 'o_menu_book' : 'o_edit_note'" size="16px" />
            </q-avatar>
            <span class="col column mini-row__text">
              <span class="row items-center no-wrap q-gutter-x-sm">
                <span class="col mini-row__title ellipsis">{{ row.title }}</span>
                <RelativeTime :value="row.updatedAt" class="mini-row__time" />
              </span>
              <span v-if="row.description" class="mini-row__sub ellipsis">{{ row.description }}</span>
              <span class="row items-center q-gutter-x-xs q-mt-xs">
                <TaskStatusBadge :status="row.status" :returned="row.lastHandoff === 'RETURNED'" />
                <span class="mini-row__kind">{{ t(`admin.tasks.kinds.${row.kind}`) }}</span>
              </span>
            </span>
          </router-link>
        </q-scroll-area>
      </q-card>

      <TaskDetailPane :task-id="selectedId" class="col" @close="setQuery({ task: undefined })" @changed="onTaskChanged" />
    </div>

    <div v-if="!selectedId && !loading && visibleRows.length > 0" class="list-foot">
      {{ t(`admin.tasks.listFoot.${scope}`) }} {{ t('admin.tasks.listFootHint') }}
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableColumn } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import {
  listTasks,
  TASK_KINDS,
  TASK_STATUSES,
  type Task,
  type TaskKind,
  type TaskListParams,
  type TaskStatus,
} from 'src/api/tasks';
import { useTaskCountStore } from 'src/stores/task-count-store';
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import RelativeTime from 'src/components/admin/RelativeTime.vue';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';
import TaskDetailPane from 'src/components/admin/tasks/TaskDetailPane.vue';

// ---------------------------------------------------------------------------
// The inbox. "Assigned to me" is a filter, not a wall — all staff see all
// tasks, because the point is being able to see who a draft is waiting on.
//
// Scope, stage, status and "returned" are server-side filters and live in the
// URL. One request per view with a generous limit, then client-side search and
// paging: the list is bounded by staff activity, not by the collection, and
// the API has no text search over tasks.
//
// `?task=<id>` opens that task in a pane next to the list.
// ---------------------------------------------------------------------------

type Scope = 'mine' | 'created' | 'all';
const SCOPES: Scope[] = ['mine', 'created', 'all'];

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const taskCount = useTaskCountStore();

const PAGE_LIMIT = 200;

// ── Filters, read from the URL ──

const scope = computed<Scope>(() => SCOPES.find((s) => s === route.query.scope) ?? 'mine');

/** '' = every status. */
const status = computed<TaskStatus | ''>(() => {
  if (route.query.status === 'ALL') return '';
  return TASK_STATUSES.find((s) => s === route.query.status) ?? 'OPEN';
});

const kind = computed<TaskKind | ''>(() => TASK_KINDS.find((k) => k === route.query.kind) ?? '');
const returnedOnly = computed(() => route.query.returned === '1');
const selectedId = computed(() => (typeof route.query.task === 'string' ? route.query.task : ''));

function setQuery(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
    if (typeof value === 'string' && value) query[key] = value;
  }
  // The defaults stay out of the URL.
  if (query.scope === 'mine') delete query.scope;
  if (query.status === 'OPEN') delete query.status;
  void router.replace({ query });
}

function open(id: string) {
  setQuery({ task: id });
}

const scopeOptions = computed(() =>
  (
    [
      { value: 'mine', text: t('admin.tasks.scopeMine') },
      { value: 'created', text: t('admin.tasks.scopeCreated') },
      { value: 'all', text: t('admin.tasks.scopeAll') },
    ] as const
  ).map((option) => ({ ...option, slot: option.value })),
);

const kindOptions = computed(() => [
  { label: t('admin.tasks.any'), value: '' },
  ...TASK_KINDS.map((k) => ({ label: t(`admin.tasks.kinds.${k}`), value: k })),
]);

const statusOptions = computed(() => [
  ...TASK_STATUSES.map((s) => ({ label: t(`admin.tasks.statuses.${s}`), value: s })),
  { label: t('admin.tasks.any'), value: 'ALL' },
]);

const kindLabel = computed(() =>
  (kind.value ? t(`admin.tasks.kinds.${kind.value}`) : t('admin.tasks.any')).toLowerCase(),
);

const statusLabel = computed(() =>
  (status.value ? t(`admin.tasks.statuses.${status.value}`) : t('admin.tasks.any')).toLowerCase(),
);

// ── Data ──

const rows = ref<Task[]>([]);
const total = ref(0);
const loading = ref(false);
const searchText = ref('');

const truncated = computed(() => total.value > rows.value.length);

const visibleRows = computed(() => {
  const needle = (searchText.value ?? '').trim().toLowerCase();
  if (!needle) return rows.value;
  return rows.value.filter((task) =>
    [task.title, task.description, task.assignedToName, task.createdByName].some((text) =>
      (text ?? '').toLowerCase().includes(needle),
    ),
  );
});

const columns = computed<QTableColumn<Task>[]>(() => [
  { name: 'title', label: t('admin.tasks.columns.title'), field: 'title', align: 'left' },
  {
    name: 'item',
    label: t('admin.tasks.columns.item'),
    field: 'itemId',
    align: 'left',
    style: 'width: 150px',
  },
  {
    name: 'kind',
    label: t('admin.tasks.columns.kind'),
    field: 'kind',
    align: 'left',
    style: 'width: 170px',
  },
  {
    name: 'status',
    label: t('admin.tasks.columns.status'),
    field: 'status',
    align: 'left',
    style: 'width: 150px',
  },
  // Whoever is on the other side of the task from the person looking at it.
  scope.value === 'mine'
    ? {
        name: 'person',
        label: t('admin.tasks.columns.from'),
        field: 'createdByName',
        align: 'left',
        style: 'width: 190px',
      }
    : {
        name: 'person',
        label: t('admin.tasks.columns.assignedTo'),
        field: 'assignedToName',
        align: 'left',
        style: 'width: 190px',
      },
  {
    name: 'updatedAt',
    label: t('admin.tasks.columns.updated'),
    field: 'updatedAt',
    align: 'right',
    style: 'width: 120px',
  },
]);

function scopeParams(target: Scope): TaskListParams {
  if (target === 'mine') return { assignedTo: 'me' };
  if (target === 'created') return { createdBy: 'me' };
  return {};
}

async function load() {
  loading.value = true;
  try {
    const result = await listTasks({
      ...scopeParams(scope.value),
      limit: PAGE_LIMIT,
      ...(status.value ? { status: status.value } : {}),
      ...(kind.value ? { kind: kind.value } : {}),
      ...(returnedOnly.value ? { returned: true } : {}),
    });
    // Returned tasks first, then the most recently touched.
    rows.value = [...result.tasks].sort(
      (a, b) =>
        Number(b.status === 'OPEN' && b.lastHandoff === 'RETURNED') -
          Number(a.status === 'OPEN' && a.lastHandoff === 'RETURNED') ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
    total.value = result.total;
  } catch {
    $q.notify({ type: 'negative', message: t('admin.tasks.loadFailed') });
  } finally {
    loading.value = false;
  }
}

// ── Counts: open tasks per scope (the tabs), and how many of mine came back (the caption) ──

const scopeCounts = reactive<Record<Scope, number | null>>({ mine: null, created: null, all: null });
const returnedToMe = ref<number | null>(null);

async function loadCounts() {
  await Promise.all([
    ...SCOPES.map(async (target) => {
      try {
        const result = await listTasks({ ...scopeParams(target), status: 'OPEN', limit: 1 });
        scopeCounts[target] = result.total;
      } catch {
        scopeCounts[target] = null;
      }
    }),
    listTasks({ assignedTo: 'me', status: 'OPEN', returned: true, limit: 1 })
      .then((result) => {
        returnedToMe.value = result.total;
      })
      .catch(() => {
        returnedToMe.value = null;
      }),
  ]);
}

const caption = computed(() => {
  if (scopeCounts.mine === null) return undefined;
  if (scopeCounts.mine === 0) return t('admin.tasks.captionNone');
  const waiting = t('admin.tasks.captionWaiting', { count: scopeCounts.mine });
  return returnedToMe.value
    ? `${waiting} · ${t('admin.tasks.captionReturned', { count: returnedToMe.value })}`
    : waiting;
});

// An action in the pane moved a task: the list, the counts and the drawer are stale.
function onTaskChanged() {
  void load();
  void loadCounts();
  void taskCount.refresh();
}

watch([scope, status, kind, returnedOnly], () => void load());

onMounted(() => {
  void load();
  void loadCounts();
});
</script>

<style scoped lang="sass">
.scope-toggle
  padding: 4px
  gap: 2px
  background: $soft-muted
  border-radius: $radius
  :deep(.q-btn)
    min-height: 36px
    padding: 0 14px
    border-radius: 6px !important
    font-weight: 600
    color: $ink-soft

  :deep(.q-btn.bg-primary)
    color: #fff !important

  :deep(.q-btn__content)
    gap: 8px

.scope-toggle__count
  font-size: 12px
  font-weight: 700
  opacity: 0.8

.tasks-table
  border-radius: 10px
  :deep(.q-table__top)
    padding: 12px 20px
    border-bottom: 1px solid $divider

  :deep(tbody tr)
    cursor: pointer

  :deep(tbody td)
    height: 68px

.tasks-search
  width: 320px

.filter-select
  min-width: 170px

.returned-toggle
  height: 40px
  padding: 0 12px
  border: 1px solid $field-border
  border-radius: $radius
  background: $surface

.task-cell
  max-width: 100%
  gap: 3px
  min-width: 0

.task-cell__title
  font-size: 15px
  font-weight: 600
  color: $primary

.task-cell__sub
  font-size: 13px
  color: $muted
  max-width: 520px

.item-chip
  display: inline-flex
  align-items: center
  gap: 10px
  color: $ink
  font-weight: 600
  text-decoration: none
  &:hover
    color: $primary

.item-chip__tile
  border-radius: $radius
  background: $paper-deep
  border: 1px solid $divider
  color: $primary
  flex: none

.list-foot
  padding: 14px 4px 0
  font-size: 13px
  color: $muted

.split
  display: flex
  align-items: stretch
  gap: 20px
  min-height: calc(100vh - 220px)

.split__list
  width: 380px
  flex: none
  display: flex
  flex-direction: column
  border-radius: 10px
  overflow: hidden

.split__search
  padding: 12px 16px
  border-bottom: 1px solid $divider

.mini-row
  display: flex
  gap: 12px
  padding: 14px 16px
  border-bottom: 1px solid $divider-soft
  text-decoration: none
  color: inherit
  &:hover
    background: $paper-deep
    color: inherit

.mini-row--active,
.mini-row--active:hover
  background: #EEF0F6
  box-shadow: inset 3px 0 0 $primary

.mini-row__text
  min-width: 0
  gap: 2px

.mini-row__title
  font-size: 15px
  font-weight: 600
  color: $primary

.mini-row__time
  font-size: 12px
  color: $muted
  white-space: nowrap

.mini-row__sub
  font-size: 13px
  color: $ink-soft

.mini-row__kind
  font-size: 12px
  color: $muted
</style>
