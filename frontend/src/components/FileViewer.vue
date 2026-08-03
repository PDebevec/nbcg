<template>
  <div class="viewer-band">

    <div v-if="loading" class="viewer-stage flex flex-center">
      <q-spinner color="white" size="42px" />
    </div>

    <template v-else>
      <div ref="stageEl" class="viewer-stage">

        <!-- Page-provided overlay (e.g. a back button), positioned by the caller -->
        <slot name="overlay" />

        <img
          v-if="selectedFile?.fileType === 'IMAGE'"
          :src="inlineUrl(selectedFile)"
          :alt="selectedFile.filename"
          class="stage-img"
          :class="{ 'stage-img--panning': panning }"
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
          class="stage-pdf"
        />
        <div v-else class="column items-center justify-center text-center q-pa-xl stage-placeholder">
          <q-icon
            :name="selectedFile ? 'draft' : 'image_not_supported'"
            size="56px"
            class="q-mb-sm"
          />
          <div class="text-body2">
            {{ selectedFile ? t('record.noPreview') : t('record.noFiles') }}
          </div>
          <div v-if="selectedFile" class="text-caption q-mt-xs">{{ selectedFile.filename }}</div>
        </div>

        <!-- MINI TOOLBAR -->
        <div v-if="selectedFile && selectedFile.fileType !== 'UNKNOWN'" class="stage-toolbar row items-center no-wrap">
          <template v-if="selectedFile.fileType === 'IMAGE'">
            <q-btn flat round dense size="sm" color="white" icon="zoom_out" :disable="zoom <= MIN_ZOOM" @click="zoomOut">
              <q-tooltip>{{ t('record.zoomOut') }}</q-tooltip>
            </q-btn>
            <div class="zoom-label text-caption">{{ Math.round(zoom * 100) }}%</div>
            <q-btn flat round dense size="sm" color="white" icon="zoom_in" :disable="zoom >= MAX_ZOOM" @click="zoomIn">
              <q-tooltip>{{ t('record.zoomIn') }}</q-tooltip>
            </q-btn>
            <q-separator vertical dark class="q-mx-xs" />
            <q-btn flat round dense size="sm" color="white" icon="rotate_right" @click="rotate">
              <q-tooltip>{{ t('record.rotate') }}</q-tooltip>
            </q-btn>
            <q-separator vertical dark class="q-mx-xs" />
          </template>
          <q-btn
            flat round dense size="sm" color="white"
            :icon="isFullscreen ? 'fullscreen_exit' : 'fullscreen'"
            @click="toggleFullscreen"
          >
            <q-tooltip>{{ isFullscreen ? t('record.exitFullscreen') : t('record.fullscreen') }}</q-tooltip>
          </q-btn>
        </div>
      </div>

      <!-- File selector strip (only when there is more than one file) -->
      <div v-if="files.length > 1" class="file-strip row justify-center items-center q-gutter-xs q-pa-sm">
        <q-chip
          v-for="file in files"
          :key="file.id"
          clickable
          square
          size="sm"
          :icon="fileIcon(file)"
          :color="file.id === selectedFile?.id ? 'primary' : 'transparent'"
          :text-color="file.id === selectedFile?.id ? 'white' : 'grey-5'"
          @click="emit('update:modelValue', file.id)"
        >
          <span class="ellipsis file-chip-name">{{ file.filename }}</span>
        </q-chip>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileAttachment } from 'src/api/search';
import { inlineUrl, fileIcon } from 'src/utils/fileAttachments';

const props = withDefaults(defineProps<{
  files?: FileAttachment[];
  modelValue?: string | null;
  loading?: boolean;
}>(), {
  files: () => [],
  modelValue: null,
  loading: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void;
}>();

const { t } = useI18n();

const selectedFile = computed<FileAttachment | null>(
  () => props.files.find((f) => f.id === props.modelValue) ?? null,
);

// ---------------------------------------------------------------------------
// Zoom / rotate / pan / fullscreen
// ---------------------------------------------------------------------------

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
// Full-width black band under the app header
.viewer-band
  background: #000

.viewer-stage
  position: relative
  height: 520px
  padding-top: 8px
  display: flex
  align-items: center
  justify-content: center
  overflow: hidden
  background: #000

.stage-img
  max-width: 100%
  max-height: 100%
  object-fit: contain
  cursor: grab
  user-select: none
  touch-action: none
  transition: transform 0.15s ease

.stage-img--panning
  cursor: grabbing
  transition: none

.stage-pdf
  width: 100%
  height: 100%
  border: none

.stage-placeholder
  color: rgba(255, 255, 255, 0.55)

.stage-toolbar
  position: absolute
  bottom: 16px
  left: 50%
  transform: translateX(-50%)
  z-index: 2
  background: rgba(30, 30, 30, 0.78)
  backdrop-filter: blur(4px)
  border-radius: 24px
  padding: 4px 10px

.zoom-label
  min-width: 3.2em
  text-align: center
  color: rgba(255, 255, 255, 0.85)

.file-strip
  background: #000
  border-top: 1px solid rgba(255, 255, 255, 0.12)

.file-chip-name
  max-width: 180px

@media (max-width: 1023px)
  .viewer-stage
    height: 340px
</style>
