<template>
  <q-page>
    <div class="site-container rec">
      <!-- Breadcrumb + back -->
      <div class="rec__top">
        <nav class="rec__crumb" :aria-label="t('nav.breadcrumb')">
          <router-link to="/" class="rec__crumb-link">{{ t('nav.home') }}</router-link>
          <span aria-hidden="true">/</span>
          <router-link to="/catalog" class="rec__crumb-link">{{ t('nav.catalog') }}</router-link>
          <template v-if="meta.materialType">
            <span aria-hidden="true">/</span>
            <router-link :to="{ path: '/catalog', query: { materialType: meta.materialType.en } }" class="rec__crumb-link">
              {{ codeLabel(meta.materialType) }}
            </router-link>
          </template>
          <template v-if="meta.title">
            <span aria-hidden="true">/</span>
            <span class="rec__crumb-current">{{ meta.title }}</span>
          </template>
        </nav>
        <router-link to="/catalog" class="rec__back">
          <q-icon name="o_arrow_back" size="16px" />
          {{ t('record.backToResults') }}
        </router-link>
      </div>

      <!-- Loading skeleton -->
      <template v-if="loading">
        <div class="rec__head">
          <div class="rec__head-text">
            <q-skeleton type="text" width="140px" />
            <q-skeleton type="text" width="60%" height="44px" />
            <q-skeleton type="text" width="45%" />
          </div>
        </div>
        <q-skeleton height="640px" class="rec__skeleton-viewer" />
      </template>

      <!-- Not found -->
      <div v-else-if="!item" class="rec__missing">
        <q-icon name="o_search_off" size="40px" />
        <div class="rec__missing-title">{{ t('record.notFound') }}</div>
        <q-btn outline no-caps color="primary" icon="o_arrow_back" :label="t('record.backToCatalog')" to="/catalog" class="q-mt-md" />
      </div>

      <template v-else>
        <!-- TITLE BLOCK -->
        <div class="rec__head">
          <div class="rec__head-text">
            <div class="rec__kind">
              <q-badge v-if="meta.materialType" class="badge-soft rec__type" :class="`badge-soft--${materialTone(meta.materialType)}`">
                {{ codeLabel(meta.materialType) }}
              </q-badge>
              <span v-if="kindCaption" class="rec__kind-caption">{{ kindCaption }}</span>
            </div>
            <h1 class="rec__title">{{ meta.title }}</h1>
            <div v-if="subline" class="rec__subline">{{ subline }}</div>
            <div class="rec__facts">
              <span v-if="yearLine" class="rec__fact"><q-icon name="o_calendar_today" size="14px" />{{ yearLine }}</span>
              <span v-for="lang in meta.language" :key="lang.code" class="rec__fact">{{ codeLabel(lang) }}</span>
              <span v-for="c in meta.country" :key="c.code" class="rec__fact">{{ codeLabel(c) }}</span>
              <span v-if="physicalLine" class="rec__fact">{{ physicalLine }}</span>
              <span v-if="fullTextSearchable" class="rec__fact rec__fact--ok"><q-icon name="o_check" size="14px" />{{ t('record.fullTextSearchable') }}</span>
            </div>
          </div>
          <div class="rec__actions">
            <q-btn
              v-if="downloadFile"
              unelevated
              no-caps
              color="primary"
              icon="o_download"
              :label="t('record.downloadFile', { ext: fileExt(downloadFile), size: formatBytes(downloadFile.sizeBytes) })"
              :href="downloadUrl(downloadFile)"
              class="rec__action"
            />
            <q-btn outline no-caps color="primary" icon="o_link" :label="t('record.copyLink')" class="rec__action" @click="copyLink" />
          </div>
        </div>

        <!-- VIEWER -->
        <FileViewer v-model="selectedFileId" :files="files" />

        <!-- DETAILS + SIDEBAR -->
        <div class="rec__grid">
          <div class="rec__main">
            <section class="rec-card" :aria-labelledby="'about-h'">
              <div class="rec-card__head">
                <h2 id="about-h" class="rec-card__title">{{ t('record.about') }}</h2>
                <span class="rec-card__hint">{{ t('record.mainFields') }}</span>
              </div>
              <dl class="rec-dl">
                <template v-for="row in mainRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </template>
              </dl>
            </section>

            <section v-if="hasMore" class="rec-card rec-card--flush" :aria-label="t('record.allMetadata')">
              <q-expansion-item
                v-if="bibRows.length"
                expand-icon="o_expand_more"
                header-class="rec-exp__header"
                class="rec-exp"
              >
                <template #header>
                  <span class="rec-exp__label">{{ t('record.bibliographic') }} <span class="rec-exp__hint">· {{ t('record.moreFields', bibRows.length) }}</span></span>
                </template>
                <dl class="rec-dl rec-dl--inner">
                  <template v-for="row in bibRows" :key="row.label">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </template>
                </dl>
              </q-expansion-item>

              <q-expansion-item
                v-if="meta.notes?.length"
                default-opened
                expand-icon="o_expand_more"
                header-class="rec-exp__header"
                class="rec-exp"
              >
                <template #header>
                  <span class="rec-exp__label">{{ t('record.notes') }} <span class="rec-exp__hint">· {{ meta.notes.length }}</span></span>
                </template>
                <ul class="rec-notes">
                  <li v-for="(note, i) in meta.notes" :key="i">{{ note }}</li>
                </ul>
              </q-expansion-item>

              <q-expansion-item
                v-if="classRows.length"
                expand-icon="o_expand_more"
                header-class="rec-exp__header"
                class="rec-exp"
              >
                <template #header>
                  <span class="rec-exp__label">{{ t('record.classification') }} <span class="rec-exp__hint">· {{ t('record.classificationHint') }}</span></span>
                </template>
                <dl class="rec-dl rec-dl--inner">
                  <template v-for="row in classRows" :key="row.label">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </template>
                </dl>
              </q-expansion-item>

              <q-expansion-item
                v-if="idRows.length || meta.electronicLocation?.length"
                expand-icon="o_expand_more"
                header-class="rec-exp__header"
                class="rec-exp"
              >
                <template #header>
                  <span class="rec-exp__label">{{ t('record.identifiers') }} <span class="rec-exp__hint">· {{ identifiersHint }}</span></span>
                </template>
                <dl class="rec-dl rec-dl--inner">
                  <template v-for="row in idRows" :key="row.label">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </template>
                  <template v-for="(loc, i) in meta.electronicLocation" :key="loc.url">
                    <dt>{{ i === 0 ? t('record.links') : '' }}</dt>
                    <dd><a :href="loc.url" target="_blank" rel="noopener" class="rec-link">{{ loc.url }}</a></dd>
                  </template>
                </dl>
              </q-expansion-item>
            </section>

            <section class="rec-cite" :aria-labelledby="'cite-h'">
              <div class="rec-cite__head">
                <h2 id="cite-h" class="rec-card__title">{{ t('record.cite') }}</h2>
                <q-btn outline dense no-caps color="primary" icon="o_content_copy" :label="t('record.copy')" class="rec-cite__btn" @click="copyCitation" />
              </div>
              <p class="rec-cite__text">{{ citation }}</p>
            </section>
          </div>

          <aside class="rec__aside">
            <section v-if="files.length" class="rec-card rec-card--flush" :aria-labelledby="'files-h'">
              <div class="rec-card__head rec-card__head--sm"><h2 id="files-h" class="rec-card__title">{{ t('record.files') }}</h2></div>
              <a v-for="file in files" :key="file.id" :href="downloadUrl(file)" class="rec-file">
                <span class="rec-file__ext" :class="`rec-file__ext--${file.fileType}`">{{ fileExt(file) }}</span>
                <span class="rec-file__text">
                  <span class="rec-file__name">{{ file.filename }}</span>
                  <span class="rec-file__meta">{{ formatBytes(file.sizeBytes) }}<template v-if="file.textExtractionStatus === 'EXTRACTED'"> · {{ t('record.hasText') }}</template></span>
                </span>
                <q-icon name="o_download" size="18px" class="rec-file__icon" />
              </a>
            </section>

            <section v-if="parents.length" class="rec-card rec-card--flush" :aria-labelledby="'partof-h'">
              <div class="rec-card__head rec-card__head--sm"><h2 id="partof-h" class="rec-card__title">{{ t('record.partOf') }}</h2></div>
              <router-link v-for="parent in parents" :key="parent.id" :to="`/catalog/${parent.id}`" class="rec-parent">
                <span class="rec-parent__icon"><q-icon :name="materialIcon(parent.source.metadata.materialType)" size="20px" /></span>
                <span class="rec-file__text">
                  <span class="rec-file__name">{{ parent.source.metadata.title }}</span>
                  <span class="rec-file__meta">{{ parentCaption(parent) }}</span>
                </span>
                <q-icon name="o_chevron_right" size="16px" class="rec-parent__chevron" />
              </router-link>
            </section>

            <section class="rec-card rec-info" :aria-labelledby="'recinfo-h'">
              <h2 id="recinfo-h" class="rec-card__title">{{ t('record.recordCard') }}</h2>
              <div class="rec-info__row">
                <span class="rec-info__label">{{ t('record.permalink') }}</span>
                <a :href="permalink" class="rec-link rec-info__value">{{ permalinkShort }}</a>
              </div>
              <div v-if="meta.cobissId" class="rec-info__row">
                <span class="rec-info__label">{{ t('record.fields.cobissId') }}</span>
                <span class="rec-info__value">{{ meta.cobissId }}</span>
              </div>
              <div v-if="item.source.createdAt" class="rec-info__row">
                <span class="rec-info__label">{{ t('record.added') }}</span>
                <span class="rec-info__value">{{ formatDate(item.source.createdAt, locale) }}</span>
              </div>
              <div class="rec-info__row">
                <span class="rec-info__label">{{ t('record.rights') }}</span>
                <router-link to="/uslovi-koriscenja" class="rec-link rec-info__value">{{ t('record.rightsValue') }}</router-link>
              </div>
              <a :href="reportHref" class="rec-info__report">
                <q-icon name="o_flag" size="15px" />
                {{ t('record.report') }}
              </a>
            </section>
          </aside>
        </div>

        <!-- SIBLINGS: other issues of the same title -->
        <section v-if="siblings.length > 1" class="rec-more" :aria-labelledby="'more-h'">
          <div class="rec-more__head">
            <div>
              <div class="pub-eyebrow">{{ t('record.siblingsKicker') }}</div>
              <h2 id="more-h" class="rec-more__title">{{ t('record.siblingsTitle', { title: parentTitle }) }}</h2>
            </div>
            <router-link v-if="parents[0]" :to="`/catalog/${parents[0].id}`" class="rec-more__all">
              {{ t('record.allChildren', siblingsTotal) }}
              <q-icon name="o_arrow_forward" size="16px" />
            </router-link>
          </div>
          <div class="rec-more__grid">
            <component
              :is="hit.id === item.id ? 'span' : 'router-link'"
              v-for="hit in siblings"
              :key="hit.id"
              :to="hit.id === item.id ? undefined : `/catalog/${hit.id}`"
              class="rec-mini"
              :class="{ 'rec-mini--current': hit.id === item.id }"
              :aria-current="hit.id === item.id ? 'true' : undefined"
            >
              <span class="rec-mini__cover">
                <img v-if="coverUrl(hit)" :src="coverUrl(hit)" alt="" loading="lazy" />
                <q-icon v-else :name="materialIcon(hit.source.metadata.materialType)" size="20px" />
              </span>
              <span class="rec-mini__text">
                <span class="rec-mini__title">{{ issueLabel(hit) }}</span>
                <span class="rec-mini__meta">{{ issueDate(hit) }}<template v-if="hit.id === item.id"> · {{ t('record.thisIssue') }}</template></span>
              </span>
            </component>
          </div>
        </section>

        <!-- CHILDREN: items of this collection -->
        <section v-if="children.length" class="rec-more" :aria-labelledby="'children-h'">
          <div class="rec-more__head">
            <div>
              <div class="pub-eyebrow">{{ t('record.childrenKicker') }}</div>
              <h2 id="children-h" class="rec-more__title">{{ t('record.childrenTitle', childrenTotal) }}</h2>
            </div>
          </div>
          <div class="rec-more__grid">
            <router-link v-for="hit in children" :key="hit.id" :to="`/catalog/${hit.id}`" class="rec-mini">
              <span class="rec-mini__cover">
                <img v-if="coverUrl(hit)" :src="coverUrl(hit)" alt="" loading="lazy" />
                <q-icon v-else :name="materialIcon(hit.source.metadata.materialType)" size="20px" />
              </span>
              <span class="rec-mini__text">
                <span class="rec-mini__title">{{ issueLabel(hit) }}</span>
                <span class="rec-mini__meta">{{ issueDate(hit) || creatorLine(hit) }}</span>
              </span>
            </router-link>
          </div>
        </section>
      </template>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuasar, copyToClipboard } from 'quasar';
