<template>
  <div>
    <div v-if="entries.length === 0" class="adm-empty">{{ t('admin.tasks.history.empty') }}</div>

    <template v-else>
    <div v-for="(entry, index) in entries" :key="entry.id" class="event">
      <div class="event__rail">
        <!-- A comment is a message from a person; everything else is an event. -->
        <UserAvatar v-if="entry.action === 'COMMENTED'" :name="entry.userName" :size="28" />
        <q-avatar v-else size="28px" :class="`event__icon event__icon--${meta(entry.action).tone}`">
          <q-icon :name="meta(entry.action).icon" size="14px" />
        </q-avatar>
        <div v-if="index < entries.length - 1" class="event__line" />
      </div>

      <div class="event__body">
        <div class="event__head">
          <!-- userName is a frozen snapshot — rendered as-is, never re-resolved -->
          <span class="text-weight-bold">{{ entry.userName }}</span>
          <template v-for="(part, pi) in sentence(entry)" :key="pi">
            <q-badge v-if="part.kind === 'stage'" class="badge-soft badge-soft--sm badge-soft--outline">
              {{ part.text }}
            </q-badge>
            <TaskStatusBadge v-else-if="part.kind === 'status'" :status="part.text" dense />
            <span v-else-if="part.kind === 'name'" class="text-weight-bold">{{ part.text }}</span>
            <span v-else class="adm-muted">{{ part.text }}</span>
          </template>
          <router-link
            v-if="showTaskLink && 'taskId' in entry"
            :to="`/admin/tasks/${entry.taskId}`"
            class="adm-link event__task-link"
          >
            {{ t('admin.tasks.openTask') }}
            <q-icon name="o_chevron_right" size="14px" />
          </router-link>
          <span class="event__time" :title="formatDateTime(entry.createdAt, locale)">
            {{ formatDateTime(entry.createdAt, locale) }}
          </span>
        </div>

        <div v-if="entry.action === 'COMMENTED'" class="event__comment">{{ entry.note }}</div>

        <template v-else>
          <div v-if="detailChanges(entry).length" class="event__changes">
            <div v-for="(change, ci) in detailChanges(entry)" :key="ci">
              <span class="event__field">{{ fieldLabel(change.path) }}:</span>
              <span :class="{ 'adm-muted': change.before == null }">{{ changeValue(change.path, change.before) }}</span>
              <q-icon name="o_arrow_forward" size="12px" class="adm-muted q-mx-xs" />
              <span :class="{ 'adm-muted': change.after == null }">{{ changeValue(change.path, change.after) }}</span>
            </div>
          </div>
          <div v-if="entry.note" class="event__note">{{ entry.note }}</div>
        </template>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getUser } from 'src/api/users';
import type { FieldChange } from 'src/api/admin';
import type { ItemTaskHistoryEntry, TaskAction, TaskHistoryEntry } from 'src/api/tasks';
import { formatDate, formatDateTime } from 'src/utils/adminFormat';
import { assigneeChange, kindChange } from 'src/utils/taskRules';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';

// ---------------------------------------------------------------------------
// One chronological stream of comments and events, drawn as a timeline. Purely
// presentational: the parent owns loading, ordering and pagination, because
// the task detail (oldest first, appended on comment) and the per-item audit
// view (newest first, paged) read the same shape differently.
//
// Each event reads as a sentence — "Ana handed the task on for Review and
// publish to Marko" — so a task never looks like it moved by itself.
// ---------------------------------------------------------------------------

const props = defineProps<{
  entries: (TaskHistoryEntry | ItemTaskHistoryEntry)[];
  /**
   * id → current display name, for `assignedToUserId` changes, which carry
   * raw user ids. Seed it from the task (`assignedToName`, `createdByName`);
   * anything missing is resolved once via GET /users/:id.
   */
  knownNames?: Record<string, string> | undefined;
  /** Item audit view: entries carry `taskId`, link to the task. */
  showTaskLink?: boolean;
}>();

const i18n = useI18n();
const { t, locale } = i18n;

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

type Tone = 'positive' | 'warning' | 'info' | 'primary' | 'muted';

const ACTION_META: Record<TaskAction, { icon: string; tone: Tone }> = {
  CREATED: { icon: 'o_add', tone: 'positive' },
  ADVANCED: { icon: 'o_arrow_forward', tone: 'info' },
  ASSIGNED: { icon: 'o_swap_horiz', tone: 'primary' },
  RETURNED: { icon: 'o_undo', tone: 'warning' },
  COMPLETED: { icon: 'o_check', tone: 'positive' },
  CANCELLED: { icon: 'o_block', tone: 'muted' },
  COMMENTED: { icon: 'o_chat_bubble_outline', tone: 'primary' },
  UPDATED: { icon: 'o_edit', tone: 'primary' },
  CLOSED_ON_PUBLISH: { icon: 'o_publish', tone: 'positive' },
  STATUS_CHANGED: { icon: 'o_swap_horiz', tone: 'info' },
};

