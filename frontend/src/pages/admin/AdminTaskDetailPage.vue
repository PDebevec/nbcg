<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <div class="row items-center q-mb-md">
        <q-btn flat dense round icon="arrow_back" color="primary" @click="goBack" />
        <h1 class="text-h5 text-weight-bold q-my-none q-ml-sm ellipsis">
          {{ task ? task.title : t('admin.tasks.detail.title') }}
        </h1>
        <q-space />
        <TaskStatusBadge v-if="task" :status="task.status" />
      </div>

      <q-banner v-if="loadError" class="bg-negative text-white q-mb-md" rounded>
        {{ t('admin.tasks.detail.loadFailed') }}
      </q-banner>

      <div v-else-if="loading && !task" class="q-pa-md">
        <q-skeleton v-for="i in 4" :key="i" type="text" class="q-mb-md" />
      </div>

      <template v-else-if="task">
        <!-- Summary -->
        <q-card flat bordered class="task-card q-mb-md">
          <q-card-section>
            <div class="row q-col-gutter-md">
              <div class="col-6 col-md-3">
                <div class="field-label">{{ t('admin.tasks.fields.kind') }}</div>
                <div>{{ t(`admin.tasks.kinds.${task.kind}`) }}</div>
              </div>
              <div class="col-6 col-md-3">
                <div class="field-label">{{ t('admin.tasks.detail.assignedTo') }}</div>
                <div>{{ task.assignedToName }}</div>
              </div>
              <div class="col-6 col-md-3">
                <div class="field-label">{{ t('admin.tasks.detail.createdBy') }}</div>
                <div>{{ task.createdByName }}</div>
              </div>
              <div class="col-6 col-md-3">
                <div class="field-label">{{ t('admin.tasks.detail.item') }}</div>
                <router-link
                  v-if="task.itemType"
                  :to="`/admin/items/${task.itemId}`"
                  class="item-link"
                >
                  {{ t(`admin.tasks.itemType.${task.itemType}`) }}
                  <q-icon name="open_in_new" size="14px" />
                </router-link>
                <span v-else class="text-library-muted">{{ t('admin.tasks.itemType.gone') }}</span>
              </div>
              <div class="col-6 col-md-3">
                <div class="field-label">{{ t('admin.tasks.detail.created') }}</div>
                <div>{{ new Date(task.createdAt).toLocaleString() }}</div>
              </div>
              <div v-if="task.completedAt" class="col-6 col-md-3">
                <div class="field-label">{{ t('admin.tasks.detail.completed') }}</div>
                <div>{{ new Date(task.completedAt).toLocaleString() }}</div>
              </div>
              <div v-if="task.dueAt" class="col-6 col-md-3">
                <div class="field-label">{{ t('admin.tasks.fields.dueAt') }}</div>
                <div>{{ new Date(task.dueAt).toLocaleDateString() }}</div>
              </div>
            </div>

            <div v-if="task.description" class="q-mt-md">
              <div class="field-label">{{ t('admin.tasks.detail.description') }}</div>
              <div class="description">{{ task.description }}</div>
            </div>
          </q-card-section>

          <q-separator v-if="isCancelled || showPublishHint || canAct" />

          <q-card-section v-if="isCancelled" class="text-library-muted">
            <q-icon name="block" class="q-mr-xs" />
            {{ t('admin.tasks.detail.cancelledHint') }}
          </q-card-section>

          <q-card-section v-else-if="canAct" class="row items-center q-gutter-sm">
            <template v-if="task.status === 'OPEN'">
              <q-btn
                outline
                no-caps
                color="primary"
                icon="play_arrow"
                :label="t('admin.tasks.detail.start')"
                :loading="acting"
                @click="setStatus('IN_PROGRESS')"
              />
            </template>

            <template v-if="isActive">
              <q-btn
                v-if="task.status !== 'RETURNED'"
                outline
                no-caps
                color="warning"
                icon="undo"
                :label="t('admin.tasks.detail.returnAction')"
                @click="openMove('return')"
              />
              <q-btn
                v-else
                outline
                no-caps
                color="primary"
                icon="redo"
                :label="t('admin.tasks.detail.sendBack')"
                @click="openMove('sendBack')"
              />
              <q-btn
                outline
                no-caps
                color="primary"
                icon="person"
                :label="t('admin.tasks.detail.reassign')"
                @click="openMove('reassign')"
              />
              <q-btn
                unelevated
                no-caps
                color="positive"
                icon="check"
                :label="t('admin.tasks.detail.complete')"
                :loading="acting"
                @click="setStatus('COMPLETED')"
              />
              <q-btn
                flat
                no-caps
                color="negative"
                icon="block"
                :label="t('admin.tasks.detail.cancel')"
                :loading="acting"
                @click="cancelTask"
              />
            </template>

            <template v-if="task.status === 'COMPLETED'">
              <q-btn
                outline
                no-caps
                color="primary"
                icon="replay"
                :label="t('admin.tasks.detail.reopen')"
                @click="openMove('reopen')"
              />
            </template>

            <q-space />
            <span v-if="showPublishHint" class="text-caption text-library-muted">
              <q-icon name="info_outline" class="q-mr-xs" />
              {{ t('admin.tasks.detail.publishHint') }}
            </span>
          </q-card-section>

          <q-card-section v-else-if="showPublishHint" class="text-caption text-library-muted">
            <q-icon name="info_outline" class="q-mr-xs" />
            {{ t('admin.tasks.detail.publishHint') }}
          </q-card-section>
        </q-card>

        <!-- Activity: one stream, comments and events interleaved -->
        <q-card flat bordered class="task-card">
          <q-card-section class="text-subtitle1 text-weight-bold q-pb-none">
            {{ t('admin.tasks.detail.activity') }}
          </q-card-section>
          <q-card-section class="q-pt-sm">
            <TaskHistoryList :entries="task.history" :known-names="knownNames" />
          </q-card-section>
          <q-separator />
          <q-card-section class="row items-end q-gutter-sm">
            <q-input
              v-model="commentText"
              outlined
              dense
              autogrow
              type="textarea"
              class="col"
              :placeholder="t('admin.tasks.detail.commentPlaceholder')"
              @keydown.ctrl.enter.prevent="sendComment"
            />
            <q-btn
              unelevated
              no-caps
              color="primary"
              icon="send"
              :label="t('admin.tasks.detail.send')"
              :loading="commenting"
              :disable="!commentText.trim()"
              @click="sendComment"
            />
          </q-card-section>
        </q-card>
      </template>
    </div>

    <!-- Return / reassign / send back / reopen: every move of the assignee,
         with or without a status change, in ONE request. Returning without a
         new assignee, or reassigning to someone the (kind, status) rule
         rejects, is a 400 the server explains — surfaced verbatim. -->
    <q-dialog v-model="moveOpen">
      <q-card v-if="task && move" class="move-card">
        <q-card-section class="row items-center">
          <div class="text-h6">{{ moveTitle }}</div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" />
        </q-card-section>
        <q-card-section class="q-gutter-md">
          <div v-if="move.mode === 'return'" class="text-body2 text-library-muted">
            {{ t('admin.tasks.detail.returnDialog.hint') }}
          </div>
          <AssigneePicker
            v-model="moveAssignee"
            :kind="task.kind"
            :status="move.targetStatus"
            :exclude-user-id="move.mode === 'return' ? task.assignedToUserId : undefined"
            :error="moveSubmitted && !moveAssignee"
            :error-message="t('admin.tasks.create.assigneeRequired')"
          />
          <q-input
            v-model="moveNote"
            outlined
            type="textarea"
            autogrow
            maxlength="5000"
            :label="t('admin.tasks.detail.returnDialog.note')"
            :error="move.mode === 'return' && moveSubmitted && !moveNote.trim()"
            :error-message="t('admin.tasks.detail.returnDialog.noteRequired')"
          />
        </q-card-section>
        <q-card-actions align="right" class="q-pa-md">
          <q-btn v-close-popup flat no-caps :label="t('admin.items.cancel')" />
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="moveSubmitLabel"
            :loading="acting"
            @click="submitMove"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import type { PickedUser } from 'src/api/users';
