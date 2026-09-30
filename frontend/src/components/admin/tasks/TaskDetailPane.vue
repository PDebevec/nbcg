<template>
  <q-card flat bordered class="pane">
    <div v-if="loadError" class="q-pa-lg">
      <q-banner class="bg-negative text-white" rounded>{{ t('admin.tasks.detail.loadFailed') }}</q-banner>
    </div>

    <div v-else-if="!task" class="q-pa-lg">
      <q-skeleton v-for="i in 5" :key="i" type="text" class="q-mb-md" />
    </div>

    <template v-else>
      <div class="pane__head">
        <div class="row items-center no-wrap q-gutter-x-sm">
          <TaskStatusBadge :status="task.status" :returned="task.lastHandoff === 'RETURNED'" />
          <q-badge class="badge-soft badge-soft--outline">{{ t(`admin.tasks.kinds.${task.kind}`) }}</q-badge>
          <q-space />
          <router-link :to="`/admin/tasks/${task.id}`" class="adm-link">
            {{ t('admin.tasks.pane.fullPage') }}
            <q-icon name="o_arrow_forward" size="16px" />
          </router-link>
          <q-btn
            v-if="permissions.canManage"
            outline
            dense
            color="primary"
            icon="o_more_horiz"
            class="pane__icon-btn"
            :aria-label="t('admin.tasks.detail.moreActions')"
          >
            <q-menu auto-close anchor="bottom right" self="top right">
              <q-list dense style="min-width: 200px">
                <q-item clickable @click="dialog = 'reassign'">
                  <q-item-section avatar><q-icon name="o_swap_horiz" size="18px" /></q-item-section>
                  <q-item-section>{{ t('admin.tasks.detail.reassign') }}</q-item-section>
                </q-item>
                <q-item clickable class="text-negative" @click="dialog = 'cancel'">
                  <q-item-section avatar><q-icon name="o_block" size="18px" /></q-item-section>
                  <q-item-section>{{ t('admin.tasks.detail.cancel') }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
          <q-btn
            outline
            dense
            color="primary"
            icon="o_close"
            class="pane__icon-btn"
            :aria-label="t('admin.tasks.pane.close')"
            @click="emit('close')"
          />
        </div>

        <h2 class="pane__title">{{ task.title }}</h2>

        <div class="pane__facts">
          <div>
            <span class="pane__fact-label">{{ t('admin.tasks.detail.assignedTo') }}</span>
            <span class="pane__fact-value">
              <UserAvatar :name="task.assignedToName" :size="22" />
              <span class="ellipsis">{{ task.assignedToName }}</span>
            </span>
          </div>
          <div>
            <span class="pane__fact-label">{{ t('admin.tasks.detail.createdBy') }}</span>
            <span class="pane__fact-value">
              <UserAvatar :name="task.createdByName" :size="22" />
              <span class="ellipsis">{{ task.createdByName }}</span>
            </span>
          </div>
          <div>
            <span class="pane__fact-label">{{ t('admin.tasks.detail.created') }}</span>
            <span class="pane__fact-value">{{ formatDate(task.createdAt, locale) }}</span>
          </div>
          <div>
            <span class="pane__fact-label">{{ t('admin.tasks.columns.updated') }}</span>
            <span class="pane__fact-value"><RelativeTime :value="task.updatedAt" /></span>
          </div>
        </div>
      </div>

      <div class="pane__body">
        <!-- The item the task is about -->
        <router-link v-if="task.itemType" :to="`/admin/items/${task.itemId}`" class="item-card">
          <q-avatar square size="44px" class="item-card__tile">
            <q-icon :name="materialTypeIcon(item?.materialType?.code)" size="20px" />
          </q-avatar>
          <div class="col column item-card__text">
            <span class="item-card__title ellipsis">
              <q-skeleton v-if="itemLoading" type="text" width="220px" />
              <template v-else>{{ item?.title || t(`admin.itemType.${task.itemType}`) }}</template>
            </span>
            <span class="item-card__sub ellipsis">{{ itemLine }}</span>
          </div>
          <span class="adm-link">
            {{ t('admin.common.openInEditor') }}
            <q-icon name="o_arrow_forward" size="16px" />
          </span>
        </router-link>
        <div v-else class="adm-note">
          <q-icon name="o_info" />
          <span>{{ t('admin.tasks.itemType.gone') }}</span>
        </div>

        <!-- It came back: the reason is the first thing to read -->
        <div v-if="returned" class="returned-note">
          <UserAvatar :name="returned.userName" :size="30" />
          <div class="column">
            <span class="returned-note__head">
              {{
                t('admin.tasks.detail.returnedBy', {
                  name: returned.userName,
                  when: formatDateTime(returned.createdAt, locale),
                })
              }}
            </span>
            <span class="returned-note__text">{{ returned.note }}</span>
          </div>
        </div>

        <div v-if="task.description" class="column q-gutter-y-xs">
          <span class="pane__fact-label">{{ t('admin.tasks.detail.description') }}</span>
          <p class="pane__description">{{ task.description }}</p>
        </div>

        <div v-if="latest" class="column q-gutter-y-sm">
          <span class="pane__fact-label">{{ t('admin.tasks.pane.latest') }}</span>
          <TaskHistoryList :entries="[latest]" :known-names="knownNames" />
          <router-link :to="`/admin/tasks/${task.id}`" class="adm-link">
            {{ t('admin.tasks.pane.showAll', { count: task.history.length }) }}
          </router-link>
        </div>
      </div>

      <div class="pane__foot">
        <q-input
          v-model="commentText"
          outlined
          dense
          class="col"
          :placeholder="t('admin.tasks.detail.commentPlaceholder')"
          :aria-label="t('admin.tasks.detail.commentPlaceholder')"
          :loading="commenting"
          @keydown.enter.prevent="sendComment"
        >
          <template #prepend><q-icon name="o_chat_bubble_outline" size="18px" /></template>
        </q-input>
        <template v-if="permissions.open">
          <q-btn
            v-if="permissions.canReturn"
            outline
            no-caps
            color="primary"
            icon="o_undo"
            :label="t('admin.tasks.detail.returnAction')"
            :disable="!task.returnTarget"
            @click="dialog = 'return'"
          >
            <q-tooltip v-if="!task.returnTarget">{{ t('admin.tasks.detail.noReturnTarget') }}</q-tooltip>
          </q-btn>
          <q-btn
            v-if="permissions.canComplete"
            unelevated
            no-caps
            color="primary"
            :icon="mode === 'handOn' ? 'o_arrow_forward' : mode === 'publish' ? 'o_publish' : 'o_check'"
            :label="t(`admin.tasks.complete.label.${mode}`)"
            @click="dialog = 'complete'"
          />
        </template>
      </div>

      <TaskActionDialogs v-model:dialog="dialog" :task="task" :item="item" @done="onActionDone" />
    </template>
  </q-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { apiErrorMessage } from 'src/api/errors';
import { addTaskComment, getTask, type TaskDetail } from 'src/api/tasks';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { useItemSummary } from 'src/composables/useItemSummary';
import { formatDate, formatDateTime } from 'src/utils/adminFormat';
import { materialTypeIcon } from 'src/utils/materialType';
import { completeMode, returnNote, taskPermissions } from 'src/utils/taskRules';
import RelativeTime from 'src/components/admin/RelativeTime.vue';
import TaskHistoryList from 'src/components/admin/TaskHistoryList.vue';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';
import TaskActionDialogs from './TaskActionDialogs.vue';
import type { TaskDialog } from './types';

// ---------------------------------------------------------------------------
// The inbox's right-hand pane: one task, enough to act on it without leaving
// the list — who holds it, the item, why it came back, the latest event, a
// comment box and the two actions. Everything else is on the full task page.
// ---------------------------------------------------------------------------

const props = defineProps<{ taskId: string }>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** An action moved the task — the list behind the pane is stale. */
  (e: 'changed'): void;
}>();

