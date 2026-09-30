<template>
  <span :title="full">{{ text }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime, formatRelative } from 'src/utils/adminFormat';

// "2 h ago" with the full timestamp as the tooltip. Computed once per render:
// the admin lists are reloaded often enough that a ticking clock is not worth it.

const props = defineProps<{ value: string | null | undefined }>();

const { t, locale } = useI18n();

const text = computed(() => formatRelative(props.value, locale.value, t));
const full = computed(() => formatDateTime(props.value, locale.value));
</script>
