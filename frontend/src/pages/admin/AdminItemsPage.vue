<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <div class="row items-center q-mb-md">
        <h1 class="text-h5 text-weight-bold q-my-none">
          {{ collection === 'records' ? t('admin.nav.records') : t('admin.nav.drafts') }}
        </h1>
        <q-space />
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="add"
          :label="collection === 'records' ? t('admin.dashboard.newRecord') : t('admin.dashboard.newDraft')"
          :to="`/admin/items/new?type=${collection === 'records' ? 'RECORD' : 'DRAFT'}`"
        />
      </div>

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
        class="items-table"
        @request="onRequest"
      >
        <template #top>
          <q-input
            v-model="searchText"
            dense
            outlined
            clearable
            debounce="400"
            :placeholder="t('admin.items.searchPlaceholder')"
            class="col-12 col-md-4"
          >
            <template #prepend><q-icon name="search" /></template>
          </q-input>

          <q-space />

          <!-- Bulk actions -->
          <div v-if="selected.length > 0" class="row items-center q-gutter-sm">
            <span class="text-caption text-grey-8">
              {{ t('admin.items.selected', { count: selected.length }) }}
            </span>
            <q-btn-dropdown
              outline
              dense
              no-caps
              color="primary"
              :label="t('admin.items.setVisibility')"
            >
              <q-list>
                <q-item
                  v-for="status in VISIBILITY_STATUSES"
                  :key="status"
                  v-close-popup
                  clickable
                  @click="bulkSetVisibility(status)"
                >
                  <q-item-section><VisibilityBadge :status="status" /></q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
            <q-btn
              v-if="canTransition"
              outline
              dense
              no-caps
              color="primary"
              :icon="collection === 'drafts' ? 'publish' : 'unpublished'"
              :label="collection === 'drafts' ? t('admin.items.publish') : t('admin.items.toDraft')"
              @click="bulkTransition"
            />
            <q-btn
              outline
              dense
              no-caps
              color="negative"
              icon="delete"
              :label="t('admin.items.delete')"
              @click="bulkDelete"
            />
          </div>
        </template>

        <template #body-cell-title="cellProps">
          <q-td :props="cellProps">
            <router-link :to="`/admin/items/${cellProps.row.id}`" class="title-link">
              {{ cellProps.value || '—' }}
            </router-link>
          </q-td>
        </template>

        <template #body-cell-visibilityStatus="cellProps">
          <q-td :props="cellProps">
            <VisibilityBadge :status="cellProps.value" />
          </q-td>
        </template>

        <template #body-cell-actions="cellProps">
          <q-td :props="cellProps" class="text-right">
            <q-btn flat dense round icon="edit" color="primary" :to="`/admin/items/${cellProps.row.id}`">
              <q-tooltip>{{ t('admin.items.edit') }}</q-tooltip>
            </q-btn>
            <q-btn
              v-if="collection === 'records'"
              flat
              dense
              round
              icon="open_in_new"
              color="grey-7"
              :to="`/catalog/${cellProps.row.id}`"
              target="_blank"
            >
              <q-tooltip>{{ t('admin.items.openPublic') }}</q-tooltip>
            </q-btn>
            <q-btn
              v-if="canTransition"
              flat
              dense
              round
              :icon="collection === 'drafts' ? 'publish' : 'unpublished'"
              color="primary"
              @click="transitionOne(cellProps.row)"
            >
              <q-tooltip>
                {{ collection === 'drafts' ? t('admin.items.publish') : t('admin.items.toDraft') }}
              </q-tooltip>
            </q-btn>
            <q-btn flat dense round icon="delete" color="negative" @click="deleteOne(cellProps.row)">
              <q-tooltip>{{ t('admin.items.delete') }}</q-tooltip>
            </q-btn>
          </q-td>
        </template>

        <template #no-data>
          <div class="full-width text-center q-pa-lg text-grey-7">
            {{ t('admin.items.empty') }}
          </div>
        </template>
      </q-table>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableColumn, type QTableProps } from 'quasar';
import { searchItems, type IndexedRecord } from 'src/api/search';
import {
  deleteItems,
  transitionItems,
  updateItem,
  VISIBILITY_STATUSES,
  type VisibilityStatus,
} from 'src/api/admin';
import { useAuthz } from 'src/composables/useAuthz';
import VisibilityBadge from 'src/components/admin/VisibilityBadge.vue';

const props = defineProps<{ collection: 'records' | 'drafts' }>();

const { t } = useI18n();
const $q = useQuasar();
const { canTransition } = useAuthz();

interface Row {
  id: string;
  title: string;
  author: string;
  year: string;
  cobissId: string;
  visibilityStatus: VisibilityStatus;
  updatedAt: string;
}

