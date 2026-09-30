<template>
  <q-dialog
    :model-value="modelValue"
    :persistent="running"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card class="adm-dialog">
      <div class="adm-dialog__head">
        <h2 class="adm-dialog__title col">
          {{ t('admin.tasks.bulk.title', { count: items.length }, items.length) }}
        </h2>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :disable="running" />
      </div>

      <div class="adm-dialog__body">
        <div class="column q-gutter-y-sm">
          <span class="bulk-label">{{ t('admin.tasks.bulk.selected') }}</span>
          <div class="row q-gutter-xs">
            <template v-for="item in items" :key="item.id">
              <!-- Already has an open task: skipped, with a link to the task in the way -->
              <span v-if="blockedBy(item.id)" class="bulk-chip bulk-chip--skipped">
                <span class="bulk-chip__struck">{{ item.title || '—' }}</span>
                <router-link v-close-popup :to="`/admin/tasks/${blockedBy(item.id)}`">
                  {{ t('admin.tasks.bulk.openTask') }}
                </router-link>
              </span>
              <span v-else class="bulk-chip" :class="{ 'bulk-chip--failed': failed[item.id] }">
                <q-icon v-if="created[item.id]" name="o_check" size="14px" />
                <q-icon v-else-if="failed[item.id]" name="o_error_outline" size="14px">
                  <q-tooltip>{{ failed[item.id] }}</q-tooltip>
                </q-icon>
                {{ item.title || '—' }}
              </span>
            </template>
          </div>
          <span v-if="skippedCount > 0" class="bulk-warning">
            <q-icon name="o_info" size="14px" />
            {{ t('admin.tasks.bulk.skipNote', { count: skippedCount }, skippedCount) }}
          </span>
        </div>

        <div class="row q-col-gutter-md">
          <div class="col-12 col-sm-6">
            <FormField :label="t('admin.tasks.create.kind')">
              <q-select
                v-model="kind"
                :options="kindOptions"
                emit-value
                map-options
                outlined
                dense
                :disable="running || finished"
              />
            </FormField>
          </div>
          <div class="col-12 col-sm-6">
            <AssigneePicker
              v-model="assignee"
              :kind="kind"
              :item-type="itemType"
              required
              show-assign-to-me
              :error="submitted && !assignee"
              :error-message="t('admin.tasks.create.assigneeRequired')"
            />
          </div>
        </div>

        <FormField :label="t('admin.tasks.create.taskTitle')" required :hint="t('admin.tasks.bulk.sameForAll')">
          <q-input
            v-model="title"
            outlined
            dense
            maxlength="200"
            hide-bottom-space
            :disable="running || finished"
            :error="submitted && !title.trim()"
            :error-message="t('admin.tasks.create.titleRequired')"
            @update:model-value="titleTouched = true"
          />
        </FormField>

        <FormField :label="t('admin.tasks.create.description')">
          <q-input
            v-model="description"
            outlined
            dense
            type="textarea"
            autogrow
            maxlength="5000"
            :disable="running || finished"
          />
        </FormField>
      </div>

      <div class="adm-dialog__foot">
        <span class="adm-dialog__foot-note">{{ footNote }}</span>
        <template v-if="finished">
          <q-btn v-close-popup unelevated no-caps color="primary" :label="t('admin.common.close')" />
        </template>
        <template v-else>
          <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.common.cancel')" :disable="running" />
          <q-btn
            unelevated
            no-caps
            color="primary"
            icon="o_person_add"
            :label="t('admin.tasks.bulk.submit', { count: todo.length }, todo.length)"
            :loading="running"
            :disable="todo.length === 0"
            @click="submit"
          />
        </template>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ItemType } from 'src/api/admin';
import { apiErrorMessage, openTaskConflict } from 'src/api/errors';
import { createTask, TASK_KINDS, type TaskKind } from 'src/api/tasks';
import type { PickedUser } from 'src/api/users';
import AssigneePicker from 'src/components/admin/AssigneePicker.vue';
import FormField from 'src/components/admin/FormField.vue';

// ---------------------------------------------------------------------------
// "Assign task" for a selection (nice-to-have A9): one task per item, the same
// stage, title and assignee on each. An item has one open task at a time, so
// items that already have one are skipped and link to the task in the way —
// both the ones the list already knew about and the ones the server answers
// `409 ITEM_HAS_OPEN_TASK` for.
// ---------------------------------------------------------------------------