const { t, locale } = useI18n();
const $q = useQuasar();
const { canManageRecords } = useAuthz();
const { codeLabel } = useCodeLabel();

const task = ref<TaskDetail | null>(null);
const loadError = ref(false);
const dialog = ref<TaskDialog | null>(null);

const { item, loading: itemLoading, reload: reloadItem } = useItemSummary(
  computed(() => task.value?.itemId),
);

async function load() {
  const id = props.taskId;
  try {
    const result = await getTask(id);
    if (props.taskId !== id) return;
    task.value = result;
    loadError.value = false;
  } catch {
    if (props.taskId === id) loadError.value = true;
  }
}

watch(
  () => props.taskId,
  () => {
    task.value = null;
    dialog.value = null;
    commentText.value = '';
    void load();
  },
);
void load();

const permissions = computed(() => taskPermissions(task.value, auth.userId, canManageRecords.value));
const mode = computed(() => (task.value ? completeMode(task.value) : 'general'));
const returned = computed(() => (task.value ? returnNote(task.value, task.value.history) : undefined));

/** The most recent event that is not the return already shown above. */
const latest = computed(() => {
  const history = task.value?.history ?? [];
  return [...history].reverse().find((entry) => entry.id !== returned.value?.id);
});

const knownNames = computed<Record<string, string>>(() => {
  if (!task.value) return {};
  const names: Record<string, string> = {
    [task.value.assignedToUserId]: task.value.assignedToName,
    [task.value.createdByUserId]: task.value.createdByName,
  };
  const target = task.value.returnTarget;
  if (target) names[target.userId] = target.displayName;
  return names;
});

