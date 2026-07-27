<template>
  <q-icon v-if="icon" :name="icon.name" :color="icon.color" size="18px">
    <q-tooltip>{{ t(`admin.extraction.${status}`) }}</q-tooltip>
  </q-icon>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TextExtractionStatus } from 'src/api/search';

const props = defineProps<{
  status: TextExtractionStatus;
  /** Also render a positive icon for EXTRACTED (per-file views); otherwise EXTRACTED renders nothing */
  showOk?: boolean;
}>();

const { t } = useI18n();

const icon = computed(() => {
  switch (props.status) {
    case 'GARBAGE':
      return { name: 'warning', color: 'warning' };
    case 'NO_TEXT':
    case 'NOT_EXTRACTED':
      return { name: 'info', color: 'grey-6' };
    case 'EXTRACTED':
      return props.showOk ? { name: 'check_circle', color: 'positive' } : null;
    default:
      return null;
  }
});
</script>
