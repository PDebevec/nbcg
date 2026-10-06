<template>
  <div class="column q-gutter-y-md">
    <q-list v-if="loading" separator>
      <q-item v-for="i in 5" :key="i">
        <q-item-section avatar><q-skeleton type="QAvatar" size="40px" /></q-item-section>
        <q-item-section>
          <q-skeleton type="text" width="60%" />
          <q-skeleton type="text" width="35%" />
        </q-item-section>
      </q-item>
    </q-list>

    <q-banner v-else-if="failed" dense rounded class="bg-negative text-white">
      {{ t('record.childrenLoadFailed') }}
    </q-banner>

    <div v-else-if="!hits.length" class="text-grey-7 q-pa-md">
      {{ t('record.childrenEmpty') }}
    </div>

    <q-list v-else separator>
      <q-item v-for="hit in hits" :key="hit.id" clickable :to="`${linkPrefix}${hit.id}`">
        <q-item-section avatar>
          <q-avatar square size="40px" color="grey-2" text-color="grey-8">
            <img v-if="coverUrl(hit)" :src="coverUrl(hit)" alt="" loading="lazy" />
            <q-icon v-else :name="materialIcon(hit.source.metadata.materialType)" size="20px" />
          </q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ itemTitle(hit) }}</q-item-label>
          <q-item-label caption>{{ itemCaption(hit) }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="hit.source.metadata.collectionType > 0" side>
          <q-badge outline color="primary">{{ t('index.records', hit.source.metadata.childrenInRecords ?? 0) }}</q-badge>
        </q-item-section>
        <q-item-section side><q-icon name="o_chevron_right" size="18px" /></q-item-section>
      </q-item>
    </q-list>

    <div v-if="pages > 1" class="row justify-center">
      <q-pagination v-model="page" :max="pages" :max-pages="7" direction-links boundary-links />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { listChildren, type SearchHit } from 'src/api/search';
import { coverUrl, creatorLine, materialIcon } from 'src/utils/publicRecord';

// Prototype: the members of a collection as a plain paginated list. Shared by
// the public record page (on a collection) and the admin editor's Contents tab.

const props = withDefaults(
  defineProps<{
    parentId: string;
    type?: 'records' | 'drafts';
    /** Each row links to `${linkPrefix}${id}`. */
    linkPrefix?: string;
    pageSize?: number;
    /** `issueDate` for a serial: oldest issue first. */
    sort?: 'relevance' | 'issueDate';
  }>(),
  { type: 'records', linkPrefix: '/catalog/', pageSize: 20, sort: 'relevance' },
);

const emit = defineEmits<{ total: [count: number] }>();

const { t } = useI18n();

const FIELDS = [
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

const hits = ref<SearchHit[]>([]);
const page = ref(1);
const pages = ref(0);
const loading = ref(true);
const failed = ref(false);

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const result = await listChildren(props.parentId, {
      type: props.type,
      page: page.value,
      limit: props.pageSize,
      fields: FIELDS,
      sort: props.sort,
    });
    hits.value = result.hits;
    pages.value = result.pages;
    emit('total', result.total);
  } catch {
    hits.value = [];
    pages.value = 0;
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.parentId, props.type, props.sort],
  () => {
    // Back to page 1; the page watcher loads unless we were already there.
    if (page.value !== 1) page.value = 1;
    else void load();
  },
  { immediate: true },
);
watch(page, () => void load());

function itemTitle(hit: SearchHit): string {
  const m = hit.source.metadata;
  const number = m.issue?.number ? `${t('record.numberShort')} ${m.issue.number}` : '';
  return [m.title, number].filter(Boolean).join(', ') || hit.id;
}

function itemCaption(hit: SearchHit): string {
  const m = hit.source.metadata;
  const date = m.issue?.date || m.publicationDate1 || '';
  return [creatorLine(hit), date].filter(Boolean).join(' · ');
}
</script>
