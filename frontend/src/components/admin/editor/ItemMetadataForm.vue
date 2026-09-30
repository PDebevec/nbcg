<template>
  <div class="metadata-form">
    <!-- ISSUE — only when a parent is a serial collection; then it comes first -->
    <EditorSection
      v-if="by.issue"
      v-model:open="open.issue"
      :section="by.issue"
      :title="title('issue')"
      :summary="summary('issue')"
    >
      <div class="frow">
        <MetaField v-if="v('issue.volume')" path="issue.volume" class="fcol" />
        <MetaField v-if="v('issue.number')" path="issue.number" class="fcol" />
        <MetaField v-if="v('issue.date')" path="issue.date" class="fcol" />
      </div>
    </EditorSection>

    <!-- IDENTIFICATION -->
    <EditorSection
      v-if="by.identification"
      v-model:open="open.identification"
      :section="by.identification"
      :title="title('identification')"
      :summary="summary('identification')"
    >
      <div class="frow">
        <MetaField v-if="v('title')" path="title" class="fcol fcol--2" />
        <MetaField v-if="v('collectionType')" path="collectionType" class="fcol" />
        <!-- Not metadata, but decided together with the title -->
        <FormField :label="t('admin.items.columns.visibility')" for-id="input-visibility" class="fcol">
          <q-select
            v-model="visibility"
            :options="visibilityOptions"
            emit-value
            map-options
            outlined
            dense
            options-dense
            for="input-visibility"
          >
            <template #prepend>
              <span class="adm-dot" :class="VISIBILITY_DOT[visibility]" />
            </template>
          </q-select>
        </FormField>
      </div>
      <div class="frow">
        <MetaField v-if="v('subtitle')" path="subtitle" class="fcol fcol--2" />
        <MetaField v-if="v('titleMediumDesignation')" path="titleMediumDesignation" class="fcol" />
      </div>
      <div class="frow">
        <MetaField v-if="v('parallelTitle')" path="parallelTitle" class="fcol" />
        <MetaField v-if="v('titleInOtherScript')" path="titleInOtherScript" class="fcol" />
      </div>
      <div class="frow">
        <MetaField v-if="v('titleByAnotherAuthor')" path="titleByAnotherAuthor" class="fcol" />
        <MetaField v-if="v('documentTypology')" path="documentTypology" class="fcol" />
      </div>
      <div class="frow">
        <MetaField v-if="v('recordType')" path="recordType" class="fcol" />
        <MetaField v-if="v('bibliographicLevel')" path="bibliographicLevel" class="fcol" />
      </div>
    </EditorSection>

    <!-- RESPONSIBILITY -->
    <EditorSection
      v-if="by.responsibility"
      v-model:open="open.responsibility"
      :section="by.responsibility"
      :title="title('responsibility')"
      :summary="summary('responsibility')"
    >
      <div class="frow">
        <MetaField v-if="v('firstResponsibility')" path="firstResponsibility" class="fcol" />
        <MetaField v-if="v('subsequentResponsibility')" path="subsequentResponsibility" class="fcol" />
      </div>
      <MetaField v-if="v('authors')" path="authors" />
      <MetaField v-if="v('corporateBodies')" path="corporateBodies" />
    </EditorSection>

    <!-- PUBLICATION, with the statements only some material types have (scale, numbering, music edition) -->
    <EditorSection
      v-if="by.publication"
      v-model:open="open.publication"
      :section="by.publication"
      :title="title('publication')"
      :summary="summary('publication')"
    >
      <div class="frow">
        <MetaField v-if="v('publication.publisher')" path="publication.publisher" class="fcol fcol--5" />
        <MetaField v-if="v('publication.place')" path="publication.place" class="fcol fcol--4" />
        <MetaField v-if="v('publication.year')" path="publication.year" class="fcol fcol--3" />
      </div>
      <div class="frow">
        <MetaField v-if="v('edition')" path="edition" class="fcol fcol--2" />
        <MetaField v-if="v('publicationDate1')" path="publicationDate1" class="fcol" />
        <MetaField v-if="v('publicationDate2')" path="publicationDate2" class="fcol" />
      </div>
      <div
        v-if="v('cartographicMathematicalData') || v('numberingAndDates') || v('musicEditionStatement')"
        class="frow"
      >
        <MetaField
          v-if="v('cartographicMathematicalData')"
          path="cartographicMathematicalData"
          class="fcol"
        />
        <MetaField v-if="v('numberingAndDates')" path="numberingAndDates" class="fcol" />
        <MetaField v-if="v('musicEditionStatement')" path="musicEditionStatement" class="fcol" />
      </div>
      <div class="frow">
        <MetaField
          v-if="v('publication.placeOfManufacture')"
          path="publication.placeOfManufacture"
          class="fcol"
        />
        <MetaField
          v-if="v('publication.manufacturerName')"
          path="publication.manufacturerName"
          class="fcol"
        />
      </div>
    </EditorSection>

    <!-- PHYSICAL DESCRIPTION -->
    <EditorSection
      v-if="by.physical"
      v-model:open="open.physical"
      :section="by.physical"
      :title="title('physical')"
      :summary="summary('physical')"
    >
      <div class="frow">
        <MetaField v-if="v('physicalDescription')" path="physicalDescription" class="fcol fcol--7" />
        <MetaField v-if="v('extent')" path="extent" class="fcol fcol--5" />
      </div>
      <div class="frow">
        <MetaField v-if="v('otherPhysicalDetails')" path="otherPhysicalDetails" class="fcol fcol--7" />
        <MetaField v-if="v('dimensions')" path="dimensions" class="fcol fcol--5" />
      </div>
    </EditorSection>

    <!-- SERIES -->
    <EditorSection
      v-if="by.series"
      v-model:open="open.series"
      :section="by.series"
      :title="title('series')"
      :summary="summary('series')"
    >
      <div class="frow">
        <MetaField v-if="v('seriesTitle')" path="seriesTitle" class="fcol" />
        <MetaField v-if="v('seriesSubtitle')" path="seriesSubtitle" class="fcol" />
      </div>
      <div class="frow">
        <MetaField v-if="v('seriesResponsibility')" path="seriesResponsibility" class="fcol fcol--2" />
        <MetaField v-if="v('seriesIssn')" path="seriesIssn" class="fcol" />
        <MetaField v-if="v('seriesVolume')" path="seriesVolume" class="fcol" />
      </div>
    </EditorSection>

    <!-- IDENTIFIERS -->
    <EditorSection
      v-if="by.identifiers"
      v-model:open="open.identifiers"
      :section="by.identifiers"
      :title="title('identifiers')"
      :summary="summary('identifiers')"
    >
      <div class="frow">
        <MetaField v-if="v('cobissId')" path="cobissId" class="fcol" />
        <MetaField v-if="v('isbn')" path="isbn" class="fcol" />
        <MetaField v-if="v('issn')" path="issn" class="fcol" />
        <MetaField v-if="v('ismn')" path="ismn" class="fcol" />
      </div>
    </EditorSection>

    <!-- LANGUAGES AND COUNTRIES -->
    <EditorSection
      v-if="by.languages"
      v-model:open="open.languages"
      :section="by.languages"
      :title="title('languages')"
      :summary="summary('languages')"
    >
      <div class="frow">
        <MetaField v-if="v('language')" path="language" class="fcol" />
        <MetaField v-if="v('country')" path="country" class="fcol" />
      </div>
      <div class="frow">
        <MetaField v-if="v('originalLanguage')" path="originalLanguage" class="fcol" />
        <MetaField v-if="v('translationLanguages')" path="translationLanguages" class="fcol" />
      </div>
    </EditorSection>

    <!-- SUBJECT AND NOTES -->
    <EditorSection
      v-if="by.notes"
      v-model:open="open.notes"
      :section="by.notes"
      :title="title('notes')"
      :summary="summary('notes')"
    >
      <div class="frow">
        <MetaField v-if="v('summaryNote')" path="summaryNote" class="fcol fcol--7" />
        <MetaField v-if="v('notes')" path="notes" class="fcol fcol--5" />
      </div>
      <div class="frow">
        <MetaField v-if="v('keywords')" path="keywords" class="fcol fcol--7" />
        <MetaField v-if="v('electronicLocation')" path="electronicLocation" class="fcol fcol--5" />
      </div>
    </EditorSection>

    <!-- CODED DATA FOR TEXT (105) -->
    <EditorSection
      v-if="by.coded"
      v-model:open="open.coded"
      :section="by.coded"
      :title="title('coded')"
      :summary="summary('coded')"
    >
      <div class="frow">
        <MetaField
          v-if="v('textualMaterialCodes.illustrationCodes')"
          path="textualMaterialCodes.illustrationCodes"
          class="fcol"
        />
        <MetaField
          v-if="v('textualMaterialCodes.contentTypeCodes')"
          path="textualMaterialCodes.contentTypeCodes"
          class="fcol"
        />
      </div>
      <div class="frow">
        <MetaField
          v-if="v('textualMaterialCodes.literaryForm')"
          path="textualMaterialCodes.literaryForm"
          class="fcol"
        />
        <MetaField
          v-if="v('textualMaterialCodes.biographyCode')"
          path="textualMaterialCodes.biographyCode"
          class="fcol"
        />
      </div>
      <div class="row q-gutter-x-lg q-gutter-y-sm">
        <MetaField
          v-for="flag in FLAGS.filter(v)"
          :key="flag"
          :path="flag"
        />
      </div>
    </EditorSection>

    <!-- OTHER FIELDS: what the schema hides for this item. Still fillable, never dropped. -->
    <div v-if="hiddenFields.length" id="section-other" class="other-fields" :class="{ 'other-fields--open': open.other }">
      <q-item clickable class="other-fields__head" :aria-expanded="open.other" @click="open.other = !open.other">
        <q-item-section avatar>
          <span class="other-fields__tile">
            <q-icon :name="open.other ? 'o_remove' : 'o_add'" size="16px" />
          </span>
        </q-item-section>
        <q-item-section>
          <q-item-label class="other-fields__title">
            {{ t('admin.edit.other.title', { count: hiddenFields.length }) }}
          </q-item-label>
          <q-item-label caption class="other-fields__caption">
            {{ hiddenLabels }} — {{ t('admin.edit.other.caption') }}
          </q-item-label>
        </q-item-section>
      </q-item>
      <div v-show="open.other" class="other-fields__body">
        <MetaField
          v-for="path in hiddenFields"
          :key="path"
          :path="path"
          :class="{ 'other-fields__wide': WIDE.has(path) }"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { VISIBILITY_STATUSES, type VisibilityStatus } from 'src/api/admin';
