<template>
  <div>
    <div v-if="error" class="text-negative q-pa-md">{{ t('admin.tasks.history.loadFailed') }}</div>

    <div v-else-if="loading && entries.length === 0" class="q-pa-md">
      <q-skeleton v-for="i in 3" :key="i" type="text" class="q-mb-md" />
    </div>

    <TaskHistoryList v-else :entries="entries" show-task-link />

    <div v-if="entries.length > 0 && entries.length < total" class="text-center q-py-md">
      <q-btn
        outline
        no-caps
        color="primary"
        :loading="loading"
        :label="t('admin.tasks.history.loadMore')"
        @click="loadMore"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getItemTaskHistory, type ItemTaskHistoryEntry } from 'src/api/tasks';
import TaskHistoryList from 'src/components/admin/TaskHistoryList.vue';

// ---------------------------------------------------------------------------
// The audit view of one item: every task-history entry ever written against
// it, newest first, spanning tasks that no longer exist. Same shape and
// paging as HistoryTimeline.vue, over the task log instead of revisions.
// ---------------------------------------------------------------------------

const props = defineProps<{
  itemId: string;
  /** Bump to reload — e.g. after a task was filed from the same page. */
  refreshKey?: number;
}>();

const { t } = useI18n();

const PAGE_SIZE = 50;

const entries = ref<ItemTaskHistoryEntry[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref(false);

async function load(offset: number) {
  loading.value = true;
  try {
    const result = await getItemTaskHistory(props.itemId, { limit: PAGE_SIZE, offset });
    total.value = result.total;
    entries.value = offset === 0 ? result.history : [...entries.value, ...result.history];
    error.value = false;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  void load(entries.value.length);
}

onMounted(() => void load(0));
watch([() => props.itemId, () => props.refreshKey], () => void load(0));
</script>
