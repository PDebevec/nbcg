<template>
  <q-page class="adm-page">
    <AdminPageHeader
      :eyebrow="t('admin.nav.groupCatalogue')"
      :title="isRecords ? t('admin.nav.records') : t('admin.nav.drafts')"
      :caption="caption"
    >
      <template #actions>
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="o_add"
          :label="isRecords ? t('admin.dashboard.newRecord') : t('admin.dashboard.newDraft')"
          :to="`/admin/items/new?type=${itemType}`"
        />
      </template>
    </AdminPageHeader>

    <div class="items-layout">
      <!-- FILTER RAIL. Every filter lives in the URL, so a filtered list can be bookmarked or sent on. -->
      <aside class="filter-rail" :aria-label="t('admin.items.filters.title')">
        <div class="row items-center justify-between">
          <span class="filter-rail__title">{{ t('admin.items.filters.title') }}</span>
          <q-btn
            flat
            dense
            no-caps
            color="primary"
            :label="t('admin.items.filters.clear')"
            :disable="activeFilterCount === 0"
            @click="clearFilters"
          />
        </div>

        <div v-if="materialTypeOptions.length" class="filter-group">
          <div class="filter-group__legend">{{ t('admin.items.filters.materialType') }}</div>
          <q-option-group
            :model-value="filters.materialType"
            :options="materialTypeOptions"
            type="checkbox"
            dense
            class="filter-group__options"
            @update:model-value="setFilter('materialType', $event)"
          />
        </div>

        <div v-if="collectionTypeOptions.length" class="filter-group">
          <div class="filter-group__legend">{{ t('admin.items.filters.collectionType') }}</div>
          <q-option-group
            :model-value="filters.collectionType"
            :options="collectionTypeOptions"
            type="checkbox"
            dense
            class="filter-group__options"
            @update:model-value="setFilter('collectionType', $event)"
          />
        </div>

        <div v-if="canSeeAttribution" class="filter-group">
          <div class="filter-group__legend">{{ t('admin.items.filters.work') }}</div>
          <q-checkbox
            :model-value="filters.mine"
            dense
            :label="t('admin.items.filters.createdByMe')"
            class="filter-group__options"
            @update:model-value="setFilter('mine', $event)"
          />
        </div>

        <div class="filter-group filter-group--last">
          <div class="filter-group__legend">{{ t('admin.items.filters.year') }}</div>
          <div class="row items-center no-wrap q-gutter-x-sm">
            <q-input
              :model-value="filters.yearFrom"
              outlined
              dense
              inputmode="numeric"
              maxlength="4"
              debounce="500"
              :placeholder="t('admin.items.filters.yearFrom')"
              :aria-label="t('admin.items.filters.yearFrom')"
              class="year-input"
              @update:model-value="setFilter('yearFrom', String($event ?? ''))"
            />
            <span class="adm-muted">–</span>
            <q-input
              :model-value="filters.yearTo"
              outlined
              dense
              inputmode="numeric"
              maxlength="4"
              debounce="500"
              :placeholder="t('admin.items.filters.yearTo')"
              :aria-label="t('admin.items.filters.yearTo')"
              class="year-input"
              @update:model-value="setFilter('yearTo', String($event ?? ''))"
            />
          </div>
        </div>
      </aside>

      <!-- TABLE -->
      <q-table
        v-model:pagination="pagination"
        v-model:selected="selected"
        :rows="rows"
        :columns="columns"
        :loading="loading"
        row-key="id"
        selection="multiple"
        flat
        bordered
        binary-state-sort
        :rows-per-page-options="[10, 20, 50, 100]"
        class="admin-table items-table col"
        @request="onRequest"
      >
        <template #top>
          <div class="full-width column">
            <q-input
              :model-value="filters.q"
              dense
              outlined
              clearable
              debounce="400"
              :placeholder="t('admin.items.searchPlaceholder')"
              class="items-search"
              @update:model-value="setFilter('q', String($event ?? ''))"
            >
              <template #prepend><q-icon name="o_search" /></template>
            </q-input>
            <div class="items-summary">
              <span>{{ t('admin.items.results', { count: formatCount(pagination.rowsNumber) }) }}</span>
              <span>
                ·
                {{
                  activeFilterCount === 0
                    ? t('admin.items.filters.none')
                    : t('admin.items.filters.active', { count: activeFilterCount })
                }}
              </span>
            </div>
          </div>
        </template>

        <template #body-cell-item="cellProps">
          <q-td :props="cellProps">
            <div class="row items-center no-wrap q-gutter-x-md">
              <q-avatar square size="36px" class="type-tile">
                <q-icon :name="materialTypeIcon(cellProps.row.materialType?.code)" size="18px" />
                <q-tooltip v-if="cellProps.row.materialType">
                  {{ codeLabel(cellProps.row.materialType) }}
                </q-tooltip>
              </q-avatar>
              <div class="column item-cell">
                <div class="row items-center no-wrap q-gutter-x-sm">
                  <router-link :to="`/admin/items/${cellProps.row.id}`" class="title-link ellipsis">
                    {{ cellProps.row.title || '—' }}
                  </router-link>
                  <q-badge
                    v-if="cellProps.row.collectionType !== 0"
                    class="badge-soft badge-soft--sm badge-soft--outline"
                  >
                    {{ collectionTypeLabel(cellProps.row.collectionType) }}
                  </q-badge>
                  <!-- A8: the marker is the way into the item's Tasks tab -->
                  <router-link
                    v-if="openTasks[cellProps.row.id]"
                    :to="`/admin/items/${cellProps.row.id}?tab=tasks`"
                    class="badge-soft badge-soft--sm badge-soft--warning open-task"
                  >
                    <q-icon name="o_assignment_late" size="12px" />
                    {{ t('admin.items.openTaskShort') }}
                    <q-tooltip>{{ t('admin.items.openTaskTooltip') }}</q-tooltip>
                  </router-link>
                  <TextExtractionIndicator v-if="cellProps.row.extraction" :status="cellProps.row.extraction" />
                </div>
                <span class="item-cell__sub ellipsis">
                  <template v-if="cellProps.row.author">{{ cellProps.row.author }} · </template>
                  <template v-if="cellProps.row.year">{{ cellProps.row.year }} · </template>
                  <span v-if="cellProps.row.cobissId" class="adm-mono">{{ cellProps.row.cobissId }}</span>
                </span>
              </div>
            </div>
          </q-td>
        </template>

        <template #body-cell-visibilityStatus="cellProps">
          <q-td :props="cellProps">
            <VisibilityBadge :status="cellProps.value" />
          </q-td>
        </template>

        <template #body-cell-updatedAt="cellProps">
          <q-td :props="cellProps" class="updated-cell">
            <RelativeTime :value="cellProps.row.updatedAt" />
            <div v-if="cellProps.row.updatedBy" class="updated-cell__by">
              {{ t('admin.items.by', { name: cellProps.row.updatedBy }) }}
            </div>
          </q-td>
        </template>

        <template #body-cell-actions="cellProps">
          <q-td :props="cellProps" class="text-right no-wrap">
            <q-btn
              flat
              dense
              round
              icon="o_edit"
              color="primary"
              :to="`/admin/items/${cellProps.row.id}`"
              :aria-label="t('admin.items.edit')"
            >
              <q-tooltip>{{ t('admin.items.edit') }}</q-tooltip>
            </q-btn>
            <q-btn flat dense round icon="o_more_vert" color="grey-7" :aria-label="t('admin.items.more')">
              <q-menu auto-close anchor="bottom right" self="top right">
                <q-list dense class="row-menu">
                  <q-item v-if="isRecords" clickable :to="`/catalog/${cellProps.row.id}`" target="_blank">
                    <q-item-section avatar><q-icon name="o_open_in_new" size="18px" /></q-item-section>
                    <q-item-section>{{ t('admin.items.openPublic') }}</q-item-section>
                  </q-item>
                  <q-item v-if="isStaff" clickable @click="openAssign([cellProps.row])">
                    <q-item-section avatar><q-icon name="o_person_add" size="18px" /></q-item-section>
                    <q-item-section>{{ t('admin.edit.assignTask') }}</q-item-section>
                  </q-item>
                  <q-item v-if="canTransition" clickable @click="transition([cellProps.row])">
                    <q-item-section avatar>
                      <q-icon :name="isRecords ? 'o_unpublished' : 'o_publish'" size="18px" />
                    </q-item-section>
                    <q-item-section>
                      {{ isRecords ? t('admin.items.toDraft') : t('admin.items.publish') }}
                    </q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable class="text-negative" @click="remove([cellProps.row])">
                    <q-item-section avatar><q-icon name="o_delete" size="18px" /></q-item-section>
                    <q-item-section>{{ t('admin.items.delete') }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </q-td>
        </template>

        <template #no-data>
          <div class="full-width adm-empty">{{ t('admin.items.empty') }}</div>
        </template>
      </q-table>
    </div>

    <!-- BULK ACTIONS: floats over the page bottom so the table never jumps when rows are selected -->
    <q-page-sticky v-if="selected.length > 0" position="bottom" :offset="[0, 28]" class="bulk-sticky">
      <div class="bulk-bar" role="toolbar" :aria-label="t('admin.items.bulkActions')">
        <span class="bulk-bar__count">{{ t('admin.items.selected', { count: selected.length }) }}</span>
        <span class="bulk-bar__sep" />
        <q-btn
          v-if="isStaff"
          flat
          no-caps
          dense
          icon="o_person_add"
          :label="t('admin.edit.assignTask')"
          @click="openAssign(selected)"
        />
        <q-btn flat no-caps dense icon="o_visibility" icon-right="o_expand_more" :label="t('admin.items.setVisibility')">
          <q-menu auto-close anchor="top middle" self="bottom middle" :offset="[0, 8]">
            <q-list dense>
              <q-item
                v-for="status in VISIBILITY_STATUSES"
                :key="status"
                clickable
                @click="bulkSetVisibility(status)"
              >
                <q-item-section><VisibilityBadge :status="status" /></q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn
          v-if="canTransition"
          flat
          no-caps
          dense
          :icon="isRecords ? 'o_unpublished' : 'o_publish'"
          :label="isRecords ? t('admin.items.toDraft') : t('admin.items.publish')"
          @click="transition(selected)"
        />
        <q-btn
          flat
          no-caps
          dense
          icon="o_delete"
          :label="t('admin.items.delete')"
          class="bulk-bar__danger"
          @click="remove(selected)"
        />
        <q-btn
          flat
          dense
          icon="o_close"
          class="bulk-bar__clear"
          :aria-label="t('admin.items.clearSelection')"
          @click="selected = []"
        />
      </div>
    </q-page-sticky>

    <BulkAssignDialog
      v-model="assignOpen"
      :items="assignItems"
      :item-type="itemType"
      :open-tasks="openTasks"
      @done="onTasksCreated"
    />

    <ValidationErrorDialog
      v-model="validationOpen"
      :failure="validation"
      :action="isRecords ? 'toDraft' : 'publish'"
      :items="validationItems"
      :total="validationTotal"
    />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import { useQuasar, type QTableColumn, type QTableProps } from 'quasar';
import {
  searchItems,
  suggestValues,
  type IndexedRecord,
  type ResolvedCode,
  type TextExtractionStatus,
} from 'src/api/search';
import { listTasks } from 'src/api/tasks';
import {
  conflictCurrentVersion,
  deleteItems,
  isVersionConflict,
  transitionItems,
  updateItem,
  VISIBILITY_STATUSES,
  type ItemType,
  type VisibilityStatus,
} from 'src/api/admin';
import { apiErrorMessage, validationFailure, type ValidationFailure } from 'src/api/errors';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { useSchemaLabel } from 'src/composables/useSchemaForm';
import { useSchemaStore } from 'src/stores/schema-store';
import { useTaskCountStore } from 'src/stores/task-count-store';
import { formatCount } from 'src/utils/adminFormat';
import { materialTypeIcon } from 'src/utils/materialType';
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import BulkAssignDialog, { type BulkAssignItem } from 'src/components/admin/BulkAssignDialog.vue';
import RelativeTime from 'src/components/admin/RelativeTime.vue';
import TextExtractionIndicator from 'src/components/admin/TextExtractionIndicator.vue';
import ValidationErrorDialog, {
  type ValidationItemInfo,
} from 'src/components/admin/ValidationErrorDialog.vue';
import VisibilityBadge from 'src/components/admin/VisibilityBadge.vue';

const props = defineProps<{ collection: 'records' | 'drafts' }>();

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const { canTransition, canSeeAttribution, isStaff } = useAuthz();
const { codeLabel } = useCodeLabel();
const { tl } = useSchemaLabel();
const schemaStore = useSchemaStore();
const taskCount = useTaskCountStore();

const isRecords = computed(() => props.collection === 'records');
const itemType = computed<ItemType>(() => (isRecords.value ? 'RECORD' : 'DRAFT'));

interface Row {
  id: string;
  title: string;
  author: string;
  year: string;
  cobissId: string;
  materialType: ResolvedCode | undefined;
  collectionType: number;
  visibilityStatus: VisibilityStatus;
  updatedAt: string;
  /** Empty for a fresh item until the CDC-lagged index catches up — render nothing, not "Unknown" */
  updatedBy: string;
  version: number;
  extraction: TextExtractionStatus | null;
}

// Worst PDF extraction status for the row indicator; null when there are no PDFs
function aggregateExtraction(source: IndexedRecord): TextExtractionStatus | null {
  const statuses = (source.file_attachments ?? [])
    .filter((f) => f.fileType === 'PDF')
    .map((f) => f.textExtractionStatus);
  if (!statuses.length) return null;
  for (const s of ['GARBAGE', 'NO_TEXT', 'NOT_EXTRACTED'] as const) {
    if (statuses.includes(s)) return s;
  }
  return 'EXTRACTED';
}

const rows = ref<Row[]>([]);
const selected = ref<Row[]>([]);
const loading = ref(false);
const pagination = ref({ page: 1, rowsPerPage: 20, rowsNumber: 0 });

// ---------------------------------------------------------------------------
// Filters — the URL query is the source of truth (nice-to-have A6)
// ---------------------------------------------------------------------------

interface Filters {
  q: string;
  /** English labels: the API filters `metadata.materialType.en`. */
  materialType: string[];
  /** `collectionType` codes, as strings. */
  collectionType: string[];
  mine: boolean;
  yearFrom: string;
  yearTo: string;
}

function one(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): string[] {
  return one(value).split(',').filter(Boolean);
}

function filtersFromRoute(): Filters {
  const q = route.query;
  return {
    q: one(q.q),
    materialType: list(q.materialType),
    collectionType: list(q.collectionType),
    mine: q.mine === '1',
    yearFrom: one(q.yearFrom),
    yearTo: one(q.yearTo),
  };
}

const filters = reactive<Filters>(filtersFromRoute());

function filtersToQuery(): LocationQueryRaw {
  return {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.materialType.length ? { materialType: filters.materialType.join(',') } : {}),
    ...(filters.collectionType.length ? { collectionType: filters.collectionType.join(',') } : {}),
    ...(filters.mine ? { mine: '1' } : {}),
    ...(filters.yearFrom ? { yearFrom: filters.yearFrom } : {}),
    ...(filters.yearTo ? { yearTo: filters.yearTo } : {}),
  };
}

