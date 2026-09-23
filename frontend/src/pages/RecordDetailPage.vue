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
            <div v-if="meta.materialType" class="header-kicker q-mb-xs">{{ codeLabel(meta.materialType) }}</div>
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
              <q-badge v-if="yearLine" outline color="primary">
                {{ yearLine }}
              </q-badge>
              <q-badge
                v-for="lang in meta.language"
                :key="lang.code"
                outline color="primary"
              >
                {{ codeLabel(lang) }}
              </q-badge>
              <q-badge
                v-for="c in meta.country"
                :key="c.code"
                outline color="primary"
              >
                {{ codeLabel(c) }}
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
              <q-list dense separator class="meta-list">
                <detail-row v-if="meta.title" :label="t('record.fields.title')" :value="meta.title" />
                <detail-row v-if="meta.subtitle" :label="t('record.fields.subtitle')" :value="meta.subtitle" />
                <detail-row v-if="meta.firstResponsibility" :label="t('record.fields.responsibility')" :value="meta.firstResponsibility" />
                <detail-row v-if="authorsLine" :label="t('record.authors')" :value="authorsLine" />
                <detail-row v-if="yearLine" :label="t('record.fields.year')" :value="yearLine" />
                <detail-row v-if="meta.publication?.publisher" :label="t('record.fields.publisher')" :value="meta.publication.publisher" />
                <detail-row v-if="meta.publication?.place" :label="t('record.fields.place')" :value="meta.publication.place" />
                <detail-row v-if="languagesLine" :label="t('record.fields.language')" :value="languagesLine" />
                <detail-row v-if="meta.materialType" :label="t('record.fields.materialType')" :value="codeLabel(meta.materialType)" />
                <detail-row v-if="meta.physicalDescription" :label="t('record.fields.extent')" :value="meta.physicalDescription" />
              </q-list>
            </q-tab-panel>

            <!-- ALL METADATA -->
            <q-tab-panel name="all" class="q-pa-none">

              <div class="section-label q-mb-sm">{{ t('record.bibliographic') }}</div>
              <q-list dense separator class="meta-list q-mb-lg">
                <detail-row v-if="meta.title" :label="t('record.fields.title')" :value="meta.title" />
                <detail-row v-if="meta.titleMediumDesignation" :label="t('record.fields.mediumDesignation')" :value="meta.titleMediumDesignation" />
                <detail-row v-if="meta.subtitle" :label="t('record.fields.subtitle')" :value="meta.subtitle" />
                <detail-row v-if="meta.parallelTitle?.length" :label="t('record.fields.parallelTitle')" :value="meta.parallelTitle.join(' = ')" />
                <detail-row v-if="meta.titleInOtherScript?.length" :label="t('record.fields.titleInOtherScript')" :value="meta.titleInOtherScript.join(' = ')" />
                <detail-row v-if="meta.titleByAnotherAuthor" :label="t('record.fields.titleByAnotherAuthor')" :value="meta.titleByAnotherAuthor" />
                <detail-row v-if="meta.firstResponsibility" :label="t('record.fields.responsibility')" :value="meta.firstResponsibility" />
                <detail-row v-if="meta.subsequentResponsibility?.length" :label="t('record.fields.addResponsibility')" :value="meta.subsequentResponsibility.join('; ')" />
                <detail-row v-if="meta.edition" :label="t('record.fields.edition')" :value="meta.edition" />
                <detail-row v-if="meta.publication?.publisher" :label="t('record.fields.publisher')" :value="meta.publication.publisher" />
                <detail-row v-if="meta.publication?.place" :label="t('record.fields.place')" :value="meta.publication.place" />
                <detail-row v-if="yearLine" :label="t('record.fields.year')" :value="yearLine" />
                <detail-row v-if="meta.publicationDate2" :label="t('record.fields.publicationDate2')" :value="meta.publicationDate2" />
                <detail-row v-if="meta.publication?.placeOfManufacture" :label="t('record.fields.placeOfManufacture')" :value="meta.publication.placeOfManufacture" />
                <detail-row v-if="meta.publication?.manufacturerName" :label="t('record.fields.manufacturer')" :value="meta.publication.manufacturerName" />
                <detail-row v-if="languagesLine" :label="t('record.fields.language')" :value="languagesLine" />
                <detail-row v-if="originalLanguagesLine" :label="t('record.fields.originalLanguage')" :value="originalLanguagesLine" />
                <detail-row v-if="translationLanguagesLine" :label="t('record.fields.translationLanguages')" :value="translationLanguagesLine" />
                <detail-row v-if="countriesLine" :label="t('record.fields.country')" :value="countriesLine" />
                <detail-row v-if="meta.physicalDescription" :label="t('record.fields.extent')" :value="meta.physicalDescription" />
                <detail-row v-if="meta.otherPhysicalDetails" :label="t('record.fields.otherPhysicalDetails')" :value="meta.otherPhysicalDetails" />
                <detail-row v-if="meta.dimensions" :label="t('record.fields.dimensions')" :value="meta.dimensions" />
                <detail-row v-if="meta.cartographicMathematicalData" :label="t('record.fields.cartographic')" :value="meta.cartographicMathematicalData" />
                <detail-row v-if="meta.numberingAndDates" :label="t('record.fields.numbering')" :value="meta.numberingAndDates" />
                <detail-row v-if="meta.musicEditionStatement" :label="t('record.fields.musicEdition')" :value="meta.musicEditionStatement" />
                <detail-row v-if="meta.isbn?.length" :label="t('record.fields.isbn')" :value="meta.isbn.join(', ')" />
                <detail-row v-if="meta.issn?.length" :label="t('record.fields.issn')" :value="meta.issn.join(', ')" />
                <detail-row v-if="meta.ismn?.length" :label="t('record.fields.ismn')" :value="meta.ismn.join(', ')" />
                <detail-row v-if="meta.cobissId" :label="t('record.fields.cobissId')" :value="meta.cobissId" />
              </q-list>

              <div v-if="meta.authors?.length || meta.corporateBodies?.length" class="q-mb-lg">
                <div class="section-label q-mb-sm">{{ t('record.authors') }}</div>
                <div class="row q-gutter-sm">
                  <q-chip
                    v-for="(author, i) in meta.authors"
                    :key="'p' + i"
                    icon="person"
                    color="primary"
                    text-color="white"
                    size="sm"
                  >
                    {{ authorName(author) }}
                    <span v-if="author.role" class="q-ml-xs" style="opacity:0.75">({{ codeLabel(author.role) }})</span>
                  </q-chip>
                  <q-chip
                    v-for="(body, i) in meta.corporateBodies"
                    :key="'c' + i"
                    icon="business"
                    color="primary"
                    text-color="white"
                    size="sm"
                  >
                    {{ body.name }}
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
                  <detail-row v-if="meta.seriesSubtitle" :label="t('record.fields.seriesSubtitle')" :value="meta.seriesSubtitle" />
                  <detail-row v-if="meta.seriesResponsibility" :label="t('record.fields.seriesResponsibility')" :value="meta.seriesResponsibility" />
                  <detail-row v-if="meta.seriesIssn" :label="t('record.fields.seriesIssn')" :value="meta.seriesIssn" />
                  <detail-row v-if="meta.seriesVolume" :label="t('record.fields.volume')" :value="meta.seriesVolume" />
                </q-list>
              </div>

              <div class="q-mb-lg">
                <div class="section-label q-mb-sm">{{ t('record.classification') }}</div>
                <q-list dense separator class="meta-list">
                  <detail-row v-if="meta.materialType" :label="t('record.fields.materialType')" :value="codeLabel(meta.materialType)" />
                  <detail-row v-if="meta.recordType" :label="t('record.fields.recordType')" :value="codeLabel(meta.recordType)" />
                  <detail-row v-if="meta.bibliographicLevel" :label="t('record.fields.bibLevel')" :value="codeLabel(meta.bibliographicLevel)" />
                  <detail-row v-if="meta.documentTypology" :label="t('record.fields.docTypology')" :value="meta.documentTypology" />
                  <detail-row v-if="illustrationsLine" :label="t('record.fields.illustrations')" :value="illustrationsLine" />
                  <detail-row v-if="contentTypesLine" :label="t('record.fields.contentTypes')" :value="contentTypesLine" />
                  <detail-row v-if="meta.textualMaterialCodes?.literaryForm" :label="t('record.fields.literaryForm')" :value="codeLabel(meta.textualMaterialCodes.literaryForm)" />
                  <detail-row v-if="meta.textualMaterialCodes?.biographyCode" :label="t('record.fields.biography')" :value="codeLabel(meta.textualMaterialCodes.biographyCode)" />
                </q-list>
              </div>

              <div v-if="meta.electronicLocation?.length" class="q-mb-lg meta-list">
                <div class="section-label q-mb-sm">{{ t('record.links') }}</div>
                <ul class="q-ma-none q-pl-md">
                  <li v-for="(loc, i) in meta.electronicLocation" :key="i" class="text-body2">
                    <a :href="loc.url" target="_blank" rel="noopener" class="text-primary">{{ loc.url }}</a>
                  </li>
                </ul>
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
import {
  getItem,
  type Author,
  type ResolvedCode,
  type SearchHit,
  type RecordMetadata,
  type FileAttachment,
} from 'src/api/search';
import { inlineUrl, downloadUrl, fileIcon, formatBytes } from 'src/utils/fileAttachments';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import FileViewer from 'src/components/FileViewer.vue';

