<template>
  <q-dialog :model-value="modelValue" :persistent="saving" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="adm-dialog adm-dialog--wide">
      <div class="adm-dialog__head">
        <h2 class="adm-dialog__title col">{{ t('admin.edit.contents.addTitle') }}</h2>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :disable="saving" />
      </div>

      <div class="adm-dialog__body">
        <q-input
          v-model="query"
          outlined
          dense
          clearable
          debounce="300"
          :placeholder="t('admin.edit.contents.searchPlaceholder')"
        >
          <template #prepend><q-icon name="o_search" /></template>
        </q-input>

        <q-list bordered separator class="add-list">
          <template v-if="loading">
            <q-item v-for="i in 5" :key="i">
              <q-item-section side><q-skeleton type="QCheckbox" /></q-item-section>
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
            tag="label"
            :disable="isMember(hit)"
          >
            <q-item-section side>
              <q-checkbox
                :model-value="isMember(hit) || selected.has(hit.id)"
                :disable="isMember(hit)"
                @update:model-value="toggle(hit)"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ hit.source.metadata.title || hit.id }}</q-item-label>
              <q-item-label caption>{{ caption(hit) }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge v-if="isMember(hit)" class="badge-soft badge-soft--sm badge-soft--muted">
                {{ t('admin.edit.contents.alreadyIn') }}
              </q-badge>
              <q-badge v-else class="badge-soft badge-soft--sm badge-soft--outline">
                {{ t(`admin.itemType.${itemType(hit)}`) }}
              </q-badge>
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <div class="adm-dialog__foot">
        <span class="adm-dialog__foot-note">{{ t('admin.edit.contents.selected', { count: selected.size }) }}</span>
        <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.common.cancel')" :disable="saving" />
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="o_add"
          :label="t('admin.edit.contents.addSubmit', { count: selected.size }, selected.size)"
          :loading="saving"
          :disable="selected.size === 0"
          @click="submit"
        />
      </div>
    </q-card>

    <ValidationErrorDialog
      v-model="failureOpen"
      :failure="failure"
      action="link"
      :items="failureItems"
      :total="failureTotal"
    />
  </q-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { connectChildren, type ParentState } from 'src/api/admin';
import { apiErrorMessage, validationFailure, type ValidationFailure } from 'src/api/errors';
import { searchItems, type SearchHit } from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import ValidationErrorDialog, { type ValidationItemInfo } from 'src/components/admin/ValidationErrorDialog.vue';

// Prototype: pick drafts and records and link them under a collection
// (`POST /relations/connect`). The server checks each child with its new
// parent, all-or-nothing; a refusal opens the usual validation dialog.

const props = defineProps<{
  modelValue: boolean;
  parentId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'added', state: ParentState): void;
}>();

const { t } = useI18n();
const $q = useQuasar();
const { codeLabel } = useCodeLabel();

const FIELDS = [
  'metadata.title',
  'metadata.materialType',
  'metadata.firstResponsibility',
  'metadata.publicationDate1',
  'metadata.publication.place',
  'metadata.publication.publisher',
  'parent_relations',
].join(',');

const query = ref<string | null>('');
const hits = ref<SearchHit[]>([]);
const loading = ref(false);
const saving = ref(false);
/** id → title, so the validation dialog can name what failed. */
const selected = reactive(new Map<string, string>());

const failure = ref<ValidationFailure | null>(null);
const failureOpen = ref(false);
const failureItems = ref<Record<string, ValidationItemInfo>>({});
const failureTotal = ref(0);

async function search() {
  loading.value = true;
  const q = query.value?.trim() ?? '';
  try {
    const result = await searchItems({
      type: 'all',
      limit: 20,
      fields: FIELDS,
      ...(q ? { q } : { sort: 'newest' as const }),
    });
    // The collection itself cannot be its own child.
    hits.value = result.hits.filter((hit) => hit.id !== props.parentId);
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
    selected.clear();
    void search();
  },
);
watch(query, () => void search());

function isMember(hit: SearchHit): boolean {
  return (hit.source.parent_relations ?? []).some((relation) => relation.parentId === props.parentId);
}

function itemType(hit: SearchHit): 'RECORD' | 'DRAFT' {
  return hit.index.startsWith('drafts') ? 'DRAFT' : 'RECORD';
}

function caption(hit: SearchHit): string {
  const m = hit.source.metadata;
  const pub = [m.publication?.place, m.publication?.publisher].filter(Boolean).join(': ');
  return [m.materialType && codeLabel(m.materialType), m.firstResponsibility || pub, m.publicationDate1]
    .filter(Boolean)
    .join(' · ');
}

function toggle(hit: SearchHit) {
  if (isMember(hit)) return;
  if (selected.has(hit.id)) selected.delete(hit.id);
  else selected.set(hit.id, hit.source.metadata.title || hit.id);
}

async function submit() {
  const ids = [...selected.keys()];
  saving.value = true;
  try {
    const state = await connectChildren(props.parentId, ids);
    $q.notify({ message: t('admin.edit.contents.added', { count: ids.length }, ids.length), icon: 'o_check', color: 'positive' });
    emit('added', state);
    emit('update:modelValue', false);
  } catch (err) {
    const refused = validationFailure(err);
    if (refused) {
      failure.value = refused;
      failureItems.value = Object.fromEntries(ids.map((id) => [id, { title: selected.get(id) ?? id }]));
      failureTotal.value = ids.length;
      failureOpen.value = true;
    } else {
      $q.notify({ message: apiErrorMessage(err) ?? t('admin.edit.contents.addFailed'), color: 'negative' });
    }
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="sass">
.add-list
  max-height: 420px
  overflow-y: auto
  border-radius: 8px
</style>