function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
  filters[key] = value;
  void router.replace({ query: filtersToQuery() });
  void fetchPage(1, pagination.value.rowsPerPage);
}

function clearFilters() {
  Object.assign(filters, {
    materialType: [],
    collectionType: [],
    mine: false,
    yearFrom: '',
    yearTo: '',
  } satisfies Partial<Filters>);
  void router.replace({ query: filtersToQuery() });
  void fetchPage(1, pagination.value.rowsPerPage);
}

/** The search text is not counted: it has its own field above the table. */
const activeFilterCount = computed(
  () =>
    filters.materialType.length +
    filters.collectionType.length +
    Number(filters.mine) +
    Number(isYear(filters.yearFrom)) +
    Number(isYear(filters.yearTo)),
);

/** The API answers 400 to a year that is not four digits — a half-typed one is simply not sent. */
function isYear(value: string): boolean {
  return /^\d{4}$/.test(value);
}

// Material types actually in use in this collection, most frequent first.
const materialTypes = ref<ResolvedCode[]>([]);

const materialTypeOptions = computed(() =>
  materialTypes.value.map((type) => ({ label: codeLabel(type), value: type.en })),
);

async function loadMaterialTypes() {
  try {
    const result = await suggestValues({ field: 'materialType', type: props.collection, limit: 50 });
    materialTypes.value = result.suggestions.map((s) => s.value);
  } catch {
    materialTypes.value = [];
  }
}