import {
  getItem,
  listChildren,
  type Author,
  type FileAttachment,
  type RecordMetadata,
  type ResolvedCode,
  type SearchHit,
} from 'src/api/search';
import { downloadUrl, formatBytes } from 'src/utils/fileAttachments';
import { formatDate } from 'src/utils/adminFormat';
import { coverUrl, creatorLine, materialIcon, materialTone } from 'src/utils/publicRecord';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { useExtentLabel } from 'src/composables/useExtentLabel';
import FileViewer from 'src/components/FileViewer.vue';

// The public record page (design canvas, Record board): title block first,
// the viewer, "About this item" as a label / value list with the rest folded
// into expanders, a sidebar with files, parents and record facts, and the
// other issues of the same title (or the items of this collection).

const route = useRoute();
const { t, locale } = useI18n();
const $q = useQuasar();
const { codeLabel } = useCodeLabel();
const { extentLabel } = useExtentLabel();

const item = ref<SearchHit | null>(null);
const loading = ref(true);
const parents = ref<SearchHit[]>([]);
const siblings = ref<SearchHit[]>([]);
const siblingsTotal = ref(0);
const children = ref<SearchHit[]>([]);
const childrenTotal = ref(0);

const meta = computed<RecordMetadata>(() => (item.value?.source.metadata as RecordMetadata) ?? ({} as RecordMetadata));
const files = computed<FileAttachment[]>(() => item.value?.source.file_attachments ?? []);