export interface BulkAssignItem {
  id: string;
  title: string;
}

const props = defineProps<{
  modelValue: boolean;
  items: BulkAssignItem[];
  /** Every selected item is of this type (the list shows one collection). */
  itemType: ItemType;
  /** itemId → id of its open task, as far as the list knows. */
  openTasks: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  /** At least one task was created. */
  (e: 'done'): void;
}>();

const { t } = useI18n();

const kind = ref<TaskKind>('GENERAL');
const title = ref('');
const titleTouched = ref(false);
const description = ref('');
const assignee = ref<PickedUser | null>(null);
const submitted = ref(false);
const running = ref(false);
const finished = ref(false);

/** Per item, once the run got to it. */
const created = reactive<Record<string, boolean>>({});
const failed = reactive<Record<string, string>>({});
/** itemId → blocking task, learned from a 409 during the run. */
const conflicts = reactive<Record<string, string>>({});

const kindOptions = computed(() =>
  TASK_KINDS.map((k) => ({ label: t(`admin.tasks.kinds.${k}`), value: k })),
);

function blockedBy(itemId: string): string | undefined {
  return conflicts[itemId] ?? props.openTasks[itemId];
}

const todo = computed(() => props.items.filter((item) => !blockedBy(item.id) && !created[item.id]));
const skippedCount = computed(() => props.items.filter((item) => blockedBy(item.id)).length);
const createdCount = computed(() => Object.keys(created).length);

const footNote = computed(() => {
  if (running.value || finished.value) {
    return t('admin.tasks.bulk.progress', {
      created: createdCount.value,
      skipped: skippedCount.value,
      failed: Object.keys(failed).length,
    });
  }
  return skippedCount.value > 0
    ? t('admin.tasks.bulk.willCreateAndSkip', { count: todo.value.length, skipped: skippedCount.value })
    : t('admin.tasks.bulk.willCreate', { count: todo.value.length }, todo.value.length);
});

function reset() {
  kind.value = props.itemType === 'RECORD' ? 'FIX_METADATA' : 'REVIEW_PUBLISH';
  title.value = t(`admin.tasks.create.defaultTitle.${kind.value}`);
  titleTouched.value = false;
  description.value = '';
  assignee.value = null;
  submitted.value = false;
  running.value = false;
  finished.value = false;
  for (const bag of [created, failed, conflicts]) {
    for (const key of Object.keys(bag)) delete bag[key];
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
);

// Prefill the title per stage until the user types their own.
watch(kind, (k) => {
  if (!titleTouched.value) title.value = t(`admin.tasks.create.defaultTitle.${k}`);
});

async function submit() {
  submitted.value = true;
  if (!title.value.trim() || !assignee.value) return;

  running.value = true;
  // One at a time: the list is short, and the footer can count along.
  for (const item of todo.value) {
    delete failed[item.id];
    try {
      await createTask({
        itemId: item.id,
        kind: kind.value,
        title: title.value.trim(),
        ...(description.value.trim() ? { description: description.value.trim() } : {}),
        assignedToUserId: assignee.value.userId,
      });
      created[item.id] = true;
    } catch (err) {
      const taskId = openTaskConflict(err);
      if (taskId) conflicts[item.id] = taskId;
      else failed[item.id] = apiErrorMessage(err) ?? t('admin.tasks.create.failed');
    }
  }
  running.value = false;
  finished.value = true;
  if (createdCount.value > 0) emit('done');
}
</script>

<style scoped lang="sass">
.bulk-label
  font-size: 13px
  font-weight: 600
  color: $ink-soft

.bulk-chip
  display: inline-flex
  align-items: center
  gap: 6px
  min-height: 28px
  padding: 2px 10px
  border-radius: 6px
  background: $soft-primary
  color: $primary
  font-size: 13px
  font-weight: 600

.bulk-chip--skipped
  background: $soft-warning
  color: $soft-warning-ink
  a
    color: $soft-warning-ink
    white-space: nowrap

.bulk-chip--failed
  background: $soft-negative
  color: $soft-negative-ink

.bulk-chip__struck
  text-decoration: line-through

.bulk-warning
  display: inline-flex
  align-items: center
  gap: 6px
  font-size: 12px
  color: $soft-warning-ink
</style>
