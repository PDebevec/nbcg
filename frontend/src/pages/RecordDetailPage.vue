<template>
  <q-page>

    <!-- VIEWER — full-width band directly under the header -->
    <FileViewer
      v-if="loading || item"
      v-model="selectedFileId"
      :files="files"
      :loading="loading"
    >
      <template #overlay>
        <q-btn
          flat no-caps dense
          icon="arrow_back"
          :label="t('record.backToCatalog')"
          color="white"
          class="stage-back"
          @click="$router.back()"
        />
      </template>
    </FileViewer>

    <div class="page-body q-px-md q-py-lg">
      <div class="q-px-md">

        <!-- SKELETON while loading -->
        <template v-if="loading">
          <q-skeleton type="text" width="40%" class="q-mb-sm" />
          <q-skeleton type="text" width="80%" height="2.5rem" class="q-mb-sm" />
          <q-skeleton type="text" width="55%" />
        </template>

        <template v-else-if="item">

          <!-- ACTIONS -->
          <div class="row items-center q-gutter-sm q-mb-xl">
            <q-btn
              v-if="selectedFile"
              unelevated no-caps
              color="primary"
              icon="download"
              :label="t('record.download')"
              :href="downloadUrl(selectedFile)"
            />
            <q-btn
              outline no-caps
              color="primary"
              icon="share"
              :label="t('record.share')"
              @click="share"
            />
            <q-btn
              v-if="selectedFile && selectedFile.fileType !== 'UNKNOWN'"
              flat no-caps
              color="library-muted"
              icon="open_in_new"
              :label="t('record.openInNewTab')"
              :href="inlineUrl(selectedFile)"
              target="_blank"
            />
            <q-space />
            <div v-if="selectedFile" class="text-caption text-library-muted">
              {{ selectedFile.filename }} · {{ formatBytes(selectedFile.sizeBytes) }}
            </div>
          </div>

          <!-- TITLE BLOCK -->
          <div class="q-mb-lg">
            <div class="header-kicker q-mb-xs">{{ meta.materialType?.en }}</div>
            <h1 class="text-h4 text-weight-bold text-library-ink q-my-none q-mb-sm">
              {{ meta.title }}
            </h1>
            <div v-if="meta.subtitle" class="text-subtitle1 text-library-muted q-mb-xs">
              {{ meta.subtitle }}
            </div>
            <div v-if="meta.firstResponsibility" class="text-body1 text-library-muted q-mb-sm">
              {{ meta.firstResponsibility }}
            </div>
            <div class="row q-gutter-sm q-mt-sm">
              <q-badge v-if="meta.publicationDate1" outline color="primary">
                {{ meta.publicationDate1 }}
              </q-badge>
              <q-badge
                v-for="lang in meta.language"
                :key="lang.code"
                outline color="primary"
              >
                {{ lang.en }}
              </q-badge>
              <q-badge v-if="meta.publication?.country" outline color="primary">
                {{ meta.publication.country }}
              </q-badge>
            </div>
          </div>

          <!-- METADATA TABS -->
          <q-tabs
            v-model="metaTab"
            dense no-caps
            align="left"
            class="meta-tabs text-library-muted"
            active-color="primary"
            indicator-color="primary"
          >
            <q-tab name="main" :label="t('record.tabs.main')" />
            <q-tab name="all" :label="t('record.tabs.all')" />
          </q-tabs>
          <q-separator class="q-mb-md" />

          <q-tab-panels v-model="metaTab" animated class="bg-transparent">

            <!-- MAIN METADATA -->
            <q-tab-panel name="main" class="q-pa-none">
              <p v-if="meta.summaryNote" class="text-body2 text-library-muted q-mb-md meta-list">
                {{ meta.summaryNote }}
              </p>
              <q-list dense separator class="meta-list">
                <detail-row v-if="meta.title" :label="t('record.fields.title')" :value="meta.title" />
                <detail-row v-if="meta.subtitle" :label="t('record.fields.subtitle')" :value="meta.subtitle" />
                <detail-row v-if="meta.firstResponsibility" :label="t('record.fields.responsibility')" :value="meta.firstResponsibility" />
                <detail-row v-if="authorsLine" :label="t('record.authors')" :value="authorsLine" />
                <detail-row v-if="meta.publicationDate1" :label="t('record.fields.year')" :value="meta.publicationDate1" />
                <detail-row v-if="meta.publication?.publisher" :label="t('record.fields.publisher')" :value="meta.publication.publisher" />
                <detail-row v-if="meta.publication?.place" :label="t('record.fields.place')" :value="meta.publication.place" />
                <detail-row v-if="languagesLine" :label="t('record.fields.language')" :value="languagesLine" />
                <detail-row v-if="meta.materialType?.en" :label="t('record.fields.materialType')" :value="meta.materialType.en" />
                <detail-row v-if="meta.physicalDescription?.extent" :label="t('record.fields.extent')" :value="meta.physicalDescription.extent" />
              </q-list>
            </q-tab-panel>

            <!-- ALL METADATA -->
            <q-tab-panel name="all" class="q-pa-none">

              <div v-if="meta.summaryNote" class="q-mb-lg meta-list">
                <div class="section-label q-mb-sm">{{ t('record.abstract') }}</div>
                <p class="text-body2 text-library-muted q-ma-none">{{ meta.summaryNote }}</p>
              </div>

              <div class="section-label q-mb-sm">{{ t('record.bibliographic') }}</div>
              <q-list dense separator class="meta-list q-mb-lg">
                <detail-row v-if="meta.title" :label="t('record.fields.title')" :value="meta.title" />
                <detail-row v-if="meta.subtitle" :label="t('record.fields.subtitle')" :value="meta.subtitle" />
                <detail-row v-if="meta.parallelTitle" :label="t('record.fields.parallelTitle')" :value="meta.parallelTitle" />
                <detail-row v-if="meta.firstResponsibility" :label="t('record.fields.responsibility')" :value="meta.firstResponsibility" />
                <detail-row v-if="meta.subsequentResponsibility" :label="t('record.fields.addResponsibility')" :value="meta.subsequentResponsibility" />
                <detail-row v-if="meta.edition" :label="t('record.fields.edition')" :value="meta.edition" />
                <detail-row v-if="meta.publication?.publisher" :label="t('record.fields.publisher')" :value="meta.publication.publisher" />
                <detail-row v-if="meta.publication?.place" :label="t('record.fields.place')" :value="meta.publication.place" />
                <detail-row v-if="meta.publicationDate1" :label="t('record.fields.year')" :value="meta.publicationDate1" />
                <detail-row v-if="languagesLine" :label="t('record.fields.language')" :value="languagesLine" />
                <detail-row v-if="meta.physicalDescription?.extent" :label="t('record.fields.extent')" :value="meta.physicalDescription.extent" />
                <detail-row v-if="meta.physicalDescription?.dimensions" :label="t('record.fields.dimensions')" :value="meta.physicalDescription.dimensions" />
                <detail-row v-if="meta.isbn?.length" :label="t('record.fields.isbn')" :value="meta.isbn.join(', ')" />
                <detail-row v-if="meta.issn?.length" :label="t('record.fields.issn')" :value="meta.issn.join(', ')" />
                <detail-row v-if="meta.cobissId" :label="t('record.fields.cobissId')" :value="meta.cobissId" />
              </q-list>

              <div v-if="meta.authors?.length" class="q-mb-lg">
                <div class="section-label q-mb-sm">{{ t('record.authors') }}</div>
                <div class="row q-gutter-sm">
                  <q-chip
                    v-for="(author, i) in meta.authors"
                    :key="i"
                    icon="person"
                    color="primary"
                    text-color="white"
                    size="sm"
                  >
                    {{ [author.familyName, author.firstName].filter(Boolean).join(', ') }}
                    <span v-if="author.role?.en" class="q-ml-xs" style="opacity:0.75">({{ author.role.en }})</span>
                  </q-chip>
                </div>
              </div>

              <div v-if="meta.notes?.length" class="q-mb-lg meta-list">
                <div class="section-label q-mb-sm">{{ t('record.notes') }}</div>
                <ul class="q-ma-none q-pl-md">
                  <li v-for="(note, i) in meta.notes" :key="i" class="text-body2 text-library-muted">{{ note }}</li>
                </ul>
              </div>

              <div v-if="meta.seriesTitle" class="q-mb-lg">
                <div class="section-label q-mb-sm">{{ t('record.series') }}</div>
                <q-list dense class="meta-list">
                  <detail-row :label="t('record.fields.seriesTitle')" :value="meta.seriesTitle" />
                  <detail-row v-if="meta.seriesIssn" :label="t('record.fields.seriesIssn')" :value="meta.seriesIssn" />
                  <detail-row v-if="meta.seriesVolume" :label="t('record.fields.volume')" :value="meta.seriesVolume" />
                </q-list>
              </div>

              <div class="q-mb-lg">
                <div class="section-label q-mb-sm">{{ t('record.classification') }}</div>
                <q-list dense separator class="meta-list">
                  <detail-row v-if="meta.materialType?.en" :label="t('record.fields.materialType')" :value="meta.materialType.en" />
                  <detail-row v-if="meta.bibliographicLevel?.en" :label="t('record.fields.bibLevel')" :value="meta.bibliographicLevel.en" />
                  <detail-row v-if="meta.documentTypology" :label="t('record.fields.docTypology')" :value="meta.documentTypology" />
                </q-list>

                <div v-if="meta.udc?.length" class="q-mt-sm">
                  <div class="field-label q-mb-xs">{{ t('record.udc') }}</div>
                  <div class="row q-gutter-xs">
                    <q-chip v-for="u in meta.udc" :key="u" dense outline color="library-muted" size="sm">{{ u }}</q-chip>
                  </div>
                </div>

                <div v-if="meta.subjects?.length" class="q-mt-sm">
                  <div class="field-label q-mb-xs">{{ t('record.subjects') }}</div>
                  <div class="row q-gutter-xs">
                    <q-chip v-for="s in meta.subjects" :key="s" dense outline color="primary" size="sm">{{ s }}</q-chip>
                  </div>
                </div>

                <div v-if="meta.keywords?.length" class="q-mt-sm">
                  <div class="field-label q-mb-xs">{{ t('record.keywords') }}</div>
                  <div class="row q-gutter-xs">
                    <q-chip v-for="k in meta.keywords" :key="k" dense outline color="secondary" size="sm">{{ k }}</q-chip>
                  </div>
                </div>
              </div>

              <div v-if="files.length" class="q-mb-lg">
                <div class="section-label q-mb-sm">{{ t('record.attachments') }}</div>
                <q-list dense separator class="meta-list">
                  <q-item
                    v-for="file in files"
                    :key="file.id"
                    dense
                    clickable
                    :active="file.id === selectedFile?.id"
                    active-class="text-primary"
                    @click="selectedFileId = file.id"
                  >
                    <q-item-section avatar>
                      <q-icon
                        :name="fileIcon(file)"
                        :color="file.fileType === 'PDF' ? 'negative' : 'library-muted'"
                        size="sm"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-caption">{{ file.filename }}</q-item-label>
                      <q-item-label caption>{{ formatBytes(file.sizeBytes) }}</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-btn
                        flat dense round
                        icon="download"
                        size="sm"
                        color="library-muted"
                        :href="downloadUrl(file)"
                        @click.stop
                      />
                    </q-item-section>
                  </q-item>
                </q-list>
              </div>

            </q-tab-panel>
          </q-tab-panels>

          <!-- RELATED COLLECTIONS — placeholder until collections exist -->
          <section class="q-mt-xl">
            <div class="section-label q-mb-sm">{{ t('record.relatedCollections') }}</div>
            <div class="collections-placeholder column items-center justify-center text-center q-pa-lg">
              <q-icon name="collections_bookmark" size="32px" color="library-muted" class="q-mb-sm" />
              <div class="text-body2 text-library-muted">{{ t('record.noCollections') }}</div>
            </div>
          </section>
        </template>

        <template v-else>
          <q-btn
            flat no-caps dense
            icon="arrow_back"
            :label="t('record.backToCatalog')"
            color="primary"
            class="q-mb-md"
            @click="$router.back()"
          />
          <div class="text-body1 text-library-muted">{{ t('record.notFound') }}</div>
        </template>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuasar, copyToClipboard } from 'quasar';
