<template>
  <div>
    <div v-if="error" class="text-negative q-pa-md">{{ t('admin.history.loadFailed') }}</div>

    <div v-else-if="loading && revisions.length === 0" class="q-pa-md">
      <q-skeleton v-for="i in 4" :key="i" type="text" class="q-mb-md" />
    </div>

    <div v-else-if="revisions.length === 0" class="text-library-muted q-pa-md text-center">
      {{ t('admin.history.empty') }}
    </div>

    <!-- Keyed on revision id — two revisions can share a version, never key on it -->
    <q-list v-else separator>
      <q-item v-for="revision in revisions" :key="revision.id" class="q-py-md">
        <q-item-section avatar top>
          <q-icon
            :name="actionMeta(revision.action).icon"
            :color="actionMeta(revision.action).color"
            size="22px"
          />
        </q-item-section>
        <q-item-section>
          <q-item-label>
            <span class="text-weight-bold">{{ t(`admin.history.actions.${revision.action}`) }}</span>
            <span class="text-library-muted"> · {{ revision.userName || revision.userId }}</span>
          </q-item-label>
          <q-item-label caption>
            {{ new Date(revision.createdAt).toLocaleString() }}
          </q-item-label>

          <div v-if="revision.changes?.length" class="changes q-mt-sm">
            <div v-for="(change, ci) in revision.changes" :key="ci" class="change-row">
              <div class="change-field">{{ pathLabel(change.path) }}</div>
              <div class="change-values">
                <ChangeValue :value="change.before" />
                <q-icon name="arrow_forward" size="14px" class="text-library-muted" />
                <ChangeValue :value="change.after" />
              </div>
            </div>
          </div>
        </q-item-section>
      </q-item>
    </q-list>

    <div v-if="revisions.length > 0 && revisions.length < total" class="text-center q-py-md">
      <q-btn
        outline
        no-caps
        color="primary"
        :loading="loading"
        :label="t('admin.history.loadMore')"
        @click="loadMore"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getItemHistory, type ChangeAction, type ItemRevision } from 'src/api/admin';

const props = defineProps<{ itemId: string }>();

const i18n = useI18n();
const { t } = i18n;

const PAGE_SIZE = 50;

const revisions = ref<ItemRevision[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref(false);

async function load(offset: number) {
  loading.value = true;
  try {
    const result = await getItemHistory(props.itemId, { limit: PAGE_SIZE, offset });
    total.value = result.total;
    revisions.value = offset === 0 ? result.revisions : [...revisions.value, ...result.revisions];
    error.value = false;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  void load(revisions.value.length);
}

onMounted(() => void load(0));
watch(
  () => props.itemId,
  () => {
    revisions.value = [];
    total.value = 0;
    void load(0);
  },
);

// ── Presentation ──

const ACTION_META: Record<ChangeAction, { icon: string; color: string }> = {
  CREATE: { icon: 'add_circle', color: 'positive' },
  UPDATE: { icon: 'edit', color: 'primary' },
  PUBLISH: { icon: 'publish', color: 'positive' },
  UNPUBLISH: { icon: 'unpublished', color: 'warning' },
  VISIBILITY_CHANGE: { icon: 'visibility', color: 'info' },
  FILE_ADDED: { icon: 'upload_file', color: 'primary' },
  FILE_REMOVED: { icon: 'file_download_off', color: 'negative' },
  RELATION_ADDED: { icon: 'add_link', color: 'primary' },
  RELATION_REMOVED: { icon: 'link_off', color: 'negative' },
  DELETE: { icon: 'delete_forever', color: 'negative' },
};

function actionMeta(action: ChangeAction) {
  return ACTION_META[action] ?? { icon: 'help_outline', color: 'grey' };
}

/**
 * Human-readable label for a change path. `authors[0].familyName` becomes
 * "Authors 1 › Family name"; synthetic paths (`files[<id>]`, `children[<id>]`)
 * get their own labels. Unknown segments fall back to the raw name.
 */
function pathLabel(path: string): string {
  if (path.startsWith('files[')) return t('admin.history.fields.file');
  if (path.startsWith('children[')) return t('admin.history.fields.child');

  return path
    .split('.')
    .map((segment) => {
      const match = /^([^[]+)(?:\[(\d+)\])?$/.exec(segment);
      if (!match) return segment;
      const key = `admin.history.fields.${match[1]!}`;
      const label = i18n.te(key) ? t(key) : match[1]!;
      return match[2] !== undefined ? `${label} ${Number(match[2]) + 1}` : label;
    })
    .join(' › ');
}

/**
 * A before/after can be any JSON value — a string, a number, null, or a whole
 * nested object when a subtree changed at once. Objects render as pretty JSON;
 * absence renders as a muted em dash, never as the string "null".
 */
const ChangeValue = (valueProps: { value: unknown }) => {
  const value = valueProps.value;
  if (value === null || value === undefined || value === '') {
    return h('span', { class: 'value-empty' }, '—');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return h('span', { class: 'value-scalar' }, String(value));
  }
  return h('pre', { class: 'value-json' }, JSON.stringify(value, null, 1));
};
</script>

<style scoped lang="sass">
.changes
  border-left: 2px solid $divider
  padding-left: 12px
  display: flex
  flex-direction: column
  gap: 8px

.change-field
  font-size: 12px
  font-weight: 600
  color: $muted

.change-values
  display: flex
  align-items: baseline
  gap: 8px
  flex-wrap: wrap

:deep(.value-scalar)
  font-size: 13px
  color: $ink
  overflow-wrap: anywhere

:deep(.value-empty)
  color: $muted

:deep(.value-json)
  margin: 0
  padding: 4px 8px
  font-size: 12px
  font-family: monospace
  background: rgba(0, 0, 0, 0.04)
  border-radius: 4px
  max-width: 100%
  max-height: 160px
  overflow: auto
  white-space: pre-wrap
  overflow-wrap: anywhere
</style>
