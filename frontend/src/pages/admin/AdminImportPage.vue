<template>
  <q-page class="adm-page">
    <AdminPageHeader
      :eyebrow="t('admin.nav.groupCatalogue')"
      :title="t('admin.import.title')"
      :caption="t('admin.import.caption')"
    />

    <div class="import-grid">
      <!-- NEW IMPORT -->
      <q-card flat bordered>
        <div class="adm-card__body column q-gutter-y-md">
          <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.import.newImport') }}</h2>

          <FormField
            :label="t('admin.import.idsLabel')"
            for-id="import-ids"
            :hint="`${t('admin.import.idsHint')} ${t('admin.import.idsCount', { count: parsedIds.length })}`"
          >
            <q-input
              v-model="idsText"
              outlined
              type="textarea"
              for="import-ids"
              input-class="adm-mono"
              input-style="min-height: 132px; font-size: 13px; line-height: 1.6"
            />
          </FormField>

          <div class="row q-col-gutter-md">
            <div class="col-6">
              <FormField :label="t('admin.import.target')" for-id="import-target">
                <q-select
                  v-model="target"
                  outlined
                  dense
                  options-dense
                  for="import-target"
                  :options="targetOptions"
                  emit-value
                  map-options
                />
              </FormField>
            </div>
            <div class="col-6">
              <FormField :label="t('admin.items.columns.visibility')" for-id="import-visibility">
                <q-select
                  v-model="visibility"
                  outlined
                  dense
                  options-dense
                  for="import-visibility"
                  :options="visibilityOptions"
                  emit-value
                  map-options
                >
                  <template #prepend>
                    <span class="adm-dot" :class="VISIBILITY_DOT[visibility]" />
                  </template>
                </q-select>
              </FormField>
            </div>
          </div>

          <q-btn
            unelevated
            no-caps
            color="primary"
            icon="o_cloud_download"
            :label="t('admin.import.start', { count: parsedIds.length })"
            :disable="parsedIds.length === 0 || !target"
            :loading="submitting"
            @click="onSubmit"
          />
        </div>
      </q-card>

      <!-- JOBS -->
      <q-card flat bordered>
        <div class="adm-card__head jobs-head">
          <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.import.jobs') }}</h2>
          <span v-if="runningCount > 0" class="text-caption adm-muted">
            {{ t('admin.import.running', { count: runningCount }) }}
          </span>
          <q-space />
          <q-btn
            flat
            dense
            round
            icon="o_refresh"
            color="primary"
            :aria-label="t('admin.import.refresh')"
            @click="refreshJobs"
          />
        </div>

        <div v-if="jobs.length === 0" class="adm-empty">{{ t('admin.import.noJobs') }}</div>

        <div v-for="job in jobs" :key="job.jobId" class="job">
          <q-avatar size="36px" :class="`job__icon job__icon--${tone(job)}`">
            <q-icon :name="stateIcon(job)" size="18px" />
          </q-avatar>
          <div class="col column q-gutter-y-sm job__body">
            <div class="row items-center no-wrap q-gutter-x-sm">
              <span class="job__title">{{ t('admin.import.job', { id: job.jobId, source: job.source }) }}</span>
              <q-badge class="badge-soft badge-soft--sm" :class="`badge-soft--${tone(job)}`">
                {{ stateLabel(job.state) }}
              </q-badge>
              <q-space />
              <span class="text-caption adm-muted">
                {{ t('admin.import.startedAt', { when: formatDateTime(job.requestedAt, locale) }) }}
              </span>
            </div>

            <template v-if="job.progress">
              <q-linear-progress
                :value="job.progress.total ? job.progress.processed / job.progress.total : 0"
                :color="progressColor(job)"
                track-color="grey-3"
                rounded
                size="8px"
              />
              <div class="text-caption adm-muted">
                {{
                  t('admin.import.progress', {
                    processed: job.progress.processed,
                    total: job.progress.total,
                    succeeded: job.progress.succeeded,
                    failed: job.progress.failed,
                  })
                }}
                <template v-if="job.progress.warnings?.length">
                  ·
                  <span class="job__warn-count">
                    {{ t('admin.import.withWarnings', { count: job.progress.warnings.length }) }}
                  </span>
                </template>
              </div>

              <div
                v-for="err in job.progress.errors"
                :key="`e-${err.id}`"
                class="job__error adm-mono"
              >
                {{ err.id }}: {{ err.reason }}
              </div>

              <!-- Imported all the same — an import is never blocked by the save check — but worth fixing later -->
              <div v-if="job.progress.warnings?.length" class="job__warnings" role="note">
                <span class="text-weight-bold">
                  {{ t('admin.import.warningsTitle', { count: job.progress.warnings.length }) }}
                </span>
                <span v-for="warning in job.progress.warnings" :key="`w-${warning.id}`" class="row no-wrap q-gutter-x-sm">
                  <span class="adm-mono text-weight-bold">{{ warning.id }}</span>
                  <span>{{ warning.reason }}</span>
                </span>
              </div>
            </template>

            <div v-if="job.failedReason" class="job__error">{{ job.failedReason }}</div>
          </div>
        </div>
      </q-card>
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
import { apiErrorMessage } from 'src/api/errors';
import { useAuthz } from 'src/composables/useAuthz';
import { formatDateTime } from 'src/utils/adminFormat';
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import FormField from 'src/components/admin/FormField.vue';

