<template>
  <div class="stat-tile">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">
      <q-skeleton v-if="loading" type="text" width="48px" />
      <template v-else>{{ value.toLocaleString() }}</template>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  value: number;
  loading?: boolean;
}>();
</script>

<style scoped lang="sass">
.stat-tile
  background: $surface
  border: 1px solid $divider
  border-radius: $radius
  padding: 12px 16px
  min-width: 120px

.stat-label
  font-size: 12px
  color: $muted

.stat-value
  font-size: 24px
  font-weight: 600
  color: $ink
  line-height: 1.3
</style>