const selectedFileId = ref<string | null>(null);
const selectedFile = computed<FileAttachment | null>(() => files.value.find((f) => f.id === selectedFileId.value) ?? null);
/** The selected file, else the first PDF, else the first file */
const downloadFile = computed<FileAttachment | null>(
  () => selectedFile.value ?? files.value.find((f) => f.fileType === 'PDF') ?? files.value[0] ?? null,
);

const RELATED_FIELDS = [
  'metadata.title',
  'metadata.firstResponsibility',
  'metadata.publicationDate1',
  'metadata.materialType',
  'metadata.collectionType',
  'metadata.childrenInRecords',
  'metadata.issue',
  'metadata.publication.place',
  'metadata.publication.publisher',
  'file_attachments.id',
  'file_attachments.fileType',
].join(',');

async function load(id: string) {
  loading.value = true;
  item.value = null;
  parents.value = [];
  siblings.value = [];
  children.value = [];
  try {
    const hit = await getItem(id);
    item.value = hit;
    const previewable = files.value.find((f) => f.fileType === 'IMAGE' || f.fileType === 'PDF');
    selectedFileId.value = (previewable ?? files.value[0])?.id ?? null;
  } catch {
    item.value = null;
  } finally {
    loading.value = false;
  }
  if (!item.value) return;
  await Promise.all([loadParents(item.value), loadChildren(item.value)]);
}

