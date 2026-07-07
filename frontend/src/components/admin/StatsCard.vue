<template>
  <q-card flat bordered class="stats-card">
    <q-card-section class="row items-center q-gutter-md">
      <q-icon :name="icon" size="36px" color="primary" />
      <div>
        <div class="text-subtitle1 text-weight-bold">{{ title }}</div>
        <div class="text-h4 text-weight-bold text-primary">
          <q-skeleton v-if="loading" type="text" width="60px" />
          <template v-else>{{ total }}</template>
        </div>
      </div>
      <q-space />
      <q-btn flat round icon="arrow_forward" color="primary" :to="to" />
    </q-card-section>
    <q-separator />
    <q-card-section class="row q-gutter-md">
      <div v-for="status in VISIBILITY_STATUSES" :key="status" class="row items-center q-gutter-xs">
        <VisibilityBadge :status="status" />
        <span class="text-weight-bold">
          <q-skeleton v-if="loading" type="text" width="24px" />
          <template v-else>{{ counts?.[status] ?? 0 }}</template>
        </span>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { VISIBILITY_STATUSES, type VisibilityStatus } from 'src/api/admin';
import VisibilityBadge from './VisibilityBadge.vue';

const props = defineProps<{
  title: string;
  icon: string;
  counts?: Record<VisibilityStatus, number> | undefined;
  loading: boolean;
  to: string;
}>();

const total = computed(() =>
  props.counts ? Object.values(props.counts).reduce((a, b) => a + b, 0) : 0,
);
</script>

<style scoped lang="sass">
.stats-card
  border-radius: 12px
  background: white
</style>
