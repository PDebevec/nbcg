<template>
  <q-page class="adm-page">
    <AdminPageHeader
      :eyebrow="t('admin.tasks.title')"
      back-to="/admin/tasks"
      :title="task ? task.title : t('admin.tasks.detail.title')"
    >
      <template v-if="task" #title-append>
        <TaskStatusBadge :status="task.status" :returned="task.lastHandoff === 'RETURNED'" />
      </template>
      <template v-if="task" #caption>
        {{ t(`admin.tasks.kinds.${task.kind}`) }} ·
        {{ t('admin.tasks.detail.filedBy', { date: formatDate(task.createdAt, locale), name: task.createdByName }) }}
        <template v-if="task.itemType">
          · {{ t(`admin.tasks.detail.on.${task.itemType}`) }}
          <router-link :to="`/admin/items/${task.itemId}`" class="item-link">
            {{ item?.title || t('admin.tasks.openItem') }}
          </router-link>
        </template>
        <template v-else> · {{ t('admin.tasks.itemType.gone') }}</template>
      </template>
      <template v-if="task && permissions.open" #actions>
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
          color="positive"
          :icon="mode === 'handOn' ? 'o_arrow_forward' : mode === 'publish' ? 'o_publish' : 'o_check'"
          :label="t(`admin.tasks.complete.label.${mode}`)"
          @click="dialog = 'complete'"
        />
      </template>
    </AdminPageHeader>

    <q-banner v-if="loadError" class="bg-negative text-white" rounded>
      {{ t('admin.tasks.detail.loadFailed') }}
    </q-banner>

    <div v-else-if="loading && !task">
      <q-skeleton v-for="i in 4" :key="i" type="text" class="q-mb-md" />
    </div>

    <div v-else-if="task" class="task-grid">
      <div class="column q-gutter-y-md">
        <!-- It came back: the reason is the first thing to read -->
        <div v-if="returned" class="adm-note adm-note--warning" role="note">
          <q-icon name="o_undo" />
          <div class="column">
            <span class="text-weight-bold">
              {{
                t('admin.tasks.detail.returnedBy', {
                  name: returned.userName,
                  when: formatDateTime(returned.createdAt, locale),
                })
              }}
            </span>
            <span class="pre-wrap">{{ returned.note }}</span>
          </div>
        </div>

        <q-card v-if="task.description" flat bordered>
          <div class="adm-card__body column q-gutter-y-sm">
            <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.tasks.detail.description') }}</h2>
            <p class="q-ma-none pre-wrap">{{ task.description }}</p>
          </div>
        </q-card>

        <!-- Activity: one stream, comments and events interleaved -->
        <q-card flat bordered>
          <div class="activity-head">
            <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.tasks.detail.activity') }}</h2>
          </div>
          <div class="activity-body">
            <TaskHistoryList :entries="task.history" :known-names="knownNames" />
          </div>
          <div class="comment-box">
            <q-input
              v-model="commentText"
              outlined
              dense
              autogrow
              type="textarea"
              class="col"
              :placeholder="t('admin.tasks.detail.commentPlaceholder')"
              :aria-label="t('admin.tasks.detail.commentPlaceholder')"
              @keydown.ctrl.enter.prevent="sendComment"
            />
            <q-btn
              unelevated
              no-caps
              color="primary"
              icon="o_send"
              :label="t('admin.tasks.detail.send')"
              :loading="commenting"
              :disable="!commentText.trim()"
              @click="sendComment"
            />
          </div>
        </q-card>
      </div>

      <aside class="column q-gutter-y-md">
        <q-card flat bordered>
          <div class="adm-card__body column q-gutter-y-md">
            <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.tasks.detail.details') }}</h2>
            <dl class="details">
              <dt>{{ t('admin.tasks.columns.status') }}</dt>
              <dd>
                <TaskStatusBadge :status="task.status" :returned="task.lastHandoff === 'RETURNED'" dense />
              </dd>
              <template v-if="returned">
                <dt>{{ t('admin.tasks.detail.lastStep') }}</dt>
                <dd>{{ t('admin.tasks.detail.returnedByShort', { name: returned.userName }) }}</dd>
              </template>
              <dt>{{ t('admin.tasks.columns.kind') }}</dt>
              <dd class="text-weight-medium">{{ t(`admin.tasks.kinds.${task.kind}`) }}</dd>
              <dt>{{ t('admin.tasks.detail.assignedTo') }}</dt>
              <dd>
                <UserAvatar :name="task.assignedToName" :size="24" />
                <span>{{ task.assignedToName }}</span>
              </dd>
              <dt>{{ t('admin.tasks.detail.createdBy') }}</dt>
              <dd>
                <UserAvatar :name="task.createdByName" :size="24" />
                <span>{{ task.createdByName }}</span>
              </dd>
              <dt>{{ t('admin.tasks.detail.item') }}</dt>
              <dd>
                <router-link v-if="task.itemType" :to="`/admin/items/${task.itemId}`" class="adm-link">
                  {{ t(`admin.itemType.${task.itemType}`) }}
                  <q-icon name="o_open_in_new" size="14px" />
                </router-link>
                <span v-else class="adm-muted">{{ t('admin.tasks.itemType.gone') }}</span>
              </dd>
              <dt>{{ t('admin.tasks.detail.created') }}</dt>
              <dd>{{ formatDateTime(task.createdAt, locale) }}</dd>
              <dt>{{ t('admin.tasks.columns.updated') }}</dt>
              <dd>{{ formatDateTime(task.updatedAt, locale) }}</dd>
              <template v-if="task.completedAt">
                <dt>{{ t('admin.tasks.detail.completed') }}</dt>
                <dd>{{ formatDateTime(task.completedAt, locale) }}</dd>
              </template>
              <template v-if="task.dueAt">
                <dt>{{ t('admin.tasks.fields.dueAt') }}</dt>
                <dd>{{ formatDate(task.dueAt, locale) }}</dd>
              </template>
            </dl>
          </div>
        </q-card>

        <q-card v-if="permissions.canManage" flat bordered>
          <div class="adm-card__body column q-gutter-y-sm">
            <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.tasks.detail.moreActions') }}</h2>
            <q-btn
              outline
              no-caps
              color="primary"
              icon="o_swap_horiz"
              :label="t('admin.tasks.detail.reassign')"
              @click="dialog = 'reassign'"
            />
            <q-btn
              flat
              no-caps
              color="negative"
              icon="o_block"
              :label="t('admin.tasks.detail.cancel')"
              @click="dialog = 'cancel'"
            />
            <div class="more-note">
              <q-icon name="o_info" size="16px" />
              <span>{{ t('admin.tasks.detail.cancelNote') }}</span>
            </div>
          </div>
        </q-card>

        <div v-else-if="!permissions.open" class="adm-note">
          <q-icon :name="task.status === 'CANCELLED' ? 'o_block' : 'o_check_circle'" />
          <span>{{ t(`admin.tasks.detail.closedHint.${task.status}`) }}</span>
        </div>
      </aside>
    </div>

    <TaskActionDialogs v-if="task" v-model:dialog="dialog" :task="task" :item="item" @done="onActionDone" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useRoute } from 'vue-router';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { useItemSummary } from 'src/composables/useItemSummary';
