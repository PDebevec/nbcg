<template>
  <div class="stat-tile">
    <div class="stat-tile__label">
      <span v-if="color" class="stat-tile__swatch" :style="{ background: color }" />
      {{ label }}
    </div>
    <div class="stat-tile__value">
      <q-skeleton v-if="loading" type="text" width="48px" />
      <template v-else>{{ formatCount(value) }}</template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatCount } from 'src/utils/adminFormat';

// A small KPI tile on the statistics page. The swatch is the chart series'
// colour, so the legend reads twice.

defineProps<{
  label: string;
  value: number;
  loading?: boolean;
  /** Series colour of the chart below. */
  color?: string | undefined;
}>();
</script>

<style scoped lang="sass">
.stat-tile
  display: flex
  flex-direction: column
  gap: 6px
  padding: 14px 18px
  background: $surface
  border: 1px solid $divider
  border-radius: $radius

.stat-tile__label
  display: inline-flex
  align-items: center
  gap: 8px
  font-size: 13px
  font-weight: 600
  color: $muted

.stat-tile__swatch
  width: 10px
  height: 3px
  border-radius: 2px

.stat-tile__value
  font-family: $admin-serif
  font-size: 28px
  font-weight: 600
  line-height: 1
  color: $ink
</style>
