<template>
  <section class="viewer" :aria-label="t('record.viewer')">
    <!-- Toolbar: file name and size left, page controls right -->
    <div class="viewer__bar">
      <div class="viewer__file">
        <template v-if="selectedFile">
          <q-icon :name="fileIcon(selectedFile)" size="16px" :class="`viewer__file-icon--${selectedFile.fileType}`" />
          <span class="viewer__file-name ellipsis">{{ selectedFile.filename }}</span>
          <span class="viewer__file-size">{{ formatBytes(selectedFile.sizeBytes) }}</span>
        </template>
      </div>
      <div v-if="selectedFile && selectedFile.fileType !== 'UNKNOWN'" class="viewer__tools">
        <template v-if="selectedFile.fileType === 'IMAGE'">
          <q-btn flat round dense icon="o_zoom_out" :disable="zoom <= MIN_ZOOM" :aria-label="t('record.zoomOut')" @click="zoomOut" />
          <span class="viewer__zoom">{{ Math.round(zoom * 100) }}%</span>
          <q-btn flat round dense icon="o_zoom_in" :disable="zoom >= MAX_ZOOM" :aria-label="t('record.zoomIn')" @click="zoomIn" />
          <q-btn flat round dense icon="o_rotate_right" :aria-label="t('record.rotate')" @click="rotate" />
          <span class="viewer__sep" aria-hidden="true"></span>
        </template>
        <q-btn
          flat
          dense
          no-caps
          icon="o_open_in_new"
          :label="$q.screen.gt.xs ? t('record.openInNewTab') : undefined"
          :aria-label="t('record.openInNewTab')"
          :href="inlineUrl(selectedFile)"
          target="_blank"
          class="viewer__open"
        />
        <q-btn
          flat
          round
          dense
          :icon="isFullscreen ? 'o_fullscreen_exit' : 'o_fullscreen'"
          :aria-label="isFullscreen ? t('record.exitFullscreen') : t('record.fullscreen')"
          @click="toggleFullscreen"
        />
      </div>
    </div>

    <div class="viewer__body">
      <!-- File strip with thumbnails -->
      <div v-if="files.length > 1" class="viewer__strip" :aria-label="t('record.files')">
        <span class="viewer__strip-label">{{ t('record.filesCount', { count: files.length }) }}</span>
        <q-btn
          v-for="file in files"
          :key="file.id"
          flat
          no-caps
          padding="6px"
          class="viewer__thumb"
          :class="{ 'viewer__thumb--active': file.id === selectedFile?.id }"
          :aria-pressed="file.id === selectedFile?.id"
          @click="emit('update:modelValue', file.id)"
        >
          <span class="viewer__thumb-inner">
            <img v-if="file.fileType === 'IMAGE'" :src="inlineUrl(file)" alt="" loading="lazy" class="viewer__thumb-img" />
            <span v-else class="viewer__thumb-box"><q-icon :name="fileIcon(file)" size="26px" /></span>
            <span class="viewer__thumb-name">{{ file.filename }}</span>
          </span>
        </q-btn>
      </div>

      <!-- Stage -->
      <div ref="stageEl" class="viewer__stage">
        <q-spinner v-if="loading" color="white" size="42px" />
        <img
          v-else-if="selectedFile?.fileType === 'IMAGE'"
          :src="inlineUrl(selectedFile)"
          :alt="selectedFile.filename"
          class="viewer__img"
          :class="{ 'viewer__img--panning': panning }"
          :style="imgStyle"
          draggable="false"
          @pointerdown="startPan"
          @pointermove="movePan"
          @pointerup="endPan"
          @pointercancel="endPan"
          @dblclick="resetView"
        />
        <iframe
          v-else-if="selectedFile?.fileType === 'PDF'"
          :src="inlineUrl(selectedFile)"
          :title="selectedFile.filename"
          class="viewer__pdf"
        />
        <div v-else class="viewer__empty">
          <q-icon :name="selectedFile ? 'o_draft' : 'o_image_not_supported'" size="48px" />
          <div>{{ selectedFile ? t('record.noPreview') : t('record.noFiles') }}</div>
          <div v-if="selectedFile" class="viewer__empty-name">{{ selectedFile.filename }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import type { FileAttachment } from 'src/api/search';
import { inlineUrl, fileIcon, formatBytes } from 'src/utils/fileAttachments';

// The record page's viewer (design canvas, Record board): a dark rounded box
// with one toolbar on top, a thumbnail strip on the left and the stage.

const props = withDefaults(
  defineProps<{
    files?: FileAttachment[];
    modelValue?: string | null;
    loading?: boolean;
  }>(),
  {
    files: () => [],
    modelValue: null,
    loading: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void;
}>();

const { t } = useI18n();
const $q = useQuasar();

const selectedFile = computed<FileAttachment | null>(() => props.files.find((f) => f.id === props.modelValue) ?? null);

// ── Zoom / rotate / pan / fullscreen ───────────────────────────────────────
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const zoom = ref(1);
const rotation = ref(0);
const panX = ref(0);
const panY = ref(0);
const panning = ref(false);
let panOrigin = { x: 0, y: 0, px: 0, py: 0 };

const imgStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value}) rotate(${rotation.value}deg)`,
}));

function zoomIn() {
  zoom.value = Math.min(MAX_ZOOM, zoom.value * 1.25);
}

function zoomOut() {
  zoom.value = Math.max(MIN_ZOOM, zoom.value / 1.25);
}

function rotate() {
  rotation.value = (rotation.value + 90) % 360;
}

function resetView() {
  zoom.value = 1;
  rotation.value = 0;
  panX.value = 0;
  panY.value = 0;
}

function startPan(e: PointerEvent) {
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  panning.value = true;
  panOrigin = { x: e.clientX, y: e.clientY, px: panX.value, py: panY.value };
}

function movePan(e: PointerEvent) {
  if (!panning.value) return;
  panX.value = panOrigin.px + (e.clientX - panOrigin.x);
  panY.value = panOrigin.py + (e.clientY - panOrigin.y);
}

function endPan() {
  panning.value = false;
}

// Every file gets a fresh view
watch(() => props.modelValue, resetView);

const stageEl = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);

function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void stageEl.value?.requestFullscreen();
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});
</script>

<style scoped lang="sass">
$stage: #1A1D2A
$bar: #23273A
$on-stage: #E1E4EE

.viewer
  display: flex
  flex-direction: column
  height: 640px
  border-radius: 10px
  overflow: hidden
  background: $stage
  color: $on-stage

@media (max-width: 1023px)
  .viewer
    height: 520px

@media (max-width: 599px)
  .viewer
    height: 420px

.viewer__bar
  display: flex
  align-items: center
  justify-content: space-between
  gap: 12px
  height: 48px
  flex-shrink: 0
  padding: 0 8px 0 16px
  background: $bar
  border-bottom: 1px solid rgba(white, 0.08)
  font-size: 13.5px

.viewer__file
  display: flex
  align-items: center
  gap: 10px
  min-width: 0

.viewer__file-icon--PDF
  color: #E08A5A
.viewer__file-icon--IMAGE
  color: #8FB3E0
.viewer__file-icon--UNKNOWN
  color: $on-navy-muted

.viewer__file-name
  font-weight: 600
  max-width: 320px

.viewer__file-size
  color: $on-navy-muted
  white-space: nowrap

.viewer__tools
  display: flex
  align-items: center
  gap: 2px
  flex-shrink: 0
  .q-btn
    color: $on-stage

.viewer__zoom
  min-width: 44px
  text-align: center

.viewer__sep
  width: 1px
  height: 22px
  margin: 0 8px
  background: rgba(white, 0.14)

.viewer__open
  font-size: 13.5px
  padding: 0 10px

.viewer__body
  display: flex
  flex-grow: 1
  min-height: 0

.viewer__strip
  width: 148px
  flex-shrink: 0
  display: flex
  flex-direction: column
  gap: 6px
  padding: 14px 12px
  background: rgba(black, 0.2)
  border-right: 1px solid rgba(white, 0.08)
  overflow-y: auto

.viewer__strip-label
  font-size: 11px
  font-weight: 700
  letter-spacing: 0.1em
  text-transform: uppercase
  color: $on-navy-muted
  margin-bottom: 4px

.viewer__thumb
  width: 100%
  border: 2px solid transparent
  border-radius: 6px
  color: $on-navy-strong
  opacity: 0.75
  &--active
    opacity: 1
    border-color: #E08A5A
    background: rgba(white, 0.06)
  :deep(.q-btn__content)
    width: 100%

.viewer__thumb-inner
  display: flex
  flex-direction: column
  gap: 6px
  width: 100%
  text-align: left

.viewer__thumb-img
  width: 100%
  aspect-ratio: 3 / 4
  object-fit: cover
  border-radius: 3px
  display: block
  background: rgba(white, 0.06)

.viewer__thumb-box
  width: 100%
  aspect-ratio: 3 / 4
  display: flex
  align-items: center
  justify-content: center
  border-radius: 3px
  background: rgba(white, 0.06)
  color: $on-navy-muted

.viewer__thumb-name
  font-size: 11.5px
  font-weight: 400
  line-height: 1.3
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis

@media (max-width: 699px)
  .viewer__body
    flex-direction: column
  .viewer__strip
    width: auto
    flex-direction: row
    align-items: center
    gap: 8px
    padding: 8px 12px
    border-right: none
    border-bottom: 1px solid rgba(white, 0.08)
    overflow-x: auto
  .viewer__strip-label
    margin: 0 4px 0 0
    white-space: nowrap
  .viewer__thumb
    width: 72px
    flex-shrink: 0
  .viewer__thumb-name
    display: none

.viewer__stage
  position: relative
  flex-grow: 1
  min-width: 0
  display: flex
  align-items: center
  justify-content: center
  padding: 20px
  overflow: hidden
  background: $stage
  &:fullscreen
    padding: 0

.viewer__img
  max-width: 100%
  max-height: 100%
  object-fit: contain
  box-shadow: 0 10px 40px rgba(black, 0.5)
  border-radius: 2px
  cursor: grab
  user-select: none
  touch-action: none
  transition: transform 0.15s ease
  &--panning
    cursor: grabbing
    transition: none

.viewer__pdf
  width: 100%
  height: 100%
  border: none
  background: white

.viewer__empty
  display: flex
  flex-direction: column
  align-items: center
  gap: 8px
  text-align: center
  color: rgba(white, 0.6)
  font-size: 14px

.viewer__empty-name
  font-size: 12.5px
  color: $on-navy-muted
</style>
