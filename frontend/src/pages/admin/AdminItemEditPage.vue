<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <div class="row items-center q-mb-md">
        <q-btn flat dense round icon="arrow_back" color="primary" @click="goBack" />
        <h1 class="text-h5 text-weight-bold q-my-none q-ml-sm">
          {{ isNew ? t('admin.edit.newTitle') : t('admin.edit.title') }}
        </h1>
        <q-space />
        <VisibilityBadge v-if="!loading" :status="visibilityStatus" />
      </div>

      <q-banner v-if="loadError" class="bg-negative text-white q-mb-md" rounded>
        {{ t('admin.edit.loadFailed') }}
      </q-banner>

      <q-card v-else flat bordered class="edit-card">
        <q-tabs
          v-model="tab"
          align="left"
          active-color="primary"
          indicator-color="primary"
          narrow-indicator
          no-caps
          @update:model-value="onTabChange"
        >
          <q-tab name="form" icon="edit" :label="t('admin.edit.tabForm')" />
          <q-tab name="json" icon="data_object" :label="t('admin.edit.tabJson')" />
          <q-tab v-if="!isNew" name="files" icon="attach_file" :label="t('admin.edit.tabFiles')" />
          <q-tab v-if="!isNew" name="history" icon="history" :label="t('admin.edit.tabHistory')" />
        </q-tabs>
        <q-separator />

        <q-tab-panels v-model="tab" animated>
          <!-- STRUCTURED FORM -->
          <q-tab-panel name="form">
            <div v-if="loading" class="q-pa-lg">
              <q-skeleton type="text" v-for="i in 6" :key="i" class="q-mb-md" />
            </div>
            <div v-else class="row q-col-gutter-md">
              <div class="col-12 col-md-8">
                <q-input
                  v-model="form.title"
                  outlined
                  :label="t('admin.edit.fields.title') + ' *'"
                  :rules="[(v) => !!v?.trim() || t('admin.edit.titleRequired')]"
                />
              </div>
              <div class="col-12 col-md-4">
                <q-select
                  v-model="visibilityStatus"
                  outlined
                  :options="visibilityOptions"
                  emit-value
                  map-options
                  :label="t('admin.items.columns.visibility')"
                />
              </div>

              <div class="col-12 col-md-6">
                <q-input v-model="form.subtitle" outlined :label="t('admin.edit.fields.subtitle')" />
              </div>
              <div class="col-12 col-md-6">
                <q-select
                  :model-value="form.firstResponsibility"
                  :options="authorOptions"
                  outlined use-input fill-input hide-selected clearable
                  input-debounce="300"
                  :label="t('admin.edit.fields.author')"
                  @filter="filterAuthor"
                  @input-value="form.firstResponsibility = $event"
                  @update:model-value="form.firstResponsibility = $event ?? ''"
                />
              </div>

              <div class="col-12 col-md-4">
                <q-select
                  :model-value="form.publisher"
                  :options="publisherOptions"
                  outlined use-input fill-input hide-selected clearable
                  input-debounce="300"
                  :label="t('admin.edit.fields.publisher')"
                  @filter="filterPublisher"
                  @input-value="form.publisher = $event"
                  @update:model-value="form.publisher = $event ?? ''"
                />
              </div>
              <div class="col-12 col-md-4">
                <q-input v-model="form.place" outlined :label="t('admin.edit.fields.place')" />
              </div>
              <div class="col-12 col-md-4">
                <q-input v-model="form.year" outlined :label="t('admin.edit.fields.year')" />
              </div>

              <div class="col-12 col-md-6">
                <q-input v-model="form.edition" outlined :label="t('admin.edit.fields.edition')" />
              </div>
              <div class="col-12 col-md-6">
                <q-input v-model="form.cobissId" outlined label="COBISS ID" :readonly="!isNew" />
              </div>

              <div class="col-12 col-md-4">
                <q-select
                  v-model="form.materialType"
                  :options="materialTypeOptions"
                  :option-label="codeLabel"
                  outlined clearable
                  :label="t('admin.edit.fields.materialType')"
                />
              </div>
              <div class="col-12 col-md-4">
                <q-select
                  v-model="form.language"
                  :options="languageOptions"
                  :option-label="codeLabel"
                  outlined multiple use-chips
                  :label="t('admin.edit.fields.language')"
                />
              </div>
              <div class="col-12 col-md-4">
                <q-select
                  v-model="form.country"
                  :options="countryOptions"
                  :option-label="codeLabel"
                  outlined multiple use-chips
                  :label="t('admin.edit.fields.country')"
                />
              </div>

              <div class="col-12">
                <q-input
                  v-model="form.summaryNote"
                  outlined
                  type="textarea"
                  autogrow
                  :label="t('admin.edit.fields.summary')"
                />
              </div>
            </div>
          </q-tab-panel>

          <!-- RAW JSON -->
          <q-tab-panel name="json">
            <div class="text-caption text-library-muted q-mb-sm">{{ t('admin.edit.jsonHint') }}</div>
            <q-input
              v-model="jsonText"
              outlined
              type="textarea"
              input-style="font-family: monospace; min-height: 420px"
              :error="!!jsonError"
              :error-message="jsonError"
              @update:model-value="jsonError = ''"
            />
          </q-tab-panel>

          <!-- FILES -->
          <q-tab-panel v-if="!isNew" name="files">
            <div class="row items-center q-mb-md">
              <div class="text-subtitle2">{{ t('admin.edit.filesTitle') }}</div>
              <q-space />
              <q-file
                v-model="pendingFiles"
                multiple
                dense
                outlined
                use-chips
                :label="t('admin.edit.chooseFiles')"
                class="col-12 col-md-5"
              />
              <q-btn
                unelevated
                no-caps
                color="primary"
                icon="upload"
                :label="t('admin.edit.upload')"
                :loading="uploading"
                :disable="!pendingFiles.length"
                class="q-ml-sm"
                @click="onUpload"
              />
            </div>

            <q-list v-if="files.length" bordered separator class="rounded-borders">
              <q-item v-for="file in files" :key="file.id">
                <q-item-section avatar>
                  <q-icon
                    :name="file.fileType === 'PDF' ? 'picture_as_pdf' : file.fileType === 'IMAGE' ? 'image' : 'insert_drive_file'"
                    color="primary"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ file.filename }}</q-item-label>
                  <q-item-label caption>
                    {{ formatSize(file.sizeBytes) }} · {{ file.mimeType }}
                    <TextExtractionIndicator
                      v-if="file.fileType === 'PDF'"
                      :status="file.textExtractionStatus"
                      show-ok
                      class="q-ml-xs"
                    />
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row q-gutter-xs">
                    <q-btn
                      flat
                      dense
                      round
                      icon="download"
                      color="primary"
                      @click="downloadFile(file.id, file.filename)"
                    />
                    <q-btn flat dense round icon="delete" color="negative" @click="onDeleteFile(file)" />
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
            <div v-else class="text-library-muted q-pa-md text-center">{{ t('admin.edit.noFiles') }}</div>
          </q-tab-panel>

          <!-- HISTORY -->
          <q-tab-panel v-if="!isNew" name="history">
            <HistoryTimeline :item-id="itemId!" />
          </q-tab-panel>
        </q-tab-panels>

        <q-separator />
        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat no-caps :label="t('admin.items.cancel')" @click="goBack" />
          <q-btn
            unelevated
            no-caps
            color="primary"
            icon="save"
            :label="t('admin.edit.save')"
            :loading="saving"
            @click="onSave"
          />
        </q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import {
  getItem,
  suggestValues,
  type FileAttachment,
  type IndexedRecord,
  type RecordMetadata,
  type ResolvedCode,
} from 'src/api/search';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import {
  conflictCurrentVersion,
  createItem,
  isVersionConflict,
  updateItem,
  listFiles,
  uploadFiles,
  deleteFile as apiDeleteFile,
  downloadFile,
  VISIBILITY_STATUSES,
  type ItemType,
  type VisibilityStatus,
} from 'src/api/admin';
import VisibilityBadge from 'src/components/admin/VisibilityBadge.vue';
import TextExtractionIndicator from 'src/components/admin/TextExtractionIndicator.vue';
import HistoryTimeline from 'src/components/admin/HistoryTimeline.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();

