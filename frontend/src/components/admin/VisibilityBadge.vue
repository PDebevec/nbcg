<template>
  <q-badge :color="color" :label="t(`admin.visibility.${status}`)" class="visibility-badge" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VisibilityStatus } from 'src/api/admin';

const props = defineProps<{ status: VisibilityStatus }>();
const { t } = useI18n();

const color = computed(() => {
  switch (props.status) {
    case 'PUBLIC':
      return 'positive';
    case 'PRIVATE':
      return 'warning';
    case 'HIDDEN':
      return 'grey-7';
    default:
      return 'grey';
  }
});
</script>

<style scoped lang="sass">
.visibility-badge
  font-size: 0.7rem
  font-weight: 600
</style>
