<template>
  <router-link :to="to" class="kpi-tile">
    <div class="kpi-tile__head">
      <span>{{ title }}</span>
      <q-icon :name="icon" size="18px" />
    </div>
    <div class="kpi-tile__value">
      <q-skeleton v-if="loading" type="text" width="60px" />
      <template v-else>{{ formatCount(total) }}</template>
    </div>
    <div class="kpi-tile__legend">
      <span v-for="status in VISIBILITY_STATUSES" :key="status">
        <span class="adm-dot" :class="DOT_CLASS[status]" />
        {{ loading ? '…' : formatCount(counts?.[status] ?? 0) }}
        {{ t(`admin.visibility.${status}`).toLowerCase() }}
      </span>
    </div>
  </router-link>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { VISIBILITY_STATUSES, type VisibilityStatus } from 'src/api/admin';
import { formatCount } from 'src/utils/adminFormat';

// A dashboard KPI tile for one collection: the total, and how it splits by
// visibility. The whole tile is the link to the list. (.kpi-tile lives in
// src/css/admin.sass, shared with the dashboard's other tiles.)

const props = defineProps<{
  title: string;
  icon: string;
  counts?: Record<VisibilityStatus, number> | undefined;
  loading: boolean;
  to: string;
}>();

const { t } = useI18n();

const DOT_CLASS: Record<VisibilityStatus, string> = {
  PUBLIC: 'adm-dot--positive',
  PRIVATE: 'adm-dot--warning',
  HIDDEN: '',
};

const total = computed(() =>
  props.counts ? Object.values(props.counts).reduce((a, b) => a + b, 0) : 0,
);
</script>
