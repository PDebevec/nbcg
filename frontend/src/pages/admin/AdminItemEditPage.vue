<template>
  <q-page class="q-pa-lg">
    <div class="page-body">
      <div class="row items-center q-mb-md">
        <q-btn flat dense round icon="arrow_back" color="primary" @click="goBack" />
        <h1 class="text-h5 text-weight-bold q-my-none q-ml-sm">
          {{ isNew ? t('admin.edit.newTitle') : t('admin.edit.title') }}
        </h1>
        <q-space />
        <q-btn
          v-if="!isNew && !loading && !loadError && isStaff"
          outline
          no-caps
          color="primary"
          icon="assignment_ind"
          :label="t('admin.edit.assignTask')"
          class="q-mr-md"
          @click="assignOpen = true"
        />
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
          <q-tab
            v-if="!isNew && isStaff"
            name="tasks"
            icon="assignment"
            :label="t('admin.edit.tabTasks')"
          />
        </q-tabs>
        <q-separator />

        <q-tab-panels v-model="tab" animated>
          <!-- STRUCTURED FORM -->
          <q-tab-panel name="form">
            <div v-if="loading" class="q-pa-lg">
              <q-skeleton type="text" v-for="i in 6" :key="i" class="q-mb-md" />
            </div>
            <ItemMetadataForm
              v-else
              v-model="form"
              :code-lists="codeLists"
              :code-lists-failed="codeListsFailed"
              :is-new="isNew"
            >
              <template #visibility>
                <q-select
                  v-model="visibilityStatus"
                  outlined
                  :options="visibilityOptions"
                  emit-value
                  map-options
                  :label="t('admin.items.columns.visibility')"
                />
              </template>
            </ItemMetadataForm>
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

          <!-- TASKS: what happened around this record, across every task ever filed -->
          <q-tab-panel v-if="!isNew && isStaff" name="tasks">
            <ItemTaskHistory :item-id="itemId!" :refresh-key="tasksRefreshKey" />
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

    <CreateTaskDialog
      v-if="!isNew"
      v-model="assignOpen"
      :item-id="itemId!"
      :item-type="itemType"
      @created="tasksRefreshKey++"
    />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import {
  getItem,
  suggestValues,
  type FileAttachment,
  type IndexedRecord,
} from 'src/api/search';
import {
  conflictCurrentVersion,
  createItem,
  getRecordSchema,
  isVersionConflict,
  updateItem,
  listFiles,
  uploadFiles,
  deleteFile as apiDeleteFile,
  downloadFile,
  VISIBILITY_STATUSES,
  type ItemType,
  type MetadataPayload,
  type VisibilityStatus,
} from 'src/api/admin';
import { useAuthz } from 'src/composables/useAuthz';
import VisibilityBadge from 'src/components/admin/VisibilityBadge.vue';
import TextExtractionIndicator from 'src/components/admin/TextExtractionIndicator.vue';
import HistoryTimeline from 'src/components/admin/HistoryTimeline.vue';
import ItemTaskHistory from 'src/components/admin/ItemTaskHistory.vue';
import CreateTaskDialog from 'src/components/admin/CreateTaskDialog.vue';
import ItemMetadataForm from 'src/components/admin/ItemMetadataForm.vue';
import {
  codeListsFromSchema,
  emptyCodeLists,
  emptyForm,
  formToMetadata,
  metadataForDisplay,
  metadataToForm,
  type CodeLists,
  type MetadataForm,
} from 'src/components/admin/form/metadataForm';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const { isStaff } = useAuthz();

const itemId = computed(() => route.params.id as string | undefined);
const isNew = computed(() => !itemId.value);

// ── Task delegation ──
// Which collection the item lives in, from the search hit's index name; picks
// the default task kind (a draft is usually "ready for review").
const itemType = ref<ItemType | null>(null);
const assignOpen = ref(false);
const tasksRefreshKey = ref(0);
const targetState = computed<ItemType>(() =>
  (route.query.type as string) === 'RECORD' ? 'RECORD' : 'DRAFT',
);

const tab = ref('form');
const loading = ref(!!route.params.id);
const loadError = ref(false);
const saving = ref(false);
const visibilityStatus = ref<VisibilityStatus>('PRIVATE');

// Metadata as loaded — the base every payload is built on, so keys the form
// does not own (collectionType, _source, children counters) pass through.
let metadata: Record<string, unknown> = {};

// Optimistic concurrency: last version we know of, plus a snapshot of the
// loaded state so a 409 can be resolved by comparing what changed on each side.
const currentVersion = ref(0);
let originalMetadata: Record<string, unknown> = {};
let originalVisibility: VisibilityStatus = 'PRIVATE';

// The structured form over every editable field. ItemMetadataForm binds into
// this object directly.
const form = ref<MetadataForm>(emptyForm());

const payloadMode = computed(() => (isNew.value ? 'create' : 'update'));