/** "Dimitrije Milaković · 1856 · Book · Record · COBISS 512346123" */
const itemLine = computed(() =>
  [
    item.value?.author,
    item.value?.year,
    item.value?.materialType ? codeLabel(item.value.materialType) : undefined,
    task.value?.itemType ? t(`admin.itemType.${task.value.itemType}`) : undefined,
    item.value?.cobissId ? `COBISS ${item.value.cobissId}` : undefined,
  ]
    .filter(Boolean)
    .join(' · '),
);

function onActionDone() {
  void load();
  void reloadItem();
  emit('changed');
}

// ── Comments ──

const commentText = ref('');
const commenting = ref(false);

async function sendComment() {
  const body = commentText.value.trim();
  if (!body || !task.value || commenting.value) return;
  commenting.value = true;
  try {
    const entry = await addTaskComment(task.value.id, body);
    task.value.history.push(entry);
    commentText.value = '';
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: apiErrorMessage(err) ?? t('admin.tasks.detail.commentFailed'),
    });
  } finally {
    commenting.value = false;
  }
}
</script>

<style scoped lang="sass">
.pane
  display: flex
  flex-direction: column
  border-radius: 10px
  overflow: hidden
  box-shadow: -8px 0 24px rgba(28, 26, 21, 0.08)

.pane__head
  display: flex
  flex-direction: column
  gap: 12px
  padding: 24px 28px 20px
  border-bottom: 1px solid $divider

.pane__icon-btn
  width: 40px
  min-height: 40px !important
  padding: 0 !important

.pane__title
  margin: 0
  font-family: $admin-serif
  font-size: 26px
  font-weight: 600
  line-height: 1.2
  letter-spacing: 0
  color: $ink

.pane__facts
  display: grid
  grid-template-columns: repeat(4, minmax(0, 1fr))
  gap: 16px
  padding-top: 4px
  > div
    display: flex
    flex-direction: column
    gap: 4px
    min-width: 0

.pane__fact-label
  font-size: 12px
  letter-spacing: 0.06em
  text-transform: uppercase
  font-weight: 600
  color: $muted

.pane__fact-value
  display: flex
  align-items: center
  gap: 8px
  min-width: 0
  font-size: 14px

.pane__body
  display: flex
  flex-direction: column
  gap: 18px
  padding: 20px 28px
  flex: 1 1 auto

.pane__description
  margin: 0
  font-size: 15px
  line-height: 1.55
  white-space: pre-wrap
  overflow-wrap: anywhere

.item-card
  display: flex
  align-items: center
  gap: 14px
  padding: 14px 16px
  background: $paper-deep
  border: 1px solid $divider
  border-radius: $radius
  text-decoration: none
  color: inherit
  &:hover
    border-color: $field-border
    color: inherit

.item-card__tile
  border-radius: $radius
  border: 1px solid $divider
  background: $paper-deep
  color: $primary

.item-card__text
  min-width: 0
  gap: 2px

.item-card__title
  font-family: $admin-serif
  font-size: 17px
  font-weight: 600
  color: $ink

.item-card__sub
  font-size: 13px
  color: $muted

.returned-note
  display: flex
  gap: 12px
  padding: 14px 16px
  background: #FBF3E2
  border: 1px solid #EAD7AE
  border-radius: $radius

.returned-note__head
  font-size: 13px
  font-weight: 600
  color: $soft-warning-ink

.returned-note__text
  font-size: 15px
  line-height: 1.5
  white-space: pre-wrap
  overflow-wrap: anywhere

.pane__foot
  display: flex
  align-items: center
  gap: 10px
  padding: 16px 28px
  border-top: 1px solid $divider
  background: $paper-deep
</style>