// An item normally has one parent; each is one read. Siblings come from the first parent.
async function loadParents(hit: SearchHit) {
  const relations = hit.source.parent_relations ?? [];
  const loaded = await Promise.all(
    relations.map(async (relation) => {
      try {
        return await getItem(relation.parentId);
      } catch {
        return null;
      }
    }),
  );
  parents.value = loaded.filter((p): p is SearchHit => p !== null);
  const first = parents.value[0];
  if (!first) return;
  try {
    const result = await listChildren(first.id, { type: 'records', limit: 6, fields: RELATED_FIELDS });
    siblings.value = result.hits;
    siblingsTotal.value = result.total;
  } catch {
    siblings.value = [];
  }
}

async function loadChildren(hit: SearchHit) {
  if (!(hit.source.metadata.collectionType > 0)) return;
  try {
    const result = await listChildren(hit.id, { type: 'records', limit: 12, fields: RELATED_FIELDS });
    children.value = result.hits;
    childrenTotal.value = result.total;
  } catch {
    children.value = [];
  }
}

// The route keeps the same component between two records (same path pattern)
watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string') void load(id);
  },
  { immediate: true },
);

// ── Title block ────────────────────────────────────────────────────────────
const kindCaption = computed(() => {
  if (meta.value.issue) return t('record.kind.issue');
  if (meta.value.collectionType === 4) return t('record.kind.serial');
  if (meta.value.collectionType > 0) return t('record.kind.collection');
  return '';
});

// 210/d is the year as printed; 100/c the coded one. Prefer the printed form.
const yearLine = computed(() => meta.value.publication?.year || meta.value.publicationDate1 || '');

const subline = computed(() => {
  const parts: string[] = [];
  if (meta.value.subtitle) parts.push(meta.value.subtitle);
  const pub = [meta.value.publication?.place, meta.value.publication?.publisher].filter(Boolean).join(': ');
  const date = meta.value.issue?.date;
  if (pub || date) parts.push([pub, date].filter(Boolean).join(', '));
  return parts.join(' · ');
});

const physicalLine = computed(() => {
  const extent = extentLabel(meta.value.extent) || meta.value.physicalDescription || '';
  return [extent, meta.value.dimensions].filter(Boolean).join(' · ');
});