const itemId = computed(() => route.params.id as string | undefined);
const isNew = computed(() => !itemId.value);
const targetState = computed<ItemType>(() =>
  (route.query.type as string) === 'RECORD' ? 'RECORD' : 'DRAFT',
);

const tab = ref('form');
const loading = ref(!!route.params.id);
const loadError = ref(false);
const saving = ref(false);
const visibilityStatus = ref<VisibilityStatus>('PRIVATE');

// Full metadata object as loaded (preserves fields the form doesn't expose)
let metadata: Record<string, unknown> = {};

// Optimistic concurrency: last version we know of, plus a snapshot of the
// loaded state so a 409 can be resolved by comparing what changed on each side.
const currentVersion = ref(0);
let originalMetadata: Record<string, unknown> = {};
let originalVisibility: VisibilityStatus = 'PRIVATE';

// Flat form model over the most common metadata fields
const form = reactive({
  title: '',
  subtitle: '',
  firstResponsibility: '',
  publisher: '',
  place: '',
  year: '',
  edition: '',
  cobissId: '',
  summaryNote: '',
  materialType: null as ResolvedCode | null,
  language: [] as ResolvedCode[],
  country: [] as ResolvedCode[],
});

// ---------------------------------------------------------------------------
// Suggest-driven dropdowns & autocomplete
// ---------------------------------------------------------------------------