// Collections first, "not a collection" last.
const collectionTypeOptions = computed(() =>
  [...schemaStore.values('collectionType')]
    .sort((a, b) => Number(a.code === 0) - Number(b.code === 0))
    .map((value) => ({ label: tl(value), value: String(value.code) })),
);

function collectionTypeLabel(code: number): string {
  const value = schemaStore.values('collectionType').find((v) => v.code === code);
  return value ? tl(value) : String(code);
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const columns = computed<QTableColumn<Row>[]>(() => [
  {
    name: 'item',
    label: isRecords.value ? t('admin.items.columns.record') : t('admin.items.columns.draft'),
    field: 'title',
    align: 'left',
  },
  {
    name: 'visibilityStatus',
    label: t('admin.items.columns.visibility'),
    field: 'visibilityStatus',
    align: 'left',
    style: 'width: 110px',
  },
  {
    name: 'updatedAt',
    label: t('admin.items.columns.updated'),
    field: 'updatedAt',
    align: 'left',
    style: 'width: 160px',
  },
  { name: 'actions', label: '', field: 'id', align: 'right', style: 'width: 96px' },
]);

function toRow(source: IndexedRecord): Row {
  const m = source.metadata;
  return {
    id: source.id,
    title: m?.title ?? '',
    author: m?.firstResponsibility ?? '',
    year: m?.publication?.year ?? m?.publicationDate1 ?? '',
    cobissId: m?.cobissId ?? '',
    materialType: m?.materialType,
    collectionType: typeof m?.collectionType === 'number' ? m.collectionType : 0,
    visibilityStatus: source.visibilityStatus,
    updatedAt: source.updatedAt,
    updatedBy: source.updatedByName ?? source.createdByName ?? '',
    version: source.version ?? 0,
    extraction: aggregateExtraction(source),
  };
}

async function fetchPage(page: number, limit: number) {
  loading.value = true;
  try {
    const result = await searchItems({
      type: props.collection,
      page,
      limit,
      // Without a search text there is nothing to rank by: newest first.
      sort: filters.q ? 'relevance' : 'newest',
      fields: [
        'metadata.title',
        'metadata.firstResponsibility',
        'metadata.publication.year',
        'metadata.publicationDate1',
        'metadata.cobissId',
        'metadata.materialType',
        'metadata.collectionType',
        'visibilityStatus',
        'updatedAt',
        'version',
        'file_attachments.fileType',
        'file_attachments.textExtractionStatus',
        // Served only to drafts:manage / records:manage; stripped silently otherwise
        'createdByName',
        'updatedByName',
      ].join(','),
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.materialType.length ? { materialType: filters.materialType.join(',') } : {}),
      ...(filters.collectionType.length ? { collectionType: filters.collectionType.join(',') } : {}),
      ...(filters.mine && auth.userId ? { createdBy: auth.userId } : {}),
      ...(isYear(filters.yearFrom) ? { yearFrom: filters.yearFrom } : {}),
      ...(isYear(filters.yearTo) ? { yearTo: filters.yearTo } : {}),
    });
    rows.value = result.hits.map((h) => toRow(h.source));
    pagination.value.page = result.page;
    pagination.value.rowsPerPage = result.limit;
    pagination.value.rowsNumber = result.total;
    void loadOpenTasks(rows.value.map((r) => r.id));
  } catch (err) {
    $q.notify({ type: 'negative', message: apiErrorMessage(err) ?? t('admin.items.loadFailed') });
  } finally {
    loading.value = false;
  }
}