import {
  ACTIVE_TASK_STATUSES,
  addTaskComment,
  apiErrorMessage,
  getTask,
  patchTask,
  type PatchTaskParams,
  type TaskDetail,
  type TaskStatus,
} from 'src/api/tasks';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';
import TaskHistoryList from 'src/components/admin/TaskHistoryList.vue';
import AssigneePicker from 'src/components/admin/AssigneePicker.vue';

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const { canManageRecords } = useAuthz();

const taskId = computed(() => route.params.id as string);

const task = ref<TaskDetail | null>(null);
const loading = ref(true);
const loadError = ref(false);
const acting = ref(false);

// ── Derived state ──

const isCancelled = computed(() => task.value?.status === 'CANCELLED');
const isActive = computed(() => !!task.value && ACTIVE_TASK_STATUSES.includes(task.value.status));
const showPublishHint = computed(
  () => !!task.value && task.value.kind === 'REVIEW_PUBLISH' && isActive.value,
);

// Mirrors the backend rule for PATCH: assignee, creator, or records:manage.
// UI shaping only — the API's 403 is the authority.
const canAct = computed(() => {
  if (!task.value) return false;
  const me = auth.userId;
  return (
    canManageRecords.value ||
    (!!me && (task.value.assignedToUserId === me || task.value.createdByUserId === me))
  );
});

/**
 * Seed for the raw ids in `changes[]`: the task's live names plus the
 * requester. Anything else the history list resolves on its own.
 */