const fullTextSearchable = computed(() => files.value.some((f) => f.textExtractionStatus === 'EXTRACTED'));

function fileExt(file: FileAttachment): string {
  const ext = file.filename.split('.').pop() ?? '';
  return (ext.length <= 4 ? ext : file.fileType).toUpperCase();
}

// ── Metadata rows ──────────────────────────────────────────────────────────
interface Row {
  label: string;
  value: string;
}

function row(labelKey: string, value: string | undefined | null): Row | null {
  return value ? { label: t(labelKey), value } : null;
}

function rows(list: (Row | null)[]): Row[] {
  return list.filter((r): r is Row => r !== null);
}

function authorName(a: Author): string {
  const family = [a.prefix, a.familyName].filter(Boolean).join(' ');
  const given = [a.firstName, a.romanNumerals].filter(Boolean).join(' ');
  const name = [family, given].filter(Boolean).join(', ');
  const withRole = a.role ? `${name} (${codeLabel(a.role)})` : name;
  return a.dates ? `${withRole}, ${a.dates}` : withRole;
}

const codesLine = (codes: ResolvedCode[] | undefined) => codes?.map(codeLabel).join(', ') ?? '';

const issueLine = computed(() => {
  const issue = meta.value.issue;
  if (!issue) return '';
  const number = [issue.volume && `${t('record.volumeShort')} ${issue.volume}`, issue.number && `${t('record.numberShort')} ${issue.number}`]
    .filter(Boolean)
    .join(', ');
  return issue.date ? `${number} (${issue.date})` : number;
});

const mainRows = computed(() => {
  const m = meta.value;
  const publisher = [m.publication?.publisher, m.publication?.place].filter(Boolean).join(', ');
  return rows([
    row('record.fields.title', m.title),
    row('record.fields.subtitle', m.subtitle),
    row('record.fields.responsibility', m.firstResponsibility),
    row('record.authors', m.authors?.map(authorName).join('; ')),
    row('record.fields.publisher', publisher),
    row('record.fields.year', yearLine.value),
    row('record.fields.issue', issueLine.value),
    row('record.fields.numbering', m.numberingAndDates),
    row('record.fields.language', codesLine(m.language)),
    row('record.fields.country', codesLine(m.country)),
    row('record.fields.extent', extentLabel(m.extent) || m.physicalDescription),
    row('record.fields.issn', m.issn?.join(', ')),
    row('record.fields.isbn', m.isbn?.join(', ')),
  ]);
});

const bibRows = computed(() => {
  const m = meta.value;
  return rows([
    row('record.fields.mediumDesignation', m.titleMediumDesignation),
    row('record.fields.parallelTitle', m.parallelTitle?.join(' = ')),
    row('record.fields.titleInOtherScript', m.titleInOtherScript?.join(' = ')),
    row('record.fields.titleByAnotherAuthor', m.titleByAnotherAuthor),
    row('record.fields.addResponsibility', m.subsequentResponsibility?.join('; ')),
    row('record.fields.corporateBodies', m.corporateBodies?.map((b) => b.name).join('; ')),
    row('record.fields.edition', m.edition),
    row('record.fields.publicationDate2', m.publicationDate2),
    row('record.fields.placeOfManufacture', m.publication?.placeOfManufacture),
    row('record.fields.manufacturer', m.publication?.manufacturerName),
    row('record.fields.originalLanguage', codesLine(m.originalLanguage)),
    row('record.fields.translationLanguages', codesLine(m.translationLanguages)),
    row('record.fields.otherPhysicalDetails', m.otherPhysicalDetails),
    row('record.fields.dimensions', m.dimensions),
    row('record.fields.cartographic', m.cartographicMathematicalData),
    row('record.fields.musicEdition', m.musicEditionStatement),
    row('record.fields.seriesTitle', m.seriesTitle),
    row('record.fields.seriesSubtitle', m.seriesSubtitle),
    row('record.fields.seriesResponsibility', m.seriesResponsibility),
    row('record.fields.seriesIssn', m.seriesIssn),
    row('record.fields.volume', m.seriesVolume),
    row('record.fields.summary', m.summaryNote),
  ]);
});