import FormField from 'src/components/admin/FormField.vue';
import type { SectionKey } from 'src/components/admin/form/fields';
import EditorSection from './EditorSection.vue';
import MetaField from './MetaField.vue';
import { useEditor, type SectionState } from './editorContext';

// ---------------------------------------------------------------------------
// The item editor's form: one card per section, laid out by hand the way a
// cataloguer reads a record. Which fields a section shows is decided per item
// by the metadata schema (material type, collection type, the parent) — a
// field the schema hides for this item is not rendered in its section and
// moves to "Other fields" at the bottom, where it can still be filled in.
//
// The model, the evaluated states and the section bookkeeping come from the
// editor context the page provides.
// ---------------------------------------------------------------------------

const visibility = defineModel<VisibilityStatus>('visibility', { required: true });

const { t } = useI18n();
const { schema, sections, hiddenFields, open } = useEditor();

const VISIBILITY_DOT: Record<VisibilityStatus, string> = {
  PUBLIC: 'adm-dot--positive',
  PRIVATE: 'adm-dot--warning',
  HIDDEN: '',
};

const FLAGS = [
  'textualMaterialCodes.conferencePublication',
  'textualMaterialCodes.festschrift',
  'textualMaterialCodes.indexIndicator',
];

/** Fields that need the whole row in the "Other fields" grid. */
const WIDE = new Set(['authors', 'corporateBodies', 'notes', 'electronicLocation', 'summaryNote']);