const { codeLabel } = useCodeLabel();

const materialTypeOptions = ref<ResolvedCode[]>([]);
const languageOptions = ref<ResolvedCode[]>([]);
const countryOptions = ref<ResolvedCode[]>([]);

async function loadEnumOptions() {
  try {
    const [types, langs, countries] = await Promise.all([
      suggestValues({ field: 'materialType', limit: 50 }),
      suggestValues({ field: 'language', limit: 50 }),
      suggestValues({ field: 'country', limit: 50 }),
    ]);
    materialTypeOptions.value = types.suggestions.map((s) => s.value);
    languageOptions.value = langs.suggestions.map((s) => s.value);
    countryOptions.value = countries.suggestions.map((s) => s.value);
  } catch {
    // dropdowns stay empty
  }
}

const publisherOptions = ref<string[]>([]);
const authorOptions = ref<string[]>([]);

type QFilterDone = (cb: () => void) => void;

function filterPublisher(input: string, doneFn: QFilterDone) {
  void (async () => {
    let options: string[] = [];
    try {
      const result = await suggestValues({
        field: 'publisher',
        ...(input.trim() ? { q: input.trim() } : {}),
        limit: 10,
      });
      options = result.suggestions.map((s) => s.value);
    } catch {
      options = [];
    }
    doneFn(() => {
      publisherOptions.value = options;
    });
  })();
}

function filterAuthor(input: string, doneFn: QFilterDone) {
  void (async () => {
    let options: string[] = [];
    try {
      const result = await suggestValues({
        field: 'author',
        ...(input.trim() ? { q: input.trim() } : {}),
        limit: 10,
      });
      options = [
        ...new Set(
          result.suggestions
            .map((s) => [s.value.firstName, s.value.familyName].filter(Boolean).join(' ').trim())
            .filter(Boolean),
        ),
      ];
    } catch {
      options = [];
    }
    doneFn(() => {
      authorOptions.value = options;
    });
  })();
}

const jsonText = ref('{}');
const jsonError = ref('');

const visibilityOptions = computed(() =>
  VISIBILITY_STATUSES.map((s) => ({ label: t(`admin.visibility.${s}`), value: s })),
);

function metadataToForm(m: Record<string, unknown>) {
  const meta = m as Partial<RecordMetadata>;
  form.title = meta.title ?? '';
  form.subtitle = meta.subtitle ?? '';
  form.firstResponsibility = meta.firstResponsibility ?? '';
  form.publisher = meta.publication?.publisher ?? '';
  form.place = meta.publication?.place ?? '';
  form.year = meta.publication?.year ?? '';
  form.edition = meta.edition ?? '';
  form.cobissId = meta.cobissId ?? '';
  form.summaryNote = meta.summaryNote ?? '';
  form.materialType = meta.materialType ?? null;
  form.language = meta.language ?? [];
  form.country = meta.country ?? [];
}

function formToMetadata(): Record<string, unknown> {
  const publication = {
    ...((metadata.publication as Record<string, unknown>) ?? {}),
    publisher: form.publisher || undefined,
    place: form.place || undefined,
    year: form.year || undefined,
  };
  return {
    ...metadata,
    title: form.title,
    subtitle: form.subtitle || undefined,
    firstResponsibility: form.firstResponsibility || undefined,
    publication,
    edition: form.edition || undefined,
    ...(isNew.value && form.cobissId ? { cobissId: form.cobissId } : {}),
    summaryNote: form.summaryNote || undefined,
    materialType: form.materialType ?? undefined,
    language: form.language.length ? [...form.language] : undefined,
    country: form.country.length ? [...form.country] : undefined,
  };
}