import { getItem, type SearchHit, type RecordMetadata, type FileAttachment } from 'src/api/search';
import { inlineUrl, downloadUrl, fileIcon, formatBytes } from 'src/utils/fileAttachments';
import FileViewer from 'src/components/FileViewer.vue';

const { t } = useI18n();
const $q = useQuasar();

// ---------------------------------------------------------------------------
// Inline helper component to keep template DRY
// ---------------------------------------------------------------------------
const DetailRow = defineComponent({
  props: { label: String, value: String },
  setup(props) {
    return () =>
      h('div', { class: 'row q-py-xs' }, [
        h('div', { class: 'col-5 text-caption text-library-muted field-label' }, props.label),
        h('div', { class: 'col text-body2 text-library-ink' }, props.value),
      ]);
  },
});

// ---------------------------------------------------------------------------

const route = useRoute();
const item = ref<SearchHit | null>(null);
const loading = ref(true);

const meta = computed<RecordMetadata>(() => item.value?.source.metadata as RecordMetadata ?? ({} as RecordMetadata));

const metaTab = ref<'main' | 'all'>('main');

const authorsLine = computed(() =>
  meta.value.authors
    ?.map((a) => [a.familyName, a.firstName].filter(Boolean).join(', '))
    .join('; ') ?? '',
);