const { t } = useI18n();
const $q = useQuasar();
const { codeLabel } = useCodeLabel();

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

function authorName(a: Author): string {
  const family = [a.prefix, a.familyName].filter(Boolean).join(' ');
  const given = [a.firstName, a.romanNumerals].filter(Boolean).join(' ');
  const name = [family, given].filter(Boolean).join(', ');
  return a.dates ? `${name} (${a.dates})` : name;
}

const authorsLine = computed(() => meta.value.authors?.map(authorName).join('; ') ?? '');

const codesLine = (codes: ResolvedCode[] | undefined) => codes?.map(codeLabel).join(', ') ?? '';

const languagesLine = computed(() => codesLine(meta.value.language));
const originalLanguagesLine = computed(() => codesLine(meta.value.originalLanguage));
const translationLanguagesLine = computed(() => codesLine(meta.value.translationLanguages));
const countriesLine = computed(() => codesLine(meta.value.country));
const illustrationsLine = computed(() => codesLine(meta.value.textualMaterialCodes?.illustrationCodes));
const contentTypesLine = computed(() => codesLine(meta.value.textualMaterialCodes?.contentTypeCodes));

// 210/d is the year as printed; 100/c the coded one. Prefer the printed form.
const yearLine = computed(() => meta.value.publication?.year || meta.value.publicationDate1 || '');

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
