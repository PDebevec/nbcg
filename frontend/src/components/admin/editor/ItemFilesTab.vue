<template>
  <div class="files-tab">
    <div class="files-head">
      <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.edit.filesTitle') }}</h2>
      <span class="text-caption adm-muted">{{ summary }}</span>
    </div>

    <!-- Dropping or choosing files uploads them straight away -->
    <q-file
      :model-value="null"
      multiple
      borderless
      :loading="uploading"
      :disable="uploading"
      class="drop-zone"
      @update:model-value="onPick"
    >
      <!-- The text sits in the prepend slot (a q-field label is clipped to the native input's
           width); the invisible file input is stretched over the whole box below it, so a click or
           a drop anywhere in the box reaches it. -->
      <template #prepend>
        <q-icon name="o_upload" color="primary" size="20px" />
        <span class="drop-zone__label">
          {{ t('admin.edit.dropFiles') }}
          <span class="drop-zone__choose">{{ t('admin.edit.chooseFiles') }}</span>
        </span>
      </template>
    </q-file>

    <q-list v-if="files.length" bordered separator class="files-list">
      <q-item v-for="file in files" :key="file.id" class="files-list__row">
        <q-item-section avatar>
          <q-avatar square size="36px" :class="`file-tile file-tile--${file.fileType}`">
            <q-icon :name="fileIcon(file)" size="18px" />
          </q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label class="text-weight-bold ellipsis">{{ file.filename }}</q-item-label>
          <q-item-label caption>
            {{ formatFileSize(file.sizeBytes) }} · {{ file.mimeType }} ·
            {{ t('admin.edit.uploadedOn', { date: formatDate(file.createdAt, locale) }) }}
          </q-item-label>
        </q-item-section>
        <q-item-section v-if="file.fileType === 'PDF'" side>
          <q-badge class="badge-soft" :class="`badge-soft--${extractionTone(file.textExtractionStatus)}`">
            <q-icon :name="extractionIcon(file.textExtractionStatus)" size="13px" />
            {{ t(`admin.extractionShort.${file.textExtractionStatus}`) }}
            <q-tooltip>{{ t(`admin.extraction.${file.textExtractionStatus}`) }}</q-tooltip>
          </q-badge>
        </q-item-section>
        <q-item-section side>
          <div class="row no-wrap">
            <q-btn
              flat
              dense
              round
              icon="o_download"
              color="primary"
              :aria-label="t('admin.edit.download')"
              @click="downloadFile(file.id, file.filename)"
            />
            <q-btn
              flat
              dense
              round
              icon="o_delete"
              color="negative"
              :aria-label="t('admin.common.delete')"
              @click="onDelete(file)"
            />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
    <div v-else class="adm-empty">{{ t('admin.edit.noFiles') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { deleteFile, downloadFile, listFiles, uploadFiles } from 'src/api/admin';
import { apiErrorMessage } from 'src/api/errors';
import type { FileAttachment, TextExtractionStatus } from 'src/api/search';
import { formatDate, formatFileSize } from 'src/utils/adminFormat';

// The editor's Files tab: upload by dropping or choosing, then one row per
// file with its size, type, PDF text-extraction state, download and delete.
// File writes are separate requests from the metadata save — they take effect
// at once and do not touch the form.

const props = defineProps<{ itemId: string }>();

const files = defineModel<FileAttachment[]>('files', { required: true });

const emit = defineEmits<{
  /** A file was added or removed — the item's history has a new row. */
  (e: 'changed'): void;
}>();

const { t, locale } = useI18n();
const $q = useQuasar();

const uploading = ref(false);

const summary = computed(() =>
  t('admin.edit.filesSummary', {
    count: files.value.length,
    size: formatFileSize(files.value.reduce((sum, file) => sum + file.sizeBytes, 0)),
  }),
);

function fileIcon(file: FileAttachment): string {
  if (file.fileType === 'PDF') return 'o_picture_as_pdf';
  if (file.fileType === 'IMAGE') return 'o_image';
  return 'o_insert_drive_file';
}

function extractionTone(status: TextExtractionStatus): string {
  if (status === 'EXTRACTED') return 'positive';
  if (status === 'NOT_EXTRACTED') return 'muted';
  return 'warning';
}

function extractionIcon(status: TextExtractionStatus): string {
  if (status === 'EXTRACTED') return 'o_check';
  if (status === 'NOT_EXTRACTED') return 'o_schedule';
  return 'o_warning_amber';
}

async function onPick(picked: File[] | File | null) {
  const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (list.length === 0) return;
  uploading.value = true;
  try {
    await uploadFiles(props.itemId, list);
    files.value = await listFiles(props.itemId);
    $q.notify({ type: 'positive', message: t('admin.edit.uploaded') });
    emit('changed');
  } catch (err) {
    $q.notify({ type: 'negative', message: apiErrorMessage(err) ?? t('admin.common.actionFailed') });
  } finally {
    uploading.value = false;
  }
}

function onDelete(file: FileAttachment) {
  $q.dialog({
    title: t('admin.common.confirmTitle'),
    message: t('admin.edit.deleteFileConfirm', { name: file.filename }),
    cancel: { flat: true, noCaps: true, color: 'primary', label: t('admin.common.cancel') },
    ok: { unelevated: true, noCaps: true, color: 'negative', label: t('admin.common.delete') },
  }).onOk(() => {
    void (async () => {
      try {
        await deleteFile(file.id);
        files.value = files.value.filter((f) => f.id !== file.id);
        $q.notify({ type: 'positive', message: t('admin.edit.fileDeleted') });
        emit('changed');
      } catch (err) {
        $q.notify({
          type: 'negative',
          message: apiErrorMessage(err) ?? t('admin.common.actionFailed'),
        });
      }
    })();
  });
}
</script>

<style scoped lang="sass">
.files-tab
  display: flex
  flex-direction: column
  gap: 16px

.files-head
  display: flex
  align-items: center
  gap: 12px

.drop-zone
  border: 1.5px dashed $field-border
  border-radius: $radius
  background: #FBF8F1
  padding: 8px 16px
  cursor: pointer
  &:hover
    border-color: $primary
  :deep(.q-field__control)
    position: relative
    min-height: 56px

  :deep(.q-field__prepend)
    gap: 10px
    pointer-events: none

  // QFile opens the picker through its native <input type="file">, which only
  // covers the (otherwise tiny) native box: stretch that box over the control.
  :deep(.q-field__native)
    position: absolute
    inset: 0

  :deep(.q-file__dnd)
    border-radius: $radius
    outline-offset: -4px

.drop-zone__label
  font-size: 14px
  color: $ink-soft

.drop-zone__choose
  margin-left: 4px
  color: $primary
  font-weight: 600
  text-decoration: underline

.files-list
  border-color: $divider
  border-radius: $radius

.files-list__row
  padding: 12px 16px

.file-tile
  border-radius: $radius
  background: $soft-muted
  color: $soft-muted-ink

.file-tile--PDF
  background: $soft-negative
  color: $negative

.file-tile--IMAGE
  background: $soft-positive
  color: $soft-positive-ink
</style>
