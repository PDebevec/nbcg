<template>
  <q-card flat bordered class="top-card">
    <div class="top-card__head">
      <q-icon :name="icon" color="primary" size="18px" />
      <span>{{ title }}</span>
    </div>
    <q-list>
      <q-item
        v-for="(row, index) in rows"
        :key="row.key"
        :to="row.to"
        :clickable="!!row.to"
        class="top-card__row"
        :class="{ 'top-card__row--deleted': row.deleted }"
      >
        <q-item-section side class="top-card__rank">{{ index + 1 }}</q-item-section>
        <q-item-section>
          <q-item-label lines="1">{{ row.label }}</q-item-label>
        </q-item-section>
        <q-item-section side class="top-card__count">{{ formatCount(row.count) }}</q-item-section>
      </q-item>
      <q-item v-if="rows.length === 0">
        <q-item-section class="adm-muted text-caption">{{ t('admin.stats.noData') }}</q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { formatCount } from 'src/utils/adminFormat';

// A ranked list on the statistics page: most viewed / downloaded items and files.

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

const { t } = useI18n();
</script>

<style scoped lang="sass">
.top-card
  height: 100%

.top-card__head
  display: flex
  align-items: center
  gap: 8px
  padding: 14px 16px
  border-bottom: 1px solid $divider-soft
  font-size: 14px
  font-weight: 700

.top-card__row
  min-height: 42px
  padding: 0 16px
  border-bottom: 1px solid $divider-soft
  font-size: 14px
  color: $ink
  &:last-child
    border-bottom: none

.top-card__row--deleted
  color: #8A8272
  font-style: italic

.top-card__rank
  width: 20px
  padding-right: 12px
  font-size: 12px
  font-style: normal
  color: #8A8272
  font-variant-numeric: tabular-nums

.top-card__count
  font-weight: 700
  font-style: normal
  color: inherit
  font-variant-numeric: tabular-nums
</style>
