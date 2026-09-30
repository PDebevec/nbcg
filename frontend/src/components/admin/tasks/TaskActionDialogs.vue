<template>
  <CompleteTaskDialog
    :model-value="dialog === 'complete'"
    :task="task"
    :item="item"
    @update:model-value="close"
    @done="emit('done', $event)"
  />
  <ReturnTaskDialog
    :model-value="dialog === 'return'"
    :task="task"
    :item="item"
    @update:model-value="close"
    @done="emit('done', $event)"
  />
  <ReassignTaskDialog
    :model-value="dialog === 'reassign'"
    :task="task"
    :item="item"
    @update:model-value="close"
    @done="emit('done', $event)"
  />
  <CancelTaskDialog
    :model-value="dialog === 'cancel'"
    :task="task"
    :item="item"
    @update:model-value="close"
    @done="emit('done', $event)"
  />
</template>

<script setup lang="ts">
import type { Task, TaskDetail } from 'src/api/tasks';
import type { ItemSummary } from 'src/composables/useItemSummary';
import CancelTaskDialog from './CancelTaskDialog.vue';
import CompleteTaskDialog from './CompleteTaskDialog.vue';
import ReassignTaskDialog from './ReassignTaskDialog.vue';
import ReturnTaskDialog from './ReturnTaskDialog.vue';
import type { TaskDialog } from './types';

// The four actions that move a task, one dialog each. The task page and the
// inbox's detail pane both render this once and open a dialog by name.

defineProps<{
  dialog: TaskDialog | null;
  task: TaskDetail;
  item: ItemSummary | null;
}>();

const emit = defineEmits<{
  (e: 'update:dialog', value: TaskDialog | null): void;
  /** An action went through — the answer has no history, so reload the detail. */
  (e: 'done', task: Task): void;
}>();

function close(open: boolean) {
  if (!open) emit('update:dialog', null);
}
</script>