const classRows = computed(() => {
  const m = meta.value;
  const codes = m.textualMaterialCodes;
  return rows([
    row('record.fields.materialType', m.materialType && codeLabel(m.materialType)),
    row('record.fields.recordType', m.recordType && codeLabel(m.recordType)),
    row('record.fields.bibLevel', m.bibliographicLevel && codeLabel(m.bibliographicLevel)),
    row('record.fields.docTypology', m.documentTypology),
    row('record.fields.illustrations', codesLine(codes?.illustrationCodes)),
    row('record.fields.contentTypes', codesLine(codes?.contentTypeCodes)),
    row('record.fields.literaryForm', codes?.literaryForm && codeLabel(codes.literaryForm)),
    row('record.fields.biography', codes?.biographyCode && codeLabel(codes.biographyCode)),
    row('record.fields.keywords', m.keywords?.join(', ')),
  ]);
});

const idRows = computed(() => {
  const m = meta.value;
  return rows([
    row('record.fields.isbn', m.isbn?.join(', ')),
    row('record.fields.issn', m.issn?.join(', ')),
    row('record.fields.ismn', m.ismn?.join(', ')),
    row('record.fields.cobissId', m.cobissId),
  ]);
});

const identifiersHint = computed(() => {
  const parts: string[] = [];
  if (meta.value.cobissId) parts.push(`COBISS ID ${meta.value.cobissId}`);
  const links = meta.value.electronicLocation?.length ?? 0;
  if (links) parts.push(t('record.linksCount', links));
  return parts.join(', ') || t('record.moreFields', idRows.value.length);
});

const hasMore = computed(
  () => bibRows.value.length > 0 || (meta.value.notes?.length ?? 0) > 0 || classRows.value.length > 0 || idRows.value.length > 0,
);