import { apiErrorMessage } from 'src/api/errors';
import { addTaskComment, getTask, type TaskDetail } from 'src/api/tasks';
import { useTaskCountStore } from 'src/stores/task-count-store';
import { formatDate, formatDateTime } from 'src/utils/adminFormat';
import { completeMode, returnNote, taskPermissions } from 'src/utils/taskRules';
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import TaskHistoryList from 'src/components/admin/TaskHistoryList.vue';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';
import TaskActionDialogs from 'src/components/admin/tasks/TaskActionDialogs.vue';
import type { TaskDialog } from 'src/components/admin/tasks/types';

const { t, locale } = useI18n();
const $q = useQuasar();
const route = useRoute();
const { canManageRecords } = useAuthz();
const taskCount = useTaskCountStore();

const taskId = computed(() => route.params.id as string);

const task = ref<TaskDetail | null>(null);
const loading = ref(true);
const loadError = ref(false);
const dialog = ref<TaskDialog | null>(null);

// The item's title for the header — one read for this one task.
const { item, reload: reloadItem } = useItemSummary(computed(() => task.value?.itemId));

// ── Derived state ──

const permissions = computed(() => taskPermissions(task.value, auth.userId, canManageRecords.value));
const mode = computed(() => (task.value ? completeMode(task.value) : 'general'));
const returned = computed(() => (task.value ? returnNote(task.value, task.value.history) : undefined));

/**
 * Seed for the raw ids in `changes[]`: the task's live names plus the return
 * target. Anything else the history list resolves on its own.
 */
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

// ── Load ──

async function load() {
  loading.value = true;
  try {
    task.value = await getTask(taskId.value);
    loadError.value = false;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(taskId, () => void load());

// The action answers carry no history and no return target: reload. A publish
// moved the item to the records, so its summary is reloaded as well.
function onActionDone() {
  void load();
  void reloadItem();
  void taskCount.refresh();
}

// ── Comments ──

const commentText = ref('');
const commenting = ref(false);

async function sendComment() {
  const body = commentText.value.trim();
  if (!body || !task.value) return;
  commenting.value = true;
  try {
    const entry = await addTaskComment(taskId.value, body);
    // The response is the new history row — append, no re-fetch needed.
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
.task-grid
  display: grid
  grid-template-columns: minmax(0, 1fr) 320px
  gap: 24px
  align-items: start

.item-link
  color: $primary
  font-weight: 600
  text-decoration: none
  &:hover
    text-decoration: underline

.pre-wrap
  white-space: pre-wrap
  overflow-wrap: anywhere
  line-height: 1.55

.activity-head
  padding: 16px 20px 0

.activity-body
  padding: 16px 20px 0

.comment-box
  display: flex
  align-items: flex-end
  gap: 10px
  padding: 16px 20px 20px
  margin-top: 8px
  border-top: 1px solid $divider-soft

.details
  margin: 0
  display: grid
  grid-template-columns: 96px minmax(0, 1fr)
  row-gap: 12px
  column-gap: 12px
  align-items: center
  font-size: 13px
  dt
    color: $muted

  dd
    margin: 0
    display: flex
    align-items: center
    gap: 8px
    min-width: 0

.more-note
  display: flex
  gap: 8px
  padding-top: 10px
  margin-top: 4px
  border-top: 1px solid $divider-soft
  font-size: 12px
  line-height: 1.45
  color: $muted

@media (max-width: 1100px)
  .task-grid
    grid-template-columns: minmax(0, 1fr)
</style>
