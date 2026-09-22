<template>
  <q-badge :color="color" :label="t(`admin.tasks.statuses.${status}`)" class="task-status-badge" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TaskStatus } from 'src/api/tasks';

const props = defineProps<{ status: TaskStatus }>();
const { t } = useI18n();

const color = computed(() => {
  switch (props.status) {
    case 'OPEN':
      return 'info';
    case 'IN_PROGRESS':
      return 'primary';
    case 'RETURNED':
      return 'warning';
    case 'COMPLETED':
      return 'positive';
    case 'CANCELLED':
      return 'library-muted';
    default:
      return 'library-muted';
  }
});
</script>

<style scoped lang="sass">
.task-status-badge
  font-size: 0.7rem
  font-weight: 600
</style>
