<template>
  <q-dialog :model-value="modelValue" :persistent="busy" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="adm-dialog adm-dialog--wide">
      <div class="adm-dialog__head">
        <h2 class="adm-dialog__title col">{{ t('admin.edit.parent.addTitle') }}</h2>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :disable="busy" />
      </div>

      <div class="adm-dialog__body">
        <q-input
          v-model="query"
          outlined
          dense
          clearable
          debounce="300"
          :placeholder="t('admin.edit.parent.searchPlaceholder')"
        >
          <template #prepend><q-icon name="o_search" /></template>
        </q-input>

        <q-list bordered separator class="parent-list">
          <template v-if="loading">
            <q-item v-for="i in 5" :key="i">
              <q-item-section><q-skeleton type="text" width="60%" /></q-item-section>
            </q-item>
          </template>
          <q-item v-else-if="!hits.length">
            <q-item-section class="adm-muted">{{ t('admin.edit.contents.noResults') }}</q-item-section>
          </q-item>
          <q-item
            v-for="hit in hits"
            v-else
            :key="hit.id"
            v-ripple
            clickable
            :disable="busy || linked(hit)"
            @click="emit('pick', hit)"
          >
            <q-item-section avatar>
              <q-icon name="o_account_tree" color="primary" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ hit.source.metadata.title || hit.id }}</q-item-label>
              <q-item-label caption>{{ caption(hit) }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge v-if="linked(hit)" class="badge-soft badge-soft--sm badge-soft--muted">
                {{ t('admin.edit.parent.alreadyLinked') }}
              </q-badge>
              <q-badge v-else class="badge-soft badge-soft--sm badge-soft--outline">
                {{ t(`admin.itemType.${hit.index.startsWith('drafts') ? 'DRAFT' : 'RECORD'}`) }}
              </q-badge>
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <div class="adm-dialog__foot">
        <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.common.cancel')" :disable="busy" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { searchItems, type SearchHit } from 'src/api/search';
import { useSchemaLabel } from 'src/composables/useSchemaForm';
import { useSchemaStore } from 'src/stores/schema-store';

// Picks one collection (any collectionType > 0) to link the item under. The
// page does the linking: on a new item the choice waits for the save, on a
// saved one it is a `relations/connect` right away.

const props = defineProps<{
  modelValue: boolean;
  /** The item itself — never offered as its own parent. Absent on a new item. */
  itemId?: string | undefined;
  /** Parents the item already has. */
  linkedIds: string[];
  /** A link is being written: the list is locked. */
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'pick', hit: SearchHit): void;
}>();

const { t } = useI18n();
const { tl } = useSchemaLabel();
const schemaStore = useSchemaStore();

const FIELDS = ['metadata.title', 'metadata.collectionType', 'metadata.childrenInRecords', 'metadata.childrenInDrafts'].join(',');

const query = ref<string | null>('');
const hits = ref<SearchHit[]>([]);
const loading = ref(false);

async function search() {
  loading.value = true;
  const q = query.value?.trim() ?? '';
  try {
    const result = await searchItems({
      type: 'all',
      limit: 20,
      fields: FIELDS,
      collectionType: '>0',
      ...(q ? { q } : { sort: 'newest' as const }),
    });
    hits.value = result.hits.filter((hit) => hit.id !== props.itemId);
  } catch {
    hits.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    query.value = '';
    void search();
  },
);
watch(query, () => void search());

function linked(hit: SearchHit): boolean {
  return props.linkedIds.includes(hit.id);
}

function caption(hit: SearchHit): string {
  const m = hit.source.metadata;
  const count = Number(m.childrenInRecords ?? 0) + Number(m.childrenInDrafts ?? 0);
  const type = schemaStore.values('collectionType').find((value) => value.code === m.collectionType);
  return [type ? tl(type) : '', t('admin.edit.parent.children', { count })].filter(Boolean).join(' · ');
}
</script>

<style scoped lang="sass">
.parent-list
  max-height: 420px
  overflow-y: auto
  border-radius: 8px
</style>
