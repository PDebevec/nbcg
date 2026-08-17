<template>
  <q-card flat bordered class="top-card">
    <q-card-section class="row items-center q-gutter-sm q-pb-none">
      <q-icon :name="icon" color="primary" size="20px" />
      <div class="text-subtitle2 text-weight-bold">{{ title }}</div>
    </q-card-section>
    <q-list dense padding>
      <q-item v-for="row in rows" :key="row.key" :to="row.to" :clickable="!!row.to">
        <q-item-section>
          <q-item-label :class="{ 'deleted-label': row.deleted }" lines="1">
            {{ row.label }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <span class="count">{{ row.count.toLocaleString() }}</span>
        </q-item-section>
      </q-item>
      <q-item v-if="rows.length === 0">
        <q-item-section class="text-library-muted text-caption">
          {{ $t('admin.stats.noData') }}
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script setup lang="ts">
export interface TopListRow {
  key: string;
  label: string;
  /** True for an item/file deleted since — the count is still real, the row stays. */
  deleted: boolean;
  count: number;
  to?: string | undefined;
}

defineProps<{
  title: string;
  icon: string;
  rows: TopListRow[];
}>();
</script>

<style scoped lang="sass">
.top-card
  background: $surface
  border-radius: $radius
  height: 100%

.deleted-label
  color: $muted
  font-style: italic

.count
  font-weight: 700
  color: $ink
  font-variant-numeric: tabular-nums
</style>