const knownNames = computed<Record<string, string>>(() => {
  if (!task.value) return {};
  const names: Record<string, string> = {
    [task.value.assignedToUserId]: task.value.assignedToName,
    [task.value.createdByUserId]: task.value.createdByName,
  };
  if (task.value.returnTo) names[task.value.returnTo.userId] = task.value.returnTo.displayName;
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

function goBack() {
  if (window.history.length > 1) router.back();
  else void router.push('/admin/tasks');
}

function notifyError(err: unknown, fallback: string) {
  $q.notify({ type: 'negative', message: apiErrorMessage(err) ?? fallback });
}

// ── Simple status changes ──

async function applyPatch(params: PatchTaskParams, successMsg: string) {
  acting.value = true;
  try {
    await patchTask(taskId.value, params);
    $q.notify({ type: 'positive', message: successMsg });
    await load();
    return true;
  } catch (err) {
    notifyError(err, t('admin.tasks.detail.actionFailed'));
    return false;
  } finally {
    acting.value = false;
  }
}

function setStatus(status: TaskStatus) {
  void applyPatch({ status }, t('admin.tasks.detail.statusUpdated'));
}

function cancelTask() {
  $q.dialog({
    title: t('admin.items.confirmTitle'),
    message: t('admin.tasks.detail.cancelConfirm'),
    cancel: { flat: true, noCaps: true, label: t('admin.items.cancel') },
    ok: { unelevated: true, noCaps: true, color: 'negative', label: t('admin.items.confirm') },
  }).onOk(() => setStatus('CANCELLED'));
}

// ── Moves: return / reassign / send back / reopen ──

type MoveMode = 'return' | 'reassign' | 'sendBack' | 'reopen';

interface Move {
  mode: MoveMode;
  /** The status the task lands in — what the picker derives its capability from. */
  targetStatus: TaskStatus;
}

const move = ref<Move | null>(null);
const moveOpen = ref(false);
const moveAssignee = ref<PickedUser | null>(null);
const moveNote = ref('');
const moveSubmitted = ref(false);

function openMove(mode: MoveMode) {
  if (!task.value) return;
  switch (mode) {
    case 'return':
      move.value = { mode, targetStatus: 'RETURNED' };
      // The requester, already accounting for whether they left or hold the
      // task themselves. Can be null — then an empty picker, not an error.
      moveAssignee.value = task.value.returnTo;
      break;
    case 'sendBack':
      move.value = { mode, targetStatus: 'OPEN' };
      moveAssignee.value = null;
      break;
    case 'reopen':
      move.value = { mode, targetStatus: 'OPEN' };
      moveAssignee.value = {
        userId: task.value.assignedToUserId,
        displayName: task.value.assignedToName,
      };
      break;
    case 'reassign':
    default:
      move.value = { mode: 'reassign', targetStatus: task.value.status };
      moveAssignee.value = null;
      break;
  }
  moveNote.value = '';
  moveSubmitted.value = false;
  moveOpen.value = true;
}

const moveTitle = computed(() => {
  switch (move.value?.mode) {
    case 'return':
      return t('admin.tasks.detail.returnDialog.title');
    case 'sendBack':
      return t('admin.tasks.detail.sendBack');
    case 'reopen':
      return t('admin.tasks.detail.reopen');
    default:
      return t('admin.tasks.detail.reassignDialog.title');
  }
});

const moveSubmitLabel = computed(() => {
  switch (move.value?.mode) {
    case 'return':
      return t('admin.tasks.detail.returnDialog.submit');
    case 'sendBack':
      return t('admin.tasks.detail.sendBack');
    case 'reopen':
      return t('admin.tasks.detail.reopen');
    default:
      return t('admin.tasks.detail.reassignDialog.submit');
  }
});

async function submitMove() {
  if (!task.value || !move.value) return;
  moveSubmitted.value = true;
  const note = moveNote.value.trim();
  if (!moveAssignee.value) return;
  if (move.value.mode === 'return' && !note) return;

  // Status and assignee travel together — the server rejects RETURNED alone.
  const params: PatchTaskParams = { assignedToUserId: moveAssignee.value.userId };
  if (move.value.targetStatus !== task.value.status) params.status = move.value.targetStatus;
  if (note) params.note = note;

  const successMsg =
    move.value.mode === 'return'
      ? t('admin.tasks.detail.returnDialog.done', { name: moveAssignee.value.displayName })
      : t('admin.tasks.detail.reassignDialog.done', { name: moveAssignee.value.displayName });

  if (await applyPatch(params, successMsg)) moveOpen.value = false;
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
    notifyError(err, t('admin.tasks.detail.commentFailed'));
  } finally {
    commenting.value = false;
  }
}
</script>

<style scoped lang="sass">
.page-body
  max-width: 960px
  margin: 0 auto

.task-card
  background: $surface
  border-radius: $radius

.field-label
  font-size: 12px
  font-weight: 600
  color: $muted
  margin-bottom: 2px

.description
  white-space: pre-wrap
  overflow-wrap: anywhere

.item-link
  color: $primary
  text-decoration: none
  font-weight: 600
  &:hover
    text-decoration: underline

.move-card
  width: 560px
  max-width: 95vw
</style>