const onRequest: QTableProps['onRequest'] = ({ pagination: p }) => {
  void fetchPage(p.page, p.rowsPerPage);
};

// pgsync → OpenSearch indexing is eventually consistent; wait a beat before refreshing
function refreshSoon() {
  selected.value = [];
  setTimeout(() => {
    void fetchPage(pagination.value.page, pagination.value.rowsPerPage);
    void loadTotals();
  }, 900);
}

// ── Open tasks ──
// One request per page of rows, not per row, and never a search facet: there
// is no open-task count on items (it would re-index the document on every task
// change), so the marker only decorates a page already fetched. An item has at
// most one open task, so the map is itemId → that task.
const openTasks = ref<Record<string, string>>({});

async function loadOpenTasks(ids: string[]) {
  if (!isStaff.value || ids.length === 0) {
    openTasks.value = {};
    return;
  }
  try {
    const result = await listTasks({
      itemIds: ids.slice(0, 200).join(','),
      status: 'OPEN',
      limit: 200,
    });
    openTasks.value = Object.fromEntries(result.tasks.map((task) => [task.itemId, task.id]));
  } catch {
    // Decoration only — a failed lookup must not break the list.
    openTasks.value = {};
  }
}

// ── Header caption: how many items this collection holds, and how many have an open task ──
const collectionTotal = ref<number | null>(null);
const withOpenTask = ref<number | null>(null);

