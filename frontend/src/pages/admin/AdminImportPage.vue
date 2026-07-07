<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <h1 class="text-h5 text-weight-bold q-mt-none q-mb-lg">{{ t('admin.import.title') }}</h1>

      <div class="row q-col-gutter-lg">
        <!-- NEW IMPORT -->
        <div class="col-12 col-md-6">
          <q-card flat bordered class="panel-card">
            <q-card-section>
              <div class="text-subtitle1 text-weight-bold q-mb-md">
                {{ t('admin.import.newImport') }}
              </div>

              <q-input
                v-model="idsText"
                outlined
                type="textarea"
                :label="t('admin.import.idsLabel')"
                :hint="t('admin.import.idsHint')"
                input-style="min-height: 140px"
              />

              <div class="row q-col-gutter-md q-mt-sm">
                <div class="col-6">
                  <q-select
                    v-model="target"
                    outlined
                    :options="targetOptions"
                    emit-value
                    map-options
                    :label="t('admin.import.target')"
                  />
                </div>
                <div class="col-6">
                  <q-select
                    v-model="visibility"
                    outlined
                    :options="visibilityOptions"
                    emit-value
                    map-options
                    :label="t('admin.items.columns.visibility')"
                  />
                </div>
              </div>

              <q-btn
                unelevated
                no-caps
                color="primary"
                icon="cloud_download"
                :label="t('admin.import.start', { count: parsedIds.length })"
                :disable="parsedIds.length === 0 || !target"
                :loading="submitting"
                class="q-mt-md full-width"
                @click="onSubmit"
              />
            </q-card-section>
          </q-card>
        </div>

        <!-- JOBS -->
        <div class="col-12 col-md-6">
          <q-card flat bordered class="panel-card">
            <q-card-section>
              <div class="row items-center q-mb-md">
                <div class="text-subtitle1 text-weight-bold">{{ t('admin.import.jobs') }}</div>
                <q-space />
                <q-btn flat dense round icon="refresh" color="primary" @click="refreshJobs" />
              </div>

              <div v-if="jobs.length === 0" class="text-grey-7 text-center q-pa-md">
                {{ t('admin.import.noJobs') }}
              </div>

              <q-list v-else separator>
                <q-item v-for="job in jobs" :key="job.jobId">
                  <q-item-section avatar>
                    <q-icon :name="stateIcon(job)" :color="stateColor(job)" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>
                      #{{ job.jobId }} · {{ job.source }}
                      <q-badge :color="stateColor(job)" :label="job.state" class="q-ml-xs" />
                    </q-item-label>
                    <q-item-label caption>
                      {{ new Date(job.requestedAt).toLocaleString() }}
                    </q-item-label>
                    <template v-if="job.progress">
                      <q-linear-progress
                        :value="job.progress.total ? job.progress.processed / job.progress.total : 0"
                        color="primary"
                        class="q-mt-xs"
                        rounded
                        size="8px"
                      />
                      <q-item-label caption class="q-mt-xs">
                        {{ t('admin.import.progress', {
                          processed: job.progress.processed,
                          total: job.progress.total,
                          succeeded: job.progress.succeeded,
                          failed: job.progress.failed,
                        }) }}
                      </q-item-label>
                      <q-item-label
                        v-for="err in job.progress.errors"
                        :key="err.id"
                        caption
                        class="text-negative"
                      >
                        {{ err.id }}: {{ err.reason }}
                      </q-item-label>
                    </template>
                    <q-item-label v-if="job.failedReason" caption class="text-negative">
                      {{ job.failedReason }}
                    </q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import {
  getImportJobStatus,
  importCobiss,
  VISIBILITY_STATUSES,
  type ImportJobStatus,
  type ItemType,
  type VisibilityStatus,
} from 'src/api/admin';
import { useAuthz } from 'src/composables/useAuthz';

const { t } = useI18n();
const $q = useQuasar();
const { canManageRecords, canManageDrafts } = useAuthz();

// Remember jobs across visits so a running import isn't lost on navigation.
const STORAGE_KEY = 'nbcg-admin-import-jobs';

const idsText = ref('');
const target = ref<ItemType | null>(canManageDrafts.value ? 'DRAFT' : canManageRecords.value ? 'RECORD' : null);
const visibility = ref<VisibilityStatus>('PRIVATE');
const submitting = ref(false);
const jobs = ref<ImportJobStatus[]>([]);

const parsedIds = computed(() =>
  idsText.value
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean),
);

const targetOptions = computed(() => {
  const options: { label: string; value: ItemType }[] = [];
  if (canManageDrafts.value) options.push({ label: t('admin.import.targetDraft'), value: 'DRAFT' });
  if (canManageRecords.value) options.push({ label: t('admin.import.targetRecord'), value: 'RECORD' });
  return options;
});

const visibilityOptions = computed(() =>
  VISIBILITY_STATUSES.map((s) => ({ label: t(`admin.visibility.${s}`), value: s })),
);

function stateColor(job: ImportJobStatus): string {
  switch (job.state) {
    case 'completed':
      return job.progress && job.progress.failed > 0 ? 'warning' : 'positive';
    case 'failed':
      return 'negative';
    case 'active':
      return 'primary';
    default:
      return 'grey-7';
  }
}

function stateIcon(job: ImportJobStatus): string {
  switch (job.state) {
    case 'completed':
      return job.progress && job.progress.failed > 0 ? 'warning' : 'check_circle';
    case 'failed':
      return 'error';
    case 'active':
      return 'sync';
    default:
      return 'schedule';
  }
}

function loadStoredJobIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function storeJobId(jobId: string) {
  const ids = [jobId, ...loadStoredJobIds().filter((id) => id !== jobId)].slice(0, 10);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

async function refreshJobs() {
  const ids = loadStoredJobIds();
  const statuses = await Promise.all(
    ids.map((id) => getImportJobStatus(id).catch(() => null)),
  );
  jobs.value = statuses.filter((s): s is ImportJobStatus => s !== null);
}

const hasActiveJobs = computed(() =>
  jobs.value.some((j) => j.state === 'active' || j.state === 'waiting' || j.state === 'delayed'),
);

let pollTimer: ReturnType<typeof setInterval> | undefined;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    void refreshJobs().then(() => {
      if (!hasActiveJobs.value) stopPolling();
    });
  }, 2500);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
}

async function onSubmit() {
  if (!target.value) return;
  submitting.value = true;
  try {
    const { jobId } = await importCobiss({
      ids: parsedIds.value,
      target: target.value,
      visibilityStatus: visibility.value,
    });
    storeJobId(jobId);
    idsText.value = '';
    $q.notify({ type: 'positive', message: t('admin.import.started', { jobId }) });
    await refreshJobs();
    startPolling();
  } catch (err) {
    const detail =
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: detail ? String(detail) : t('admin.items.actionFailed'),
    });
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void refreshJobs().then(() => {
    if (hasActiveJobs.value) startPolling();
  });
});
onUnmounted(stopPolling);
</script>

<style scoped lang="sass">
.page-body
  max-width: 1280px
  margin: 0 auto

.panel-card
  background: white
  border-radius: 12px
</style>