// ── Links, citation, sidebar ───────────────────────────────────────────────
const permalink = computed(() => `${window.location.origin}${window.location.pathname}#/catalog/${item.value?.id ?? ''}`);
const permalinkShort = computed(() => permalink.value.replace(/^https?:\/\//, '').replace('/#/', '/'));

async function copyLink() {
  await copyToClipboard(permalink.value);
  $q.notify({ message: t('record.linkCopied'), icon: 'o_link', color: 'primary' });
}

const citation = computed(() => {
  const m = meta.value;
  const pub = [m.publication?.place, m.publication?.publisher].filter(Boolean).join(': ');
  const when = m.issue?.date || yearLine.value;
  const head = [m.title, [pub, when].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const accessed = formatDate(new Date().toISOString(), locale.value);
  return `${head}. ${t('record.citeSource')}. ${permalinkShort.value}, ${t('record.citeAccessed', { date: accessed })}.`;
});

async function copyCitation() {
  await copyToClipboard(citation.value);
  $q.notify({ message: t('record.citationCopied'), icon: 'o_content_copy', color: 'primary' });
}

const reportHref = computed(() => {
  const subject = encodeURIComponent(`${t('record.reportSubject')}: ${meta.value.title ?? ''} (${item.value?.id ?? ''})`);
  return `mailto:info@dlib.me?subject=${subject}`;
});

function parentCaption(parent: SearchHit): string {
  const m = parent.source.metadata;
  const kind = m.collectionType === 4 ? t('record.kind.serial') : t('record.kind.collection');
  return `${kind} · ${t('index.records', m.childrenInRecords ?? 0)}`;
}

const parentTitle = computed(() => parents.value[0]?.source.metadata.title ?? '');

// ── Sibling / child cards ──────────────────────────────────────────────────
function issueLabel(hit: SearchHit): string {
  const issue = hit.source.metadata.issue;
  if (issue?.number) return `${t('record.numberShort')} ${issue.number}`;
  return hit.source.metadata.title;
}

function issueDate(hit: SearchHit): string {
  return hit.source.metadata.issue?.date || hit.source.metadata.publicationDate1 || '';
}
</script>

<style scoped lang="sass">
.rec
  padding: 20px 0 56px
  display: flex
  flex-direction: column
  gap: 24px

// ── Top row ────────────────────────────────────────────────────────────────
.rec__top
  display: flex
  align-items: center
  justify-content: space-between
  gap: 24px

.rec__crumb
  display: flex
  align-items: center
  gap: 8px
  font-size: 13.5px
  color: $muted
  min-width: 0

.rec__crumb-link
  color: $muted
  text-decoration: none
  white-space: nowrap
  &:hover
    color: $primary

.rec__crumb-current
  color: $ink
  font-weight: 600
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis

.rec__back
  display: inline-flex
  align-items: center
  gap: 6px
  flex-shrink: 0
  font-size: 14px
  font-weight: 600
  color: $primary
  text-decoration: none
  white-space: nowrap
  &:hover
    text-decoration: underline

// ── Title block ────────────────────────────────────────────────────────────
.rec__head
  display: flex
  align-items: flex-end
  justify-content: space-between
  gap: 32px
  flex-wrap: wrap

.rec__head-text
  display: flex
  flex-direction: column
  gap: 10px
  min-width: 0
  flex: 1 1 480px

.rec__kind
  display: flex
  align-items: center
  gap: 10px

.rec__type
  height: 24px
  padding: 0 10px
  text-transform: uppercase
  letter-spacing: 0.04em
  font-size: 12px
  font-weight: 700

.rec__kind-caption
  font-size: 13px
  color: $muted

.rec__title
  margin: 0
  font-family: $serif
  font-size: 36px
  font-weight: 600
  line-height: 1.15
  color: $ink
  overflow-wrap: anywhere

.rec__subline
  font-size: 17px
  color: #3A362E

.rec__facts
  display: flex
  align-items: center
  gap: 8px
  flex-wrap: wrap
  margin-top: 2px

.rec__fact
  display: inline-flex
  align-items: center
  gap: 6px
  height: 28px
  padding: 0 10px
  border-radius: 6px
  border: 1px solid $field-border
  font-size: 13px
  color: #3A362E
  &--ok
    border-color: transparent
    background: #DEE8DF
    color: #2F4F36
    font-weight: 600

.rec__actions
  display: flex
  gap: 10px
  flex-shrink: 0

.rec__action
  min-height: 44px
  padding: 0 18px
  font-weight: 600
  border-radius: $radius
  white-space: nowrap
  &.q-btn--outline:before
    border-color: $field-border

@media (max-width: 599px)
  .rec__title
    font-size: 26px
  .rec__subline
    font-size: 15px
  .rec__actions
    width: 100%
    flex-wrap: wrap

.rec__skeleton-viewer
  border-radius: 10px

.rec__missing
  display: flex
  flex-direction: column
  align-items: center
  text-align: center
  padding: 64px 16px
  color: $muted

.rec__missing-title
  margin-top: 10px
  font-family: $serif
  font-size: 22px
  font-weight: 600
  color: $ink

// ── Details grid ───────────────────────────────────────────────────────────
.rec__grid
  display: grid
  grid-template-columns: minmax(0, 1fr) 360px
  gap: 28px
  align-items: start

@media (max-width: 1023px)
  .rec__grid
    grid-template-columns: minmax(0, 1fr)

.rec__main,
.rec__aside
  display: flex
  flex-direction: column
  gap: 20px
  min-width: 0

.rec-card
  background: $surface
  border: 1px solid $divider
  border-radius: 10px
  overflow: hidden
  &--flush
    display: flex
    flex-direction: column

.rec-card__head
  display: flex
  align-items: center
  justify-content: space-between
  gap: 12px
  padding: 16px 22px
  border-bottom: 1px solid $divider-soft
  &--sm
    padding: 14px 18px

.rec-card__title
  margin: 0
  font-size: 17px
  font-weight: 700
  color: $ink
  .rec-card__head--sm &,
  .rec-info &,
  .rec-cite &
    font-size: 15px

.rec-card__hint
  font-size: 13px
  color: $muted

// Label / value list
.rec-dl
  margin: 0
  padding: 6px 22px 10px
  display: grid
  grid-template-columns: 200px minmax(0, 1fr)
  column-gap: 24px
  font-size: 15px
  dt,
  dd
    padding: 10px 0
    border-bottom: 1px solid $divider-soft
  dt
    color: $muted
    font-size: 13.5px
    font-weight: 600
  dd
    margin: 0
    color: $ink
    overflow-wrap: anywhere
  dt:nth-last-of-type(1),
  dd:last-of-type
    border-bottom: none
  &--inner
    padding: 0 22px 12px

@media (max-width: 599px)
  .rec-dl
    grid-template-columns: minmax(0, 1fr)
    padding-left: 16px
    padding-right: 16px
    dt
      padding-bottom: 0
      border-bottom: none
    dd
      padding-top: 4px

// Expanders ("All metadata")
.rec-exp
  border-bottom: 1px solid $divider-soft
  &:last-child
    border-bottom: none

:deep(.rec-exp__header)
  padding: 14px 22px
  min-height: 0
  .q-item__section--side
    color: $muted
  .q-focus-helper
    display: none

.rec-exp__label
  font-size: 15px
  font-weight: 600
  color: $ink

.rec-exp__hint
  font-weight: 500
  color: $muted

.rec-notes
  margin: 0
  padding: 0 22px 16px 42px
  display: flex
  flex-direction: column
  gap: 6px
  font-size: 14.5px
  line-height: 1.55
  color: #3A362E

.rec-link
  color: $primary
  text-decoration: underline
  text-underline-offset: 3px
  text-decoration-color: $field-border
  overflow-wrap: anywhere
  &:hover
    text-decoration-color: $primary

// Citation
.rec-cite
  background: #F3EDE0
  border: 1px solid $divider
  border-radius: 10px
  padding: 18px 22px
  display: flex
  flex-direction: column
  gap: 10px

.rec-cite__head
  display: flex
  align-items: center
  justify-content: space-between
  gap: 12px

.rec-cite__btn
  background: $surface
  font-weight: 600
  &:before
    border-color: $field-border

.rec-cite__text
  margin: 0
  font-size: 14.5px
  line-height: 1.55
  color: #3A362E

// Sidebar rows
.rec-file,
.rec-parent
  display: flex
  align-items: center
  gap: 12px
  padding: 12px 18px
  border-bottom: 1px solid $divider-soft
  color: $ink
  text-decoration: none
  transition: background 0.15s
  &:last-child
    border-bottom: none
  &:hover
    background: $paper

.rec-file__ext
  width: 36px
  height: 36px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  border-radius: $radius
  font-size: 11px
  font-weight: 700
  background: $soft-primary
  color: $primary
  &--PDF
    background: #F5E1D0
    color: #7A3F12
  &--UNKNOWN
    background: $soft-muted
    color: $soft-muted-ink

.rec-file__text
  display: flex
  flex-direction: column
  gap: 2px
  min-width: 0
  flex-grow: 1

.rec-file__name
  font-size: 14px
  font-weight: 600
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis

.rec-file__meta
  font-size: 12.5px
  color: $muted

.rec-file__icon
  color: $primary
  flex-shrink: 0

.rec-parent__icon
  width: 44px
  height: 44px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  border-radius: 6px
  background: #F1EADB
  color: $primary

.rec-parent__chevron
  color: $muted
  flex-shrink: 0

.rec-info
  padding: 14px 18px 16px
  display: flex
  flex-direction: column
  gap: 10px

.rec-info__row
  display: flex
  justify-content: space-between
  gap: 12px
  font-size: 13.5px

.rec-info__label
  color: $muted
  flex-shrink: 0

.rec-info__value
  text-align: right
  min-width: 0
  overflow-wrap: anywhere

.rec-info__report
  display: inline-flex
  align-items: center
  gap: 6px
  margin-top: 4px
  font-size: 13.5px
  font-weight: 600
  color: $eyebrow
  text-decoration: none
  &:hover
    text-decoration: underline

// ── Siblings / children ────────────────────────────────────────────────────
.rec-more
  display: flex
  flex-direction: column
  gap: 16px
  padding-top: 8px

.rec-more__head
  display: flex
  align-items: flex-end
  justify-content: space-between
  gap: 16px
  flex-wrap: wrap

.rec-more__title
  margin: 4px 0 0
  font-family: $serif
  font-size: 24px
  font-weight: 600
  color: $ink

.rec-more__all
  display: inline-flex
  align-items: center
  gap: 6px
  font-size: 14.5px
  font-weight: 600
  color: $primary
  text-decoration: none
  &:hover
    text-decoration: underline

.rec-more__grid
  display: grid
  grid-template-columns: repeat(6, minmax(0, 1fr))
  gap: 16px

@media (max-width: 1279px)
  .rec-more__grid
    grid-template-columns: repeat(4, minmax(0, 1fr))

@media (max-width: 799px)
  .rec-more__grid
    grid-template-columns: repeat(2, minmax(0, 1fr))

.rec-mini
  display: flex
  gap: 12px
  padding: 12px
  background: $surface
  border: 1px solid $divider
  border-radius: $radius
  color: $ink
  text-decoration: none
  transition: border-color 0.15s
  &:hover
    border-color: $primary
  &--current
    background: $soft-primary
    border-color: $primary

.rec-mini__cover
  width: 52px
  height: 68px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  border-radius: 4px
  background: $divider-soft
  color: $muted
  overflow: hidden
  img
    width: 100%
    height: 100%
    object-fit: cover
    display: block

.rec-mini__text
  display: flex
  flex-direction: column
  gap: 3px
  min-width: 0

.rec-mini__title
  font-size: 14px
  font-weight: 600
  line-height: 1.3
  overflow: hidden
  display: -webkit-box
  -webkit-line-clamp: 2
  -webkit-box-orient: vertical
  .rec-mini--current &
    font-weight: 700

.rec-mini__meta
  font-size: 12.5px
  color: $muted
</style>
