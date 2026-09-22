<template>
  <div>
    <div v-if="entries.length === 0" class="text-library-muted q-pa-md text-center">
      {{ t('admin.tasks.history.empty') }}
    </div>

    <q-list v-else separator>
      <q-item v-for="entry in entries" :key="entry.id" class="q-py-md">
        <q-item-section avatar top>
          <q-icon
            :name="actionMeta(entry.action).icon"
            :color="actionMeta(entry.action).color"
            size="22px"
          />
        </q-item-section>

        <q-item-section>
          <!-- A comment is a message; everything else is an event, so a task
               never looks like it changed by itself. -->
          <template v-if="entry.action === 'COMMENTED'">
            <q-item-label>
              <span class="text-weight-bold">{{ entry.userName }}</span>
              <span class="text-library-muted"> · {{ formatTime(entry.createdAt) }}</span>
            </q-item-label>
            <div class="comment-bubble q-mt-xs">{{ entry.note }}</div>
          </template>

          <template v-else>
            <q-item-label>
              <span class="text-weight-bold">{{ t(`admin.tasks.actions.${entry.action}`) }}</span>
              <span v-if="assigneeChange(entry)" class="q-ml-xs">
                {{ t('admin.tasks.history.toAssignee', { name: nameFor(assigneeChange(entry)) }) }}
              </span>
              <!-- userName is a frozen snapshot — rendered as-is, never re-resolved -->
              <span class="text-library-muted"> · {{ entry.userName }}</span>
            </q-item-label>
            <q-item-label caption>{{ formatTime(entry.createdAt) }}</q-item-label>

            <div v-if="visibleChanges(entry).length" class="changes q-mt-sm">
              <div v-for="(change, ci) in visibleChanges(entry)" :key="ci" class="change-row">
                <div class="change-field">{{ fieldLabel(change.path) }}</div>
                <div class="change-values">
                  <span :class="change.before == null ? 'value-empty' : 'value-scalar'">
                    {{ changeValue(change.path, change.before) }}
                  </span>
                  <q-icon name="arrow_forward" size="14px" class="text-library-muted" />
                  <span :class="change.after == null ? 'value-empty' : 'value-scalar'">
                    {{ changeValue(change.path, change.after) }}
                  </span>
                </div>
              </div>
            </div>

            <div v-if="entry.note" class="note-quote q-mt-sm">{{ entry.note }}</div>
          </template>

          <div v-if="showTaskLink && 'taskId' in entry" class="q-mt-xs">
            <router-link :to="`/admin/tasks/${entry.taskId}`" class="task-link">
              {{ t('admin.tasks.openTask') }}
            </router-link>
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getUser } from 'src/api/users';
import type { FieldChange } from 'src/api/admin';
import type { ItemTaskHistoryEntry, TaskAction, TaskHistoryEntry } from 'src/api/tasks';

// ---------------------------------------------------------------------------
// Renders one chronological stream of comments and system events. Purely
// presentational: the parent owns loading, ordering and pagination, because
// the task detail (oldest first, appended on comment) and the per-item audit
// view (newest first, paged) read the same shape differently.
// ---------------------------------------------------------------------------

const props = defineProps<{
  entries: (TaskHistoryEntry | ItemTaskHistoryEntry)[];
  /**
   * id → current display name, for `assignedToUserId` changes, which carry
   * raw user ids. Seed it from the task (`assignedToName`, `createdByName`);
   * anything missing is resolved once via GET /users/:id.
   */
  knownNames?: Record<string, string>;
  /** Item audit view: entries carry `taskId`, link to the task. */
  showTaskLink?: boolean;
}>();

const i18n = useI18n();
const { t } = i18n;

// ── Names for raw user ids in change rows ──

const resolvedNames = reactive<Record<string, string>>({});
const pending = new Set<string>();

function nameFor(userId: string | undefined): string {
  if (!userId) return '';
  return props.knownNames?.[userId] ?? resolvedNames[userId] ?? '…';
}

function resolveMissingNames() {
  for (const entry of props.entries) {
    for (const change of entry.changes ?? []) {
      if (change.path !== 'assignedToUserId') continue;
      for (const id of [change.before, change.after]) {
        if (typeof id !== 'string' || !id) continue;
        if (props.knownNames?.[id] || resolvedNames[id] || pending.has(id)) continue;
        pending.add(id);
        getUser(id)
          .then((u) => {
            resolvedNames[id] = u.displayName;
          })
          .catch(() => {
            resolvedNames[id] = t('admin.tasks.history.unknownUser');
          })
          .finally(() => pending.delete(id));
      }
    }
  }
}

watch(() => props.entries, resolveMissingNames, { immediate: true, deep: true });

// ── Presentation ──

const ACTION_META: Record<TaskAction, { icon: string; color: string }> = {
  CREATED: { icon: 'add_circle', color: 'positive' },
  ASSIGNED: { icon: 'person', color: 'primary' },
  STATUS_CHANGED: { icon: 'swap_horiz', color: 'info' },
  RETURNED: { icon: 'undo', color: 'warning' },
  COMMENTED: { icon: 'chat_bubble_outline', color: 'primary' },
  UPDATED: { icon: 'edit', color: 'primary' },
  CLOSED_ON_PUBLISH: { icon: 'publish', color: 'positive' },
};

function actionMeta(action: TaskAction) {
  return ACTION_META[action] ?? { icon: 'help_outline', color: 'grey' };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** The new assignee id when this entry moved the task, so the label can say "to Ana". */
function assigneeChange(entry: TaskHistoryEntry): string | undefined {
  const change = entry.changes?.find((c) => c.path === 'assignedToUserId');
  return typeof change?.after === 'string' ? change.after : undefined;
}

/**
 * Changes worth a row. The assignee move is already in the label, and a
 * CREATED entry's initial values are the task itself, not a diff.
 */
function visibleChanges(entry: TaskHistoryEntry): FieldChange[] {
  if (entry.action === 'CREATED') return [];
  return (entry.changes ?? []).filter((c) => c.path !== 'assignedToUserId');
}

function fieldLabel(path: string): string {
  const key = `admin.tasks.fields.${path}`;
  return i18n.te(key) ? t(key) : path;
}

function changeValue(path: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (path === 'status' && typeof value === 'string') {
    const key = `admin.tasks.statuses.${value}`;
    return i18n.te(key) ? t(key) : value;
  }
  if (path === 'kind' && typeof value === 'string') {
    const key = `admin.tasks.kinds.${value}`;
    return i18n.te(key) ? t(key) : value;
  }
  if (path === 'dueAt' && typeof value === 'string') return new Date(value).toLocaleDateString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
</script>

<style scoped lang="sass">
.comment-bubble
  padding: 8px 12px
  background: rgba(0, 0, 0, 0.04)
  border-radius: $radius
  white-space: pre-wrap
  overflow-wrap: anywhere
  color: $ink

.note-quote
  border-left: 3px solid $divider
  padding-left: 12px
  color: $ink
  white-space: pre-wrap
  overflow-wrap: anywhere
  font-style: italic

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

.value-scalar
  font-size: 13px
  color: $ink
  overflow-wrap: anywhere

.value-empty
  color: $muted

.task-link
  color: $primary
  font-size: 13px
  text-decoration: none
  &:hover
    text-decoration: underline
</style>