// Keep JSON tab and form in sync: entering the JSON tab renders the current
// state; leaving it (or saving from it) parses the text back. Only apply the
// JSON when actually coming FROM the json tab — applying it on any other tab
// switch (e.g. form → files) would overwrite the form with a stale snapshot.
let previousTab: string | number = 'form';
function onTabChange(next: string | number) {
  if (next === 'json') {
    jsonText.value = JSON.stringify(formToMetadata(), null, 2);
  } else if (previousTab === 'json') {
    applyJson(false);
  }
  previousTab = next;
}

function applyJson(showError = true): boolean {
  try {
    const parsed = JSON.parse(jsonText.value) as Record<string, unknown>;
    metadata = parsed;
    metadataToForm(parsed);
    jsonError.value = '';
    return true;
  } catch {
    if (showError) jsonError.value = t('admin.edit.invalidJson');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const files = ref<FileAttachment[]>([]);
const pendingFiles = ref<File[]>([]);
const uploading = ref(false);

function applyServerState(source: IndexedRecord) {
  metadata = (source.metadata as unknown as Record<string, unknown>) ?? {};
  visibilityStatus.value = source.visibilityStatus;
  currentVersion.value = source.version ?? 0;
  originalMetadata = structuredClone(metadata);
  originalVisibility = source.visibilityStatus;
  metadataToForm(metadata);
  if (tab.value === 'json') jsonText.value = JSON.stringify(formToMetadata(), null, 2);
}

onMounted(async () => {
  void loadEnumOptions();
  if (isNew.value) return;
  try {
    const hit = await getItem(itemId.value!);
    applyServerState(hit.source);
    files.value = await listFiles(itemId.value!);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
});

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function onSave() {
  if (tab.value === 'json' && !applyJson()) return;
  if (!form.title.trim()) {
    $q.notify({ type: 'negative', message: t('admin.edit.titleRequired') });
    tab.value = 'form';
    return;
  }

  saving.value = true;
  try {
    const meta = formToMetadata() as Partial<RecordMetadata>;
    if (isNew.value) {
      await createItem({
        visibilityStatus: visibilityStatus.value,
        targetState: targetState.value,
        metadata: meta,
      });
    } else {
      try {
        await updateItem(itemId.value!, {
          visibilityStatus: visibilityStatus.value,
          metadata: meta,
          expectedVersion: currentVersion.value,
        });
      } catch (err) {
        if (!isVersionConflict(err)) throw err;
        await handleConflict(meta as Record<string, unknown>, err);
        return;
      }
    }
    $q.notify({ type: 'positive', message: t('admin.edit.saved') });
    goBack();
  } catch (err) {
    const detail =
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: detail ? String(detail) : t('admin.items.actionFailed'),
    });
  } finally {
    saving.value = false;
  }
}

// ---------------------------------------------------------------------------
// Optimistic concurrency (409) handling
// ---------------------------------------------------------------------------

function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
}

// pgsync → OpenSearch indexing is eventually consistent; poll until the index
// has caught up with the version the 409 reported.
async function fetchFreshItem(minVersion: number): Promise<IndexedRecord | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const hit = await getItem(itemId.value!);
      if ((hit.source.version ?? 0) >= minVersion) return hit.source;
    } catch {
      // keep polling
    }
  }
  return undefined;
}