/** The sections this item shows, by key — `undefined` for one with no visible field. */
const by = computed(
  () =>
    Object.fromEntries(sections.value.map((section) => [section.key, section])) as Partial<
      Record<SectionKey, SectionState>
    >,
);

function v(path: string): boolean {
  return schema.visible(path);
}

function title(key: SectionKey): string {
  return t(`admin.edit.sections.${key}.title`);
}

function summary(key: SectionKey): string {
  return t(`admin.edit.sections.${key}.summary`);
}

const visibilityOptions = computed(() =>
  VISIBILITY_STATUSES.map((s) => ({ label: t(`admin.visibility.${s}`), value: s })),
);

const hiddenLabels = computed(() => hiddenFields.value.map((path) => schema.label(path)).join(' · '));
</script>

<style scoped lang="sass">
.metadata-form
  display: flex
  flex-direction: column
  gap: 16px

// A row of fields. The weights are the design's column ratios; a field the
// schema hides is simply not rendered and the others take its room.
.frow
  display: flex
  flex-wrap: wrap
  gap: 16px

.fcol
  flex: 1 1 0
  min-width: 200px

.fcol--2
  flex-grow: 2

.fcol--3
  flex-grow: 3

.fcol--4
  flex-grow: 4

.fcol--5
  flex-grow: 5

.fcol--7
  flex-grow: 7

.other-fields
  border: 1px dashed $field-border
  border-radius: $radius
  scroll-margin-top: 16px

.other-fields--open
  background: $surface

.other-fields__head
  padding: 14px 20px
  border-radius: $radius

.other-fields__tile
  display: flex
  align-items: center
  justify-content: center
  width: 28px
  height: 28px
  border: 1px dashed $field-border
  border-radius: $radius
  color: $muted

.other-fields__title
  font-size: 14px
  font-weight: 600
  color: $primary

.other-fields__caption
  font-size: 12px
  line-height: 1.45
  color: $muted

.other-fields__body
  display: grid
  grid-template-columns: repeat(2, minmax(0, 1fr))
  gap: 16px
  padding: 4px 20px 20px

.other-fields__wide
  grid-column: 1 / -1
</style>
