<template>
  <q-badge class="badge-soft" :class="[`badge-soft--${tone}`, { 'badge-soft--sm': dense }]">
    {{ label }}
  </q-badge>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// Three statuses since task workflow v2. A task that came back is still OPEN
// and reads "Open · returned". Status values from old history rows
// (IN_PROGRESS, RETURNED) fall back to a neutral chip.

const props = defineProps<{
  /** A TaskStatus, or a legacy value read from a history row. */
  status: string;
  /** `lastHandoff === 'RETURNED'` on an open task. */
  returned?: boolean | undefined;
  dense?: boolean;
}>();

const i18n = useI18n();
const { t } = i18n;

const isReturned = computed(() => props.status === 'OPEN' && !!props.returned);

const tone = computed(() => {
  if (isReturned.value) return 'warning';
  switch (props.status) {
    case 'OPEN':
      return 'info';
    case 'COMPLETED':
      return 'positive';
    default:
      return 'muted';
  }
});

const label = computed(() => {
  if (isReturned.value) return t('admin.tasks.openReturned');
  const key = `admin.tasks.statuses.${props.status}`;
  if (i18n.te(key)) return t(key);
  const legacy = `admin.tasks.legacyStatuses.${props.status}`;
  return i18n.te(legacy) ? t(legacy) : props.status;
});
</script>