const rows = ref<Row[]>([]);
const selected = ref<Row[]>([]);
const loading = ref(false);
const searchText = ref('');
const pagination = ref({
  page: 1,
  rowsPerPage: 20,
  rowsNumber: 0,
});

const columns = computed<QTableColumn<Row>[]>(() => [
  { name: 'title', label: t('admin.items.columns.title'), field: 'title', align: 'left' },
  { name: 'author', label: t('admin.items.columns.author'), field: 'author', align: 'left' },
  { name: 'year', label: t('admin.items.columns.year'), field: 'year', align: 'left' },
  { name: 'cobissId', label: 'COBISS ID', field: 'cobissId', align: 'left' },
  {
    name: 'visibilityStatus',
    label: t('admin.items.columns.visibility'),
    field: 'visibilityStatus',
    align: 'left',
  },
  {
    name: 'updatedAt',
    label: t('admin.items.columns.updated'),
    field: 'updatedAt',
    align: 'left',
    format: (v: string) => (v ? new Date(v).toLocaleDateString() : '—'),
  },
  { name: 'actions', label: '', field: 'id', align: 'right' },
]);

function toRow(source: IndexedRecord): Row {
  const m = source.metadata;
  return {
    id: source.id,
    title: m?.title ?? '',
    author: m?.firstResponsibility ?? '',
    year: m?.publication?.year ?? m?.publicationDate1 ?? '',
    cobissId: m?.cobissId ?? '',
    visibilityStatus: source.visibilityStatus,
    updatedAt: source.updatedAt,
  };
}

async function fetchPage(page: number, limit: number) {
  loading.value = true;
  try {
    const result = await searchItems({
      type: props.collection,
      page,
      limit,
      ...(searchText.value ? { q: searchText.value } : {}),
    });
    rows.value = result.hits.map((h) => toRow(h.source));
    pagination.value.page = result.page;
    pagination.value.rowsPerPage = result.limit;
    pagination.value.rowsNumber = result.total;
  } catch {
    $q.notify({ type: 'negative', message: t('admin.items.loadFailed') });
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
  setTimeout(() => void fetchPage(pagination.value.page, pagination.value.rowsPerPage), 900);
}

watch(searchText, () => void fetchPage(1, pagination.value.rowsPerPage));
watch(
  () => props.collection,
  () => {
    selected.value = [];
    searchText.value = '';
    void fetchPage(1, pagination.value.rowsPerPage);
  },
);
onMounted(() => void fetchPage(1, pagination.value.rowsPerPage));

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function confirmDialog(message: string): Promise<void> {
  return new Promise((resolve) => {
    $q.dialog({
      title: t('admin.items.confirmTitle'),
      message,
      cancel: { flat: true, noCaps: true, label: t('admin.items.cancel') },
      ok: { unelevated: true, noCaps: true, color: 'negative', label: t('admin.items.confirm') },
    }).onOk(() => resolve());
  });
}

async function runAction(action: () => Promise<void>, successMsg: string) {
  try {
    await action();
    $q.notify({ type: 'positive', message: successMsg });
    refreshSoon();
  } catch (err) {
    const detail =
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: detail ? String(detail) : t('admin.items.actionFailed'),
    });
  }
}

async function deleteOne(row: Row) {
  await confirmDialog(t('admin.items.deleteConfirm', { count: 1 }));
  await runAction(() => deleteItems([row.id]), t('admin.items.deleted', { count: 1 }));
}

async function bulkDelete() {
  const ids = selected.value.map((r) => r.id);
  await confirmDialog(t('admin.items.deleteConfirm', { count: ids.length }));
  await runAction(() => deleteItems(ids), t('admin.items.deleted', { count: ids.length }));
}

async function transitionOne(row: Row) {
  const target = props.collection === 'drafts' ? 'RECORD' : 'DRAFT';
  await runAction(() => transitionItems([row.id], target), t('admin.items.transitioned'));
}

async function bulkTransition() {
  const ids = selected.value.map((r) => r.id);
  const target = props.collection === 'drafts' ? 'RECORD' : 'DRAFT';
  await runAction(() => transitionItems(ids, target), t('admin.items.transitioned'));
}

async function bulkSetVisibility(status: VisibilityStatus) {
  const ids = selected.value.map((r) => r.id);
  await runAction(
    async () => {
      await Promise.all(ids.map((id) => updateItem(id, { visibilityStatus: status })));
    },
    t('admin.items.visibilityUpdated', { count: ids.length }),
  );
}
</script>

<style scoped lang="sass">
.page-body
  max-width: 1280px
  margin: 0 auto

.items-table
  background: white
  border-radius: 12px

.title-link
  color: $primary
  text-decoration: none
  font-weight: 600
  &:hover
    text-decoration: underline
</style>