function meta(action: TaskAction) {
  return ACTION_META[action] ?? { icon: 'o_help_outline', tone: 'muted' as Tone };
}

interface Part {
  kind: 'text' | 'name' | 'stage' | 'status';
  text: string;
}

const text = (key: string): Part => ({ kind: 'text', text: t(`admin.tasks.events.${key}`) });
const name = (userId: string): Part => ({ kind: 'name', text: nameFor(userId) });

function stage(kind: string): Part {
  const key = `admin.tasks.kinds.${kind}`;
  return { kind: 'stage', text: i18n.te(key) ? t(key) : kind };
}

/** What follows the actor's name: "handed the task on for [stage] to [name]". */
function sentence(entry: TaskHistoryEntry): Part[] {
  const to = assigneeChange(entry);
  const kind = kindChange(entry);

  switch (entry.action) {
    case 'CREATED':
      return [
        ...(to ? [text('createdFor'), name(to)] : [text('created')]),
        ...(kind ? [stage(kind)] : []),
      ];
    case 'ADVANCED':
      return [
        text('advanced'),
        ...(kind ? [text('for'), stage(kind)] : []),
        ...(to ? [text('to'), name(to)] : []),
      ];
    case 'RETURNED':
      return [
        ...(to ? [text('returnedTo'), name(to)] : [text('returned')]),
        ...(kind ? [text('as'), stage(kind)] : []),
      ];
    case 'ASSIGNED':
      return to ? [text('reassignedTo'), name(to)] : [text('reassigned')];
    case 'COMPLETED':
      return [
        text(
          entry.changes?.some((c) => c.path === 'outcome' && c.after === 'ALREADY_PUBLISHED')
            ? 'confirmedReview'
            : 'completed',
        ),
      ];
    case 'CANCELLED':
      return [text('cancelled')];
    case 'CLOSED_ON_PUBLISH':
      return [text('published')];
    case 'COMMENTED':
      return [text('commented')];
    case 'UPDATED':
      return [text('edited')];
    case 'STATUS_CHANGED': {
      // Legacy (v1) rows: IN_PROGRESS / RETURNED values stay in the log forever.
      const change = entry.changes?.find((c) => c.path === 'status');
      return [
        text('changedStatus'),
        ...(typeof change?.before === 'string' ? [{ kind: 'status' as const, text: change.before }] : []),
        ...(typeof change?.after === 'string'
          ? [{ kind: 'text' as const, text: '→' }, { kind: 'status' as const, text: change.after }]
          : []),
        ...(to ? [text('to'), name(to)] : []),
      ];
    }
    default:
      return [];
  }
}

/** Changes the sentence does not already say: edits to the title, description, due date. */
function detailChanges(entry: TaskHistoryEntry): FieldChange[] {
  if (entry.action !== 'UPDATED') return [];
  return (entry.changes ?? []).filter(
    (c) => !['assignedToUserId', 'kind', 'status', 'outcome'].includes(c.path),
  );
}

function fieldLabel(path: string): string {
  const key = `admin.tasks.fields.${path}`;
  return i18n.te(key) ? t(key) : path;
}

function changeValue(path: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (path === 'dueAt' && typeof value === 'string') return formatDate(value, locale.value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
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

.event__icon
  flex: none

.event__icon--positive
  background: $soft-positive
  color: $soft-positive-ink

.event__icon--warning
  background: $soft-warning
  color: $soft-warning-ink

.event__icon--info
  background: $soft-info
  color: $soft-info-ink

.event__icon--primary
  background: $soft-primary
  color: $primary

.event__icon--muted
  background: $soft-muted
  color: $soft-muted-ink

.event__line
  width: 2px
  flex: 1 1 auto
  margin-top: 4px
  background: $divider-soft

.event__body
  flex: 1 1 auto
  min-width: 0
  padding-bottom: 20px

.event:last-child .event__body
  padding-bottom: 8px

.event__head
  display: flex
  flex-wrap: wrap
  align-items: baseline
  gap: 4px 6px
  font-size: 14px
  min-height: 28px
  padding-top: 3px

.event__time
  margin-left: auto
  font-size: 12px
  color: $muted
  white-space: nowrap

.event__task-link
  font-size: 13px
  gap: 2px
  margin-left: 6px

.event__comment
  margin-top: 8px
  padding: 10px 14px
  background: $paper-deep
  border-radius: $radius
  font-size: 14px
  line-height: 1.5
  white-space: pre-wrap
  overflow-wrap: anywhere

.event__note
  margin-top: 8px
  padding: 2px 0 2px 14px
  border-left: 3px solid #E8D5A8
  font-size: 14px
  line-height: 1.5
  color: $ink-soft
  font-style: italic
  white-space: pre-wrap
  overflow-wrap: anywhere

.event__changes
  margin-top: 6px
  font-size: 13px
  color: $ink-soft
  display: flex
  flex-direction: column
  gap: 2px

.event__field
  font-weight: 600
  margin-right: 4px
</style>
