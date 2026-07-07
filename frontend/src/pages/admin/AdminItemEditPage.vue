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
                <q-input
                  v-model="form.firstResponsibility"
                  outlined
                  :label="t('admin.edit.fields.author')"
                />
              </div>

              <div class="col-12 col-md-4">
                <q-input v-model="form.publisher" outlined :label="t('admin.edit.fields.publisher')" />
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
            <div class="text-caption text-grey-7 q-mb-sm">{{ t('admin.edit.jsonHint') }}</div>
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
                    <q-badge
                      v-if="file.textExtracted"
                      color="positive"
                      :label="t('admin.edit.textExtracted')"
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
            <div v-else class="text-grey-7 q-pa-md text-center">{{ t('admin.edit.noFiles') }}</div>
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
import { getItem, type FileAttachment, type RecordMetadata } from 'src/api/search';
import {
  createItem,
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
});

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
  };
}

// Keep JSON tab and form in sync: entering the JSON tab renders the current
// state; leaving it (or saving from it) parses the text back.
function onTabChange(next: string | number) {
  if (next === 'json') {
    jsonText.value = JSON.stringify(formToMetadata(), null, 2);
  } else if (jsonText.value) {
    applyJson(false);
  }
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

onMounted(async () => {
  if (isNew.value) return;
  try {
    const hit = await getItem(itemId.value!);
    metadata = (hit.source.metadata as unknown as Record<string, unknown>) ?? {};
    visibilityStatus.value = hit.source.visibilityStatus;
    metadataToForm(metadata);
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
      await updateItem(itemId.value!, {
        visibilityStatus: visibilityStatus.value,
        metadata: meta,
      });
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
  background: white
  border-radius: 12px
</style>
