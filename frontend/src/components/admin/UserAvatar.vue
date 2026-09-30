<template>
  <q-avatar :size="`${size}px`" :style="{ background: color }" text-color="white" class="user-avatar">
    <span :style="{ fontSize: `${Math.max(10, Math.round(size * 0.4))}px` }">{{ letters }}</span>
    <q-tooltip v-if="tooltip">{{ name }}</q-tooltip>
  </q-avatar>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { initials } from 'src/utils/adminFormat';

// Initials on one of the brand colours. The colour is derived from the name,
// so a person keeps theirs across pages without anything being stored.

const props = withDefaults(
  defineProps<{
    name: string | null | undefined;
    size?: number;
    tooltip?: boolean;
  }>(),
  { size: 24, tooltip: false },
);

// $accent, $info, $secondary, $warning, $eyebrow
const COLORS = ['#5C7A63', '#34588F', '#B5652C', '#B5862C', '#9A5220'];

const letters = computed(() => initials(props.name));

const color = computed(() => {
  const name = props.name ?? '';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length]!;
});
</script>

<style scoped lang="sass">
.user-avatar
  font-weight: 700
  flex: none
</style>