const languagesLine = computed(() => meta.value.language?.map((l) => l.en).join(', ') ?? '');

const files = computed<FileAttachment[]>(() => item.value?.source.file_attachments ?? []);

const selectedFileId = ref<string | null>(null);
const selectedFile = computed<FileAttachment | null>(
  () => files.value.find((f) => f.id === selectedFileId.value) ?? null,
);

async function share() {
  const url = window.location.href;
  const title = meta.value.title ?? document.title;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch {
      // User dismissed the share sheet — fall through to clipboard
    }
  }
  await copyToClipboard(url);
  $q.notify({ message: t('record.linkCopied'), icon: 'link', color: 'primary' });
}

onMounted(async () => {
  const id = route.params.id as string;
  try {
    item.value = await getItem(id);
    // Default to the first previewable file, else the first file
    const previewable = files.value.find((f) => f.fileType === 'IMAGE' || f.fileType === 'PDF');
    selectedFileId.value = (previewable ?? files.value[0])?.id ?? null;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped lang="sass">
.page-body
  max-width: 1280px
  margin: 0 auto

// Overlaid on the FileViewer stage via its #overlay slot
.stage-back
  position: absolute
  top: 12px
  left: 12px
  z-index: 2
  background: #000
  border-radius: 6px

.header-kicker
  font-size: 0.72rem
  font-weight: 700
  letter-spacing: 0.14em
  text-transform: uppercase
  color: $muted

.meta-list
  max-width: 760px

// The sliding-indicator animation leaves a stale transform behind when the
// layout shifts mid-transition (animated tab panels) — pin it in place instead
.meta-tabs :deep(.q-tab__indicator)
  transform: none !important
  transition: none !important

.section-label
  font-size: 0.72rem
  font-weight: 700
  letter-spacing: 0.1em
  text-transform: uppercase
  color: $muted

.field-label
  font-size: 0.75rem
  color: $muted
  font-weight: 500

.collections-placeholder
  border: 1px dashed $divider
  border-radius: $radius
  background: $surface
  min-height: 120px
</style>