const i18n = useI18n();
const { t, locale } = i18n;
const $q = useQuasar();
const { canManageRecords, canManageDrafts } = useAuthz();

// Remember jobs across visits so a running import isn't lost on navigation.
const STORAGE_KEY = 'nbcg-admin-import-jobs';

const VISIBILITY_DOT: Record<VisibilityStatus, string> = {
  PUBLIC: 'adm-dot--positive',
  PRIVATE: 'adm-dot--warning',
  HIDDEN: '',
};

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

// ── How a job reads: one tone for the icon, the badge and the bar ──

type Tone = 'positive' | 'warning' | 'negative' | 'primary' | 'muted';

function isRunning(job: ImportJobStatus): boolean {
  return job.state === 'active' || job.state === 'waiting' || job.state === 'delayed';
}

function tone(job: ImportJobStatus): Tone {
  switch (job.state) {
    case 'completed':
      return job.progress && (job.progress.failed > 0 || job.progress.warnings?.length)
        ? 'warning'
        : 'positive';
    case 'failed':
      return 'negative';
    case 'active':
      return 'primary';
    default:
      return 'muted';
  }
}

function progressColor(job: ImportJobStatus): string {
  const current = tone(job);
  return current === 'muted' ? 'grey-6' : current;
}

function stateIcon(job: ImportJobStatus): string {
  switch (job.state) {
    case 'completed':
      return tone(job) === 'warning' ? 'o_warning_amber' : 'o_check_circle';
    case 'failed':
      return 'o_error_outline';
    case 'active':
      return 'o_sync';
    default:
      return 'o_schedule';
  }
}

function stateLabel(state: string): string {
  const key = `admin.import.states.${state}`;
  return i18n.te(key) ? t(key) : state;
}

const runningCount = computed(() => jobs.value.filter(isRunning).length);

// ── Jobs: stored ids, status polling ──

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

const hasActiveJobs = computed(() => jobs.value.some(isRunning));

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
    $q.notify({ type: 'negative', message: apiErrorMessage(err) ?? t('admin.common.actionFailed') });
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
.import-grid
  display: grid
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr)
  gap: 24px
  align-items: start

.jobs-head
  padding: 10px 12px 10px 20px
  border-bottom-color: $divider

.job
  display: flex
  gap: 14px
  padding: 16px 20px
  border-bottom: 1px solid $divider-soft
  &:last-child
    border-bottom: none

.job__body
  min-width: 0

.job__title
  font-size: 14px
  font-weight: 600

.job__icon
  flex: none

.job__icon--positive
  background: $soft-positive
  color: $soft-positive-ink

.job__icon--warning
  background: $soft-warning
  color: $soft-warning-ink

.job__icon--negative
  background: $soft-negative
  color: $negative

.job__icon--primary
  background: $soft-primary
  color: $primary

.job__icon--muted
  background: $soft-muted
  color: $soft-muted-ink

.job__warn-count
  font-weight: 600
  color: $soft-warning-ink

.job__error
  font-size: 12px
  color: $negative
  overflow-wrap: anywhere

.job__warnings
  display: flex
  flex-direction: column
  gap: 6px
  padding: 10px 12px
  background: $soft-warning
  border-radius: $radius
  font-size: 13px
  line-height: 1.45
  color: #4A3608

@media (max-width: 1100px)
  .import-grid
    grid-template-columns: minmax(0, 1fr)
</style>