function buildPayload(): MetadataPayload {
  return formToMetadata(form.value, metadata, payloadMode.value);
}

// ---------------------------------------------------------------------------
// Code lists (GET /schema/record) for the enum pickers. If the schema cannot
// be loaded, fall back to the values already in use so the most common
// dropdowns still work, and say so on the form.
// ---------------------------------------------------------------------------

const codeLists = ref<CodeLists>(emptyCodeLists());
const codeListsFailed = ref(false);

async function loadCodeLists() {
  try {
    const { fields } = await getRecordSchema();
    codeLists.value = codeListsFromSchema(fields);
    return;
  } catch {
    codeListsFailed.value = true;
  }
  try {
    const [types, langs, countries] = await Promise.all([
      suggestValues({ field: 'materialType', limit: 50 }),
      suggestValues({ field: 'language', limit: 50 }),
      suggestValues({ field: 'country', limit: 50 }),
    ]);
    codeLists.value = {
      ...emptyCodeLists(),
      materialType: types.suggestions.map((s) => s.value),
      language: langs.suggestions.map((s) => s.value),
      country: countries.suggestions.map((s) => s.value),
    };
  } catch {
    // dropdowns stay empty; free-text fields still work
  }
}

// ---------------------------------------------------------------------------
// JSON tab
// ---------------------------------------------------------------------------

const jsonText = ref('{}');
const jsonError = ref('');

const visibilityOptions = computed(() =>
  VISIBILITY_STATUSES.map((s) => ({ label: t(`admin.visibility.${s}`), value: s })),
);

function renderJson() {
  jsonText.value = JSON.stringify(metadataForDisplay(buildPayload()), null, 2);
}

// Keep JSON tab and form in sync: entering the JSON tab renders the current
// state; leaving it (or saving from it) parses the text back. Only apply the
// JSON when actually coming FROM the json tab — applying it on any other tab
// switch (e.g. form → files) would overwrite the form with a stale snapshot.
let previousTab: string | number = 'form';
function onTabChange(next: string | number) {
  if (next === 'json') {
    renderJson();
  } else if (previousTab === 'json') {
    applyJson(false);
  }
  previousTab = next;
}

function applyJson(showError = true): boolean {
  try {
    const parsed = JSON.parse(jsonText.value) as Record<string, unknown>;
    // A key deleted in the JSON is cleared on save: the form no longer holds
    // it, so the payload sends `null` for it (update) or omits it (create).
    metadata = parsed;
    form.value = metadataToForm(parsed);
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
  form.value = metadataToForm(metadata);
  if (tab.value === 'json') renderJson();
}

onMounted(async () => {
  void loadCodeLists();
  if (isNew.value) return;
  try {
    const hit = await getItem(itemId.value!);
    applyServerState(hit.source);
    itemType.value = hit.index === 'records' ? 'RECORD' : hit.index === 'drafts' ? 'DRAFT' : null;
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
  if (!form.value.title.trim()) {
    $q.notify({ type: 'negative', message: t('admin.edit.titleRequired') });
    tab.value = 'form';
    return;
  }

  saving.value = true;
  try {
    const meta = buildPayload();
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
        await handleConflict(meta, err);
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

// `null` in the attempted payload means "cleared", which is the same as absent
// on the stored side — so both normalise to null before comparing.
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

async function handleConflict(attemptedMeta: MetadataPayload, err: unknown) {
  const attempted = attemptedMeta as Record<string, unknown>;
  const attemptedVisibility = visibilityStatus.value;
  const serverVersion = conflictCurrentVersion(err);
  const server = await fetchFreshItem(serverVersion ?? currentVersion.value + 1);

  if (server) {
    const serverMeta = (server.metadata as unknown as Record<string, unknown>) ?? {};
    const userKeys = changedKeys(originalMetadata, attempted);
    const serverKeys = changedKeys(originalMetadata, serverMeta);
    const metadataOverlap = userKeys.some(
      (k) =>
        serverKeys.includes(k) &&
        JSON.stringify(attempted[k] ?? null) !== JSON.stringify(serverMeta[k] ?? null),
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
      for (const k of userKeys) mergedMeta[k] = attempted[k];
      try {
        const result = await updateItem(itemId.value!, {
          visibilityStatus: attemptedVisibility,
          metadata: mergedMeta as MetadataPayload,
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
async function forceSave(attemptedMeta: MetadataPayload, attemptedVisibility: VisibilityStatus) {
  saving.value = true;
  try {
    let expected = currentVersion.value;
    try {
      const hit = await getItem(itemId.value!);
      expected = Math.max(expected, hit.source.version ?? 0);
    } catch {
      // fall back to the last version we know
    }
    const payload = { visibilityStatus: attemptedVisibility, metadata: attemptedMeta };
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
  max-width: 1100px
  margin: 0 auto

.edit-card
  background: $surface
  border-radius: $radius
</style>
