<template>
  <q-page>
    <!-- HEADER -->
    <div class="record-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="q-px-md">
          <q-btn
            flat no-caps dense
            icon="arrow_back"
            label="Back to catalog"
            color="white"
            class="q-mb-md"
            @click="$router.back()"
          />

          <div v-if="item" class="row q-col-gutter-lg items-start">
            <!-- COVER -->
            <div class="col-auto">
              <q-img
                :src="coverUrl"
                style="width: 130px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4)"
                :ratio="2/3"
              />
            </div>
            <!-- TITLE BLOCK -->
            <div class="col">
              <div class="header-kicker q-mb-xs">{{ item.source.metadata.materialType?.en }}</div>
              <h1 class="text-h4 text-weight-bold text-white q-my-none q-mb-sm">
                {{ item.source.metadata.title }}
              </h1>
              <div v-if="item.source.metadata.subtitle" class="text-subtitle1 text-white q-mb-xs" style="opacity:0.8">
                {{ item.source.metadata.subtitle }}
              </div>
              <div v-if="item.source.metadata.firstResponsibility" class="text-body1 text-white q-mb-sm" style="opacity:0.75">
                {{ item.source.metadata.firstResponsibility }}
              </div>
              <div class="row q-gutter-sm q-mt-sm">
                <q-badge v-if="item.source.metadata.publicationDate1" outline color="white" text-color="white">
                  {{ item.source.metadata.publicationDate1 }}
                </q-badge>
                <q-badge
                  v-for="lang in item.source.metadata.language"
                  :key="lang.code"
                  outline color="white" text-color="white"
                >
                  {{ lang.en }}
                </q-badge>
                <q-badge v-if="item.source.metadata.publication?.country" outline color="white" text-color="white">
                  {{ item.source.metadata.publication.country }}
                </q-badge>
              </div>
            </div>
          </div>

          <!-- SKELETON while loading -->
          <div v-else-if="loading" class="row q-col-gutter-lg items-start">
            <div class="col-auto">
              <q-skeleton width="130px" height="195px" style="border-radius:8px" />
            </div>
            <div class="col">
              <q-skeleton type="text" width="40%" class="q-mb-sm" />
              <q-skeleton type="text" width="80%" height="2.5rem" class="q-mb-sm" />
              <q-skeleton type="text" width="55%" />
            </div>
          </div>

          <div v-else class="text-white text-body1">Item not found.</div>
        </div>
      </div>
    </div>

    <!-- BODY -->
    <div class="page-body q-px-md q-py-lg">
      <div class="q-px-md">

        <div v-if="loading" class="row q-col-gutter-lg">
          <div class="col-12 col-md-8">
            <q-skeleton height="300px" class="rounded-borders" />
          </div>
        </div>

        <div v-else-if="item" class="row q-col-gutter-lg">

          <!-- MAIN DETAILS -->
          <div class="col-12 col-md-8">

            <!-- Summary / Abstract -->
            <q-card v-if="meta.summaryNote" flat bordered class="detail-card q-mb-md">
              <q-card-section>
                <div class="section-label q-mb-sm">Abstract / Summary</div>
                <p class="text-body2 text-library-ink q-ma-none">{{ meta.summaryNote }}</p>
              </q-card-section>
            </q-card>

            <!-- Bibliographic details -->
            <q-card flat bordered class="detail-card q-mb-md">
              <q-card-section>
                <div class="section-label q-mb-sm">Bibliographic details</div>
                <q-list dense separator>
                  <detail-row v-if="meta.title" label="Title" :value="meta.title" />
                  <detail-row v-if="meta.subtitle" label="Subtitle" :value="meta.subtitle" />
                  <detail-row v-if="meta.parallelTitle" label="Parallel title" :value="meta.parallelTitle" />
                  <detail-row v-if="meta.firstResponsibility" label="Responsibility" :value="meta.firstResponsibility" />
                  <detail-row v-if="meta.subsequentResponsibility" label="Add. responsibility" :value="meta.subsequentResponsibility" />
                  <detail-row v-if="meta.edition" label="Edition" :value="meta.edition" />
                  <detail-row v-if="meta.publication?.publisher" label="Publisher" :value="meta.publication.publisher" />
                  <detail-row v-if="meta.publication?.place" label="Place" :value="meta.publication.place" />
                  <detail-row v-if="meta.publicationDate1" label="Year" :value="meta.publicationDate1" />
                  <detail-row v-if="meta.physicalDescription?.extent" label="Extent" :value="meta.physicalDescription.extent" />
                  <detail-row v-if="meta.physicalDescription?.dimensions" label="Dimensions" :value="meta.physicalDescription.dimensions" />
                  <detail-row v-if="meta.isbn?.length" label="ISBN" :value="meta.isbn.join(', ')" />
                  <detail-row v-if="meta.issn?.length" label="ISSN" :value="meta.issn.join(', ')" />
                  <detail-row v-if="meta.cobissId" label="COBISS ID" :value="meta.cobissId" />
                </q-list>
              </q-card-section>
            </q-card>

            <!-- Authors -->
            <q-card v-if="meta.authors?.length" flat bordered class="detail-card q-mb-md">
              <q-card-section>
                <div class="section-label q-mb-sm">Authors</div>
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
              </q-card-section>
            </q-card>

            <!-- Notes -->
            <q-card v-if="meta.notes?.length" flat bordered class="detail-card q-mb-md">
              <q-card-section>
                <div class="section-label q-mb-sm">Notes</div>
                <ul class="q-ma-none q-pl-md">
                  <li v-for="(note, i) in meta.notes" :key="i" class="text-body2 text-library-ink">{{ note }}</li>
                </ul>
              </q-card-section>
            </q-card>

            <!-- Series -->
            <q-card v-if="meta.seriesTitle" flat bordered class="detail-card q-mb-md">
              <q-card-section>
                <div class="section-label q-mb-sm">Series</div>
                <q-list dense>
                  <detail-row label="Series title" :value="meta.seriesTitle" />
                  <detail-row v-if="meta.seriesIssn" label="Series ISSN" :value="meta.seriesIssn" />
                  <detail-row v-if="meta.seriesVolume" label="Volume" :value="meta.seriesVolume" />
                </q-list>
              </q-card-section>
            </q-card>
          </div>

          <!-- SIDEBAR -->
          <div class="col-12 col-md-4">

            <!-- Cover image preview (larger) -->
            <q-card flat bordered class="detail-card q-mb-md">
              <q-img :src="coverUrl" :ratio="2/3" />
            </q-card>

            <!-- Classification -->
            <q-card flat bordered class="detail-card q-mb-md">
              <q-card-section>
                <div class="section-label q-mb-sm">Classification</div>
                <q-list dense separator>
                  <detail-row v-if="meta.materialType?.en" label="Material type" :value="meta.materialType.en" />
                  <detail-row v-if="meta.bibliographicLevel?.en" label="Bib. level" :value="meta.bibliographicLevel.en" />
                  <detail-row v-if="meta.documentTypology" label="Doc. typology" :value="meta.documentTypology" />
                </q-list>

                <div v-if="meta.udc?.length" class="q-mt-sm">
                  <div class="field-label q-mb-xs">UDC</div>
                  <div class="row q-gutter-xs">
                    <q-chip v-for="u in meta.udc" :key="u" dense outline color="grey-6" size="sm">{{ u }}</q-chip>
                  </div>
                </div>

                <div v-if="meta.subjects?.length" class="q-mt-sm">
                  <div class="field-label q-mb-xs">Subjects</div>
                  <div class="row q-gutter-xs">
                    <q-chip v-for="s in meta.subjects" :key="s" dense outline color="primary" size="sm">{{ s }}</q-chip>
                  </div>
                </div>

                <div v-if="meta.keywords?.length" class="q-mt-sm">
                  <div class="field-label q-mb-xs">Keywords</div>
                  <div class="row q-gutter-xs">
                    <q-chip v-for="k in meta.keywords" :key="k" dense outline color="secondary" size="sm">{{ k }}</q-chip>
                  </div>
                </div>
              </q-card-section>
            </q-card>

            <!-- Attachments -->
            <q-card v-if="item.source.file_attachments?.length" flat bordered class="detail-card q-mb-md">
              <q-card-section>
                <div class="section-label q-mb-sm">Attachments</div>
                <q-list dense separator>
                  <q-item
                    v-for="file in item.source.file_attachments"
                    :key="file.id"
                    dense
                    clickable
                    :href="`/api/files/${file.id}/download`"
                    target="_blank"
                  >
                    <q-item-section avatar>
                      <q-icon
                        :name="file.fileType === 'PDF' ? 'picture_as_pdf' : file.fileType === 'IMAGE' ? 'image' : 'attach_file'"
                        :color="file.fileType === 'PDF' ? 'negative' : 'grey-6'"
                        size="sm"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-caption">{{ file.filename }}</q-item-label>
                      <q-item-label caption>{{ formatBytes(file.sizeBytes) }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>

          </div>
        </div>

        <div v-else class="text-body1 text-library-muted">Item not found.</div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue';
import { useRoute } from 'vue-router';
import imageStock from 'src/assets/image-stock.jpg';
import { getItem, type SearchHit, type RecordMetadata } from 'src/api/search';

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

const coverUrl = computed(() => {
  const img = item.value?.source.file_attachments?.find((f) => f.fileType === 'IMAGE');
  return img ? `/api/files/${img.id}/download` : imageStock;
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

onMounted(async () => {
  const id = route.params.id as string;
  try {
    item.value = await getItem(id);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped lang="sass">
.record-header
  background: $primary
  min-height: 200px

.header-kicker
  font-size: 0.72rem
  font-weight: 700
  letter-spacing: 0.14em
  text-transform: uppercase
  color: rgba($paper, 0.6)

.page-body
  max-width: 1280px
  margin: 0 auto

.detail-card
  border-radius: 12px
  background: $paper
  border: 1px solid $divider

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
</style>
