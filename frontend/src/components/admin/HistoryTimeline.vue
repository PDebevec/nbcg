<template>
  <div>
    <div v-if="error" class="text-negative q-pa-md">{{ t('admin.history.loadFailed') }}</div>

    <div v-else-if="loading && revisions.length === 0" class="q-pa-md">
      <q-skeleton v-for="i in 4" :key="i" type="text" class="q-mb-md" />
    </div>

    <div v-else-if="revisions.length === 0" class="adm-empty">{{ t('admin.history.empty') }}</div>

    <!-- Keyed on revision id — two revisions can share a version, never key on it -->
    <template v-else>
      <div v-for="(revision, index) in revisions" :key="revision.id" class="event">
        <div class="event__rail">
          <q-avatar size="28px" :class="`event__icon event__icon--${actionMeta(revision.action).tone}`">
            <q-icon :name="actionMeta(revision.action).icon" size="14px" />
          </q-avatar>
          <div v-if="index < revisions.length - 1" class="event__line" />
        </div>
        <div class="event__body">
          <div class="event__head">
            <span class="text-weight-bold">{{ t(`admin.history.actions.${revision.action}`) }}</span>
            <span class="adm-muted">{{ t('admin.items.by', { name: revision.userName || revision.userId }) }}</span>
            <span class="event__time">{{ formatDateTime(revision.createdAt, locale) }}</span>
          </div>

          <div v-if="revision.changes?.length" class="event__changes">
            <template v-for="(change, ci) in revision.changes" :key="ci">
              <span class="event__field">{{ pathLabel(change.path) }}</span>
              <span class="event__values">
                <ChangeValue :value="change.before" before />
                <span class="event__arrow">→</span>
                <ChangeValue :value="change.after" />
              </span>
            </template>
          </div>
        </div>
      </div>
    </template>

    <div v-if="revisions.length > 0 && revisions.length < total" class="event-more">
      <q-btn
        outline
        no-caps
        dense
        color="primary"
        :loading="loading"
        :label="t('admin.common.loadMore')"
        @click="loadMore"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getItemHistory, type ChangeAction, type ItemRevision } from 'src/api/admin';
import { formatDateTime } from 'src/utils/adminFormat';

// The revision timeline of one item: who changed what, newest first, paged.

const props = defineProps<{ itemId: string }>();

const i18n = useI18n();
const { t, locale } = i18n;

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

/** Reload from the top — after a save, a publish or a file change on the same page. */
function refresh() {
  void load(0);
}

defineExpose({ refresh });

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

type Tone = 'positive' | 'warning' | 'primary' | 'negative';

const ACTION_META: Record<ChangeAction, { icon: string; tone: Tone }> = {
  CREATE: { icon: 'o_add', tone: 'positive' },
  UPDATE: { icon: 'o_edit', tone: 'primary' },
  PUBLISH: { icon: 'o_publish', tone: 'positive' },
  UNPUBLISH: { icon: 'o_unpublished', tone: 'warning' },
  VISIBILITY_CHANGE: { icon: 'o_visibility', tone: 'primary' },
  FILE_ADDED: { icon: 'o_attach_file', tone: 'primary' },
  FILE_REMOVED: { icon: 'o_delete', tone: 'negative' },
  RELATION_ADDED: { icon: 'o_add_link', tone: 'primary' },
  RELATION_REMOVED: { icon: 'o_link_off', tone: 'negative' },
  DELETE: { icon: 'o_delete_forever', tone: 'negative' },
};

function actionMeta(action: ChangeAction) {
  return ACTION_META[action] ?? { icon: 'o_help_outline', tone: 'primary' as Tone };
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
const ChangeValue = (valueProps: { value: unknown; before?: boolean }) => {
  const value = valueProps.value;
  if (value === null || value === undefined || value === '') {
    return h('span', { class: 'value-empty' }, '—');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return h(
      'span',
      { class: valueProps.before ? 'value-scalar value-before' : 'value-scalar' },
      String(value),
    );
  }
  return h('pre', { class: 'value-json' }, JSON.stringify(value, null, 1));
};
</script>

<style scoped lang="sass">
.event
  display: flex
  gap: 14px

.event__rail
  display: flex
  flex-direction: column
  align-items: center
  width: 28px
  flex: none

.event__icon--positive
  background: $soft-positive
  color: $soft-positive-ink

.event__icon--warning
  background: $soft-warning
  color: $soft-warning-ink

.event__icon--primary
  background: $soft-primary
  color: $primary

.event__icon--negative
  background: $soft-negative
  color: $soft-negative-ink

.event__line
  width: 2px
  flex: 1 1 auto
  margin-top: 4px
  background: $divider-soft

.event__body
  flex: 1 1 auto
  min-width: 0
  padding-bottom: 18px

.event__head
  display: flex
  flex-wrap: wrap
  align-items: baseline
  gap: 4px 6px
  min-height: 28px
  padding-top: 3px
  font-size: 14px

.event__time
  margin-left: auto
  font-size: 12px
  color: $muted
  white-space: nowrap

.event__changes
  margin-top: 8px
  display: grid
  grid-template-columns: 160px minmax(0, 1fr)
  row-gap: 6px
  column-gap: 12px
  padding: 10px 14px
  background: $paper-deep
  border-radius: $radius
  font-size: 13px

.event__field
  font-weight: 600
  color: $muted

.event__values
  display: flex
  flex-wrap: wrap
  align-items: baseline
  gap: 8px
  min-width: 0

.event__arrow
  color: #8A8272

.event-more
  display: flex
  justify-content: center
  padding-top: 12px
  margin-top: 8px
  border-top: 1px solid $divider-soft

:deep(.value-scalar)
  font-weight: 500
  overflow-wrap: anywhere

:deep(.value-before)
  font-weight: 400
  color: #8A8272
  text-decoration: line-through

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