async function handleConflict(attemptedMeta: Record<string, unknown>, err: unknown) {
  const attemptedVisibility = visibilityStatus.value;
  const serverVersion = conflictCurrentVersion(err);
  const server = await fetchFreshItem(serverVersion ?? currentVersion.value + 1);

  if (server) {
    const serverMeta = (server.metadata as unknown as Record<string, unknown>) ?? {};
    const userKeys = changedKeys(originalMetadata, attemptedMeta);
    const serverKeys = changedKeys(originalMetadata, serverMeta);
    const metadataOverlap = userKeys.some(
      (k) =>
        serverKeys.includes(k) &&
        JSON.stringify(attemptedMeta[k] ?? null) !== JSON.stringify(serverMeta[k] ?? null),
    );
    const visibilityOverlap =
      attemptedVisibility !== originalVisibility &&
      server.visibilityStatus !== originalVisibility &&
      server.visibilityStatus !== attemptedVisibility;

    if (!metadataOverlap && !visibilityOverlap) {
      // Both sides touched different fields (e.g. the server-side count
      // trigger bumped the version): merge onto the server state and retry
      // without bothering the user.
      const mergedMeta: Record<string, unknown> = { ...serverMeta };
      for (const k of userKeys) mergedMeta[k] = attemptedMeta[k];
      try {
        const result = await updateItem(itemId.value!, {
          visibilityStatus: attemptedVisibility,
          metadata: mergedMeta as Partial<RecordMetadata>,
          expectedVersion: server.version ?? 0,
        });
        currentVersion.value = result?.version ?? (server.version ?? 0) + 1;
        $q.notify({ type: 'positive', message: t('admin.edit.saved') });
        goBack();
        return;
      } catch (retryErr) {
        if (!isVersionConflict(retryErr)) throw retryErr;
      }
    }
    applyServerState(server);
  }

  $q.notify({
    type: 'warning',
    timeout: 0,
    multiLine: true,
    message: t('admin.edit.conflictRefreshed'),
    actions: [
      {
        label: t('admin.edit.saveAnyway'),
        color: 'dark',
        noCaps: true,
        handler: () => void forceSave(attemptedMeta, attemptedVisibility),
      },
      { label: t('admin.edit.dismiss'), color: 'dark', noCaps: true },
    ],
  });
}

// Last-write-wins override: re-apply the user's attempted changes on top of
// the freshest version we can determine.
async function forceSave(
  attemptedMeta: Record<string, unknown>,
  attemptedVisibility: VisibilityStatus,
) {
  saving.value = true;
  try {
    let expected = currentVersion.value;
    try {
      const hit = await getItem(itemId.value!);
      expected = Math.max(expected, hit.source.version ?? 0);
    } catch {
      // fall back to the last version we know
    }
    const payload = {
      visibilityStatus: attemptedVisibility,
      metadata: attemptedMeta as Partial<RecordMetadata>,
    };
    try {
      await updateItem(itemId.value!, { ...payload, expectedVersion: expected });
    } catch (err) {
      const current = isVersionConflict(err) ? conflictCurrentVersion(err) : undefined;
      if (current === undefined) throw err;
      await updateItem(itemId.value!, { ...payload, expectedVersion: current });
    }
    $q.notify({ type: 'positive', message: t('admin.edit.saved') });
    goBack();
  } catch (err) {
    const detail =
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    $q.notify({
      type: 'negative',
      message: detail ? String(detail) : t('admin.items.actionFailed'),
    });
  } finally {
    saving.value = false;
  }
}

function goBack() {
  if (isNew.value) {
    void router.push(targetState.value === 'RECORD' ? '/admin/records' : '/admin/drafts');
  } else if (window.history.length > 1) {
    router.back();
  } else {
    void router.push('/admin');
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

async function onUpload() {
  uploading.value = true;
  try {
    await uploadFiles(itemId.value!, pendingFiles.value);
    pendingFiles.value = [];
    files.value = await listFiles(itemId.value!);
    $q.notify({ type: 'positive', message: t('admin.edit.uploaded') });
  } catch {
    $q.notify({ type: 'negative', message: t('admin.items.actionFailed') });
  } finally {
    uploading.value = false;
  }
}

function onDeleteFile(file: FileAttachment) {
  $q.dialog({
    title: t('admin.items.confirmTitle'),
    message: t('admin.edit.deleteFileConfirm', { name: file.filename }),
    cancel: { flat: true, noCaps: true, label: t('admin.items.cancel') },
    ok: { unelevated: true, noCaps: true, color: 'negative', label: t('admin.items.confirm') },
  }).onOk(() => {
    void (async () => {
      try {
        await apiDeleteFile(file.id);
        files.value = files.value.filter((f) => f.id !== file.id);
        $q.notify({ type: 'positive', message: t('admin.edit.fileDeleted') });
      } catch {
        $q.notify({ type: 'negative', message: t('admin.items.actionFailed') });
      }
    })();
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
</script>

<style scoped lang="sass">
.page-body
  max-width: 1024px
  margin: 0 auto

.edit-card
  background: $surface
  border-radius: $radius
</style>
