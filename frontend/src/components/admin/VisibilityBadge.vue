<template>
  <q-badge class="badge-soft" :class="[`badge-soft--${tone}`, { 'badge-soft--sm': dense }]">
    {{ t(`admin.visibility.${status}`) }}
  </q-badge>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VisibilityStatus } from 'src/api/admin';

const props = defineProps<{ status: VisibilityStatus; dense?: boolean }>();
const { t } = useI18n();

const tone = computed(() => {
  switch (props.status) {
    case 'PUBLIC':
      return 'positive';
    case 'PRIVATE':
      return 'warning';
    default:
      return 'muted';
  }
});
</script>