async function loadTotals() {
  try {
    const result = await searchItems({ type: props.collection, limit: 1, fields: 'id' });
    collectionTotal.value = result.total;
  } catch {
    collectionTotal.value = null;
  }
  if (!isStaff.value) return;
  try {
    const result = await listTasks({ status: 'OPEN', limit: 200 });
    withOpenTask.value = result.tasks.filter((task) => task.itemType === itemType.value).length;
  } catch {
    withOpenTask.value = null;
  }
}

const caption = computed(() => {
  if (collectionTotal.value === null) return undefined;
  const count = formatCount(collectionTotal.value);
  const base = isRecords.value
    ? t('admin.items.captionRecords', { count })
    : t('admin.items.captionDrafts', { count });
  return withOpenTask.value
    ? `${base} · ${t('admin.items.withOpenTask', { count: withOpenTask.value })}`
    : base;
});

watch(
  () => props.collection,
  () => {
    selected.value = [];
    Object.assign(filters, filtersFromRoute());
    void loadMaterialTypes();
    void loadTotals();
    void fetchPage(1, pagination.value.rowsPerPage);
  },
);

onMounted(() => {
  void schemaStore.load();
  void loadMaterialTypes();
  void loadTotals();
  void fetchPage(1, pagination.value.rowsPerPage);
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function confirmDialog(message: string): Promise<void> {
  return new Promise((resolve) => {
    $q.dialog({
      title: t('admin.common.confirmTitle'),
      message,
      cancel: { flat: true, noCaps: true, color: 'primary', label: t('admin.common.cancel') },
      ok: { unelevated: true, noCaps: true, color: 'negative', label: t('admin.common.confirm') },
    }).onOk(() => resolve());
  });
}

async function runAction(action: () => Promise<unknown>, successMsg: string) {
  try {
    await action();
    $q.notify({ type: 'positive', message: successMsg });
    refreshSoon();
  } catch (err) {
    $q.notify({ type: 'negative', message: apiErrorMessage(err) ?? t('admin.common.actionFailed') });
  }
}

async function remove(targets: Row[]) {
  const ids = targets.map((r) => r.id);
  await confirmDialog(t('admin.items.deleteConfirm', { count: ids.length }));
  await runAction(() => deleteItems(ids), t('admin.items.deleted', { count: ids.length }));
}

// ── Publish / return to draft ──
// All-or-nothing on the server: one item that fails the check for the new
// state refuses the whole batch, and the answer names every failing item.
const validation = ref<ValidationFailure | null>(null);
const validationOpen = ref(false);
const validationItems = ref<Record<string, ValidationItemInfo>>({});
const validationTotal = ref(0);

async function transition(targets: Row[]) {
  const ids = targets.map((r) => r.id);
  try {
    await transitionItems(ids, isRecords.value ? 'DRAFT' : 'RECORD');
    $q.notify({ type: 'positive', message: t('admin.items.transitioned') });
    // Publishing closes review tasks, so the drawer count may have moved.
    void taskCount.refresh();
    refreshSoon();
  } catch (err) {
    const failure = validationFailure(err);
    if (!failure) {
      $q.notify({ type: 'negative', message: apiErrorMessage(err) ?? t('admin.common.actionFailed') });
      return;
    }
    validation.value = failure;
    validationTotal.value = ids.length;
    validationItems.value = Object.fromEntries(
      targets.map((r) => [
        r.id,
        { title: r.title, type: r.materialType ? codeLabel(r.materialType) : undefined },
      ]),
    );
    validationOpen.value = true;
  }
}

// A visibility-only PATCH cannot clash with concurrent metadata edits, so on a
// version conflict (search index may lag behind the DB) simply retry with the
// current version the server reported.
async function setVisibility(item: { id: string; version: number }, status: VisibilityStatus) {
  let expectedVersion = item.version;
  for (let attempt = 0; ; attempt++) {
    try {
      await updateItem(item.id, { visibilityStatus: status, expectedVersion });
      return;
    } catch (err) {
      const current = isVersionConflict(err) ? conflictCurrentVersion(err) : undefined;
      if (current === undefined || attempt >= 2) throw err;
      expectedVersion = current;
    }
  }
}

async function bulkSetVisibility(status: VisibilityStatus) {
  const targets = selected.value.map((r) => ({ id: r.id, version: r.version }));
  await runAction(
    () => Promise.all(targets.map((item) => setVisibility(item, status))),
    t('admin.items.visibilityUpdated', { count: targets.length }),
  );
}

// ── Assign task (one item from the row menu, or the selection) ──
const assignOpen = ref(false);
const assignItems = ref<BulkAssignItem[]>([]);

function openAssign(targets: Row[]) {
  assignItems.value = targets.map((r) => ({ id: r.id, title: r.title }));
  assignOpen.value = true;
}

function onTasksCreated() {
  void taskCount.refresh();
  void loadOpenTasks(rows.value.map((r) => r.id));
  void loadTotals();
}
</script>

<style scoped lang="sass">
.items-layout
  display: flex
  align-items: flex-start
  gap: 24px

.filter-rail
  width: 232px
  flex: none
  display: flex
  flex-direction: column

.filter-rail__title
  font-size: 15px
  font-weight: 700

.filter-group
  padding: 14px 0
  border-bottom: 1px solid $divider

.filter-group--last
  border-bottom: none

.filter-group__legend
  padding-bottom: 6px
  font-size: 12px
  letter-spacing: 0.06em
  text-transform: uppercase
  font-weight: 600
  color: $muted

.filter-group__options
  :deep(.q-checkbox)
    min-height: 32px

.year-input
  width: 90px

.items-table
  min-width: 0
  :deep(.q-table__top)
    padding: 14px 16px 0

.items-summary
  display: flex
  gap: 6px
  padding: 12px 0
  font-size: 13px
  color: $muted

.type-tile
  border-radius: $radius
  background: $paper-deep
  border: 1px solid $divider
  color: $primary

.item-cell
  min-width: 0
  gap: 2px

.item-cell__sub
  font-size: 13px
  color: $muted

.title-link
  color: $primary
  text-decoration: none
  font-weight: 600
  &:hover
    text-decoration: underline

.open-task
  text-decoration: underline
  text-decoration-color: #E8D5A8
  text-underline-offset: 2px

.updated-cell
  color: $ink-soft
  white-space: nowrap

.updated-cell__by
  font-size: 12px
  color: $muted

.row-menu
  min-width: 220px

.bulk-sticky
  z-index: 10

.bulk-bar
  display: flex
  align-items: center
  gap: 6px
  padding: 8px 8px 8px 18px
  background: $ink
  color: #fff
  border-radius: 12px
  box-shadow: 0 12px 32px rgba(28, 26, 21, 0.28)
  :deep(.q-btn)
    min-height: 40px
    padding: 0 14px
    font-weight: 500
    color: #fff

.bulk-bar__count
  font-size: 14px
  font-weight: 600
  white-space: nowrap

.bulk-bar__sep
  width: 1px
  height: 24px
  margin: 0 8px
  background: rgba(255, 255, 255, 0.2)

.bulk-bar__danger
  color: #F4B4A8 !important

.bulk-bar__clear
  padding: 0 !important
  width: 40px
  background: rgba(255, 255, 255, 0.08)
</style>
