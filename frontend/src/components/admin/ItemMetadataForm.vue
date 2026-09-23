<template>
  <div class="metadata-form">
    <q-banner v-if="codeListsFailed" dense rounded class="bg-warning text-dark q-mb-md">
      {{ t('admin.edit.codeListsFailed') }}
    </q-banner>

    <!-- IDENTIFICATION -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.identification') }}</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-8">
          <q-input
            v-model="form.title"
            outlined
            :label="t('admin.edit.fields.title') + ' *'"
            :rules="[(v) => !!v?.trim() || t('admin.edit.titleRequired')]"
          />
        </div>
        <div class="col-12 col-md-4">
          <slot name="visibility" />
        </div>

        <div class="col-12 col-md-8">
          <q-input v-model="form.subtitle" outlined :label="t('admin.edit.fields.subtitle')" />
        </div>
        <div class="col-12 col-md-4">
          <q-input
            v-model="form.titleMediumDesignation"
            outlined
            :label="t('admin.edit.fields.titleMediumDesignation')"
            :hint="t('admin.edit.hints.titleMediumDesignation')"
          />
        </div>

        <div class="col-12 col-md-6">
          <StringListInput
            v-model="form.parallelTitle"
            :label="t('admin.edit.fields.parallelTitle')"
          />
        </div>
        <div class="col-12 col-md-6">
          <StringListInput
            v-model="form.titleInOtherScript"
            :label="t('admin.edit.fields.titleInOtherScript')"
          />
        </div>
        <div class="col-12">
          <q-input
            v-model="form.titleByAnotherAuthor"
            outlined
            :label="t('admin.edit.fields.titleByAnotherAuthor')"
          />
        </div>

        <div class="col-12 col-md-4">
          <CodeSelect
            v-model="form.materialType"
            :options="codeLists.materialType"
            :label="t('admin.edit.fields.materialType')"
          />
        </div>
        <div class="col-12 col-md-4">
          <CodeSelect
            v-model="form.recordType"
            :options="codeLists.recordType"
            :label="t('admin.edit.fields.recordType')"
          />
        </div>
        <div class="col-12 col-md-4">
          <CodeSelect
            v-model="form.bibliographicLevel"
            :options="codeLists.bibliographicLevel"
            :label="t('admin.edit.fields.bibliographicLevel')"
          />
        </div>
        <div class="col-12 col-md-4">
          <q-input
            v-model="form.documentTypology"
            outlined
            :label="t('admin.edit.fields.documentTypology')"
          />
        </div>
      </div>
    </section>

    <!-- RESPONSIBILITY -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.responsibility') }}</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <SuggestTextInput
            v-model="form.firstResponsibility"
            field="firstResponsibility"
            :label="t('admin.edit.fields.firstResponsibility')"
            :hint="t('admin.edit.hints.firstResponsibility')"
          />
        </div>
        <div class="col-12 col-md-6">
          <StringListInput
            v-model="form.subsequentResponsibility"
            :label="t('admin.edit.fields.subsequentResponsibility')"
          />
        </div>
        <div class="col-12">
          <AuthorsEditor v-model="form.authors" :roles="codeLists.role" />
        </div>
        <div class="col-12">
          <CorporateBodiesEditor v-model="form.corporateBodies" />
        </div>
      </div>
    </section>

    <!-- PUBLICATION -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.publication') }}</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-5">
          <SuggestTextInput
            v-model="form.publication.publisher"
            field="publisher"
            :label="t('admin.edit.fields.publisher')"
          />
        </div>
        <div class="col-12 col-md-4">
          <SuggestTextInput
            v-model="form.publication.place"
            field="place"
            :label="t('admin.edit.fields.place')"
          />
        </div>
        <div class="col-12 col-md-3">
          <q-input
            v-model="form.publication.year"
            outlined
            :label="t('admin.edit.fields.year')"
            :hint="t('admin.edit.hints.year')"
          />
        </div>

        <div class="col-12 col-md-6">
          <SuggestTextInput
            v-model="form.edition"
            field="edition"
            :label="t('admin.edit.fields.edition')"
          />
        </div>
        <div class="col-6 col-md-3">
          <q-input
            v-model="form.publicationDate1"
            outlined
            :label="t('admin.edit.fields.publicationDate1')"
            :hint="t('admin.edit.hints.publicationDate1')"
          />
        </div>
        <div class="col-6 col-md-3">
          <q-input
            v-model="form.publicationDate2"
            outlined
            :label="t('admin.edit.fields.publicationDate2')"
            :hint="t('admin.edit.hints.publicationDate2')"
          />
        </div>

        <div class="col-12 col-md-6">
          <q-input
            v-model="form.publication.placeOfManufacture"
            outlined
            :label="t('admin.edit.fields.placeOfManufacture')"
          />
        </div>
        <div class="col-12 col-md-6">
          <q-input
            v-model="form.publication.manufacturerName"
            outlined
            :label="t('admin.edit.fields.manufacturerName')"
          />
        </div>
      </div>
    </section>

    <!-- PHYSICAL DESCRIPTION -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.physical') }}</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-5">
          <q-input
            v-model="form.physicalDescription"
            outlined
            :label="t('admin.edit.fields.physicalDescription')"
            :hint="t('admin.edit.hints.physicalDescription')"
          />
        </div>
        <div class="col-12 col-md-4">
          <q-input
            v-model="form.otherPhysicalDetails"
            outlined
            :label="t('admin.edit.fields.otherPhysicalDetails')"
          />
        </div>
        <div class="col-12 col-md-3">
          <q-input
            v-model="form.dimensions"
            outlined
            :label="t('admin.edit.fields.dimensions')"
            :hint="t('admin.edit.hints.dimensions')"
          />
        </div>
      </div>
    </section>

    <!-- SERIES -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.series') }}</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <SuggestTextInput
            v-model="form.seriesTitle"
            field="seriesTitle"
            :label="t('admin.edit.fields.seriesTitle')"
          />
        </div>
        <div class="col-12 col-md-6">
          <q-input
            v-model="form.seriesSubtitle"
            outlined
            :label="t('admin.edit.fields.seriesSubtitle')"
          />
        </div>
        <div class="col-12 col-md-6">
          <q-input
            v-model="form.seriesResponsibility"
            outlined
            :label="t('admin.edit.fields.seriesResponsibility')"
          />
        </div>
        <div class="col-6 col-md-3">
          <q-input v-model="form.seriesIssn" outlined :label="t('admin.edit.fields.seriesIssn')" />
        </div>
        <div class="col-6 col-md-3">
          <q-input
            v-model="form.seriesVolume"
            outlined
            :label="t('admin.edit.fields.seriesVolume')"
          />
        </div>
      </div>
    </section>

    <!-- IDENTIFIERS -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.identifiers') }}</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-3">
          <q-input
            v-model="form.cobissId"
            outlined
            label="COBISS ID"
            :readonly="!isNew"
            :hint="isNew ? t('admin.edit.hints.cobissIdNew') : t('admin.edit.hints.cobissIdLocked')"
          />
        </div>
        <div class="col-12 col-md-3">
          <StringListInput v-model="form.isbn" :label="t('admin.edit.fields.isbn')" />
        </div>
        <div class="col-12 col-md-3">
          <StringListInput v-model="form.issn" :label="t('admin.edit.fields.issn')" />
        </div>
        <div class="col-12 col-md-3">
          <StringListInput v-model="form.ismn" :label="t('admin.edit.fields.ismn')" />
        </div>
      </div>
    </section>

    <!-- LANGUAGES AND COUNTRIES -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.languages') }}</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <CodeMultiSelect
            v-model="form.language"
            :options="codeLists.language"
            :label="t('admin.edit.fields.language')"
          />
        </div>
        <div class="col-12 col-md-6">
          <CodeMultiSelect
            v-model="form.country"
            :options="codeLists.country"
            :label="t('admin.edit.fields.country')"
          />
        </div>
        <div class="col-12 col-md-6">
          <CodeMultiSelect
            v-model="form.originalLanguage"
            :options="codeLists.language"
            :label="t('admin.edit.fields.originalLanguage')"
            :hint="t('admin.edit.hints.originalLanguage')"
          />
        </div>
        <div class="col-12 col-md-6">
          <CodeMultiSelect
            v-model="form.translationLanguages"
            :options="codeLists.language"
            :label="t('admin.edit.fields.translationLanguages')"
            :hint="t('admin.edit.hints.translationLanguages')"
          />
        </div>
      </div>
    </section>

    <!-- NOTES AND LINKS -->
    <section class="form-section">
      <h2 class="section-title">{{ t('admin.edit.sections.notes') }}</h2>
      <div class="row q-col-gutter-lg">
        <div class="col-12 col-md-7">
          <TextListEditor
            v-model="form.notes"
            :label="t('admin.edit.fields.notes')"
            :add-label="t('admin.edit.addNote')"
            textarea
          />
        </div>
        <div class="col-12 col-md-5">
          <TextListEditor
            v-model="form.electronicLocation"
            :label="t('admin.edit.fields.electronicLocation')"
            :add-label="t('admin.edit.addUrl')"
            placeholder="https://"
            input-type="url"
          />
        </div>
      </div>
    </section>

    <!-- ADVANCED (rarely used coded fields) -->
    <q-expansion-item
      v-model="advancedOpen"
      class="advanced-section"
      header-class="section-title-header"
      :label="t('admin.edit.sections.advanced')"
      :caption="t('admin.edit.sections.advancedCaption')"
      icon="tune"
    >
      <div class="q-pt-md">
        <div class="row q-col-gutter-md">
          <div class="col-12 col-md-6">
            <CodeMultiSelect
              v-model="form.textualMaterialCodes.illustrationCodes"
              :options="codeLists.illustrationCodes"
              :label="t('admin.edit.fields.illustrationCodes')"
            />
          </div>
          <div class="col-12 col-md-6">
            <CodeMultiSelect
              v-model="form.textualMaterialCodes.contentTypeCodes"
              :options="codeLists.contentTypeCodes"
              :label="t('admin.edit.fields.contentTypeCodes')"
            />
          </div>
          <div class="col-12 col-md-6">
            <CodeSelect
              v-model="form.textualMaterialCodes.literaryForm"
              :options="codeLists.literaryForm"
              :label="t('admin.edit.fields.literaryForm')"
            />
          </div>
          <div class="col-12 col-md-6">
            <CodeSelect
              v-model="form.textualMaterialCodes.biographyCode"
              :options="codeLists.biographyCode"
              :label="t('admin.edit.fields.biographyCode')"
            />
          </div>
          <div class="col-12 row q-gutter-lg">
            <q-checkbox
              v-model="form.textualMaterialCodes.conferencePublication"
              :label="t('admin.edit.fields.conferencePublication')"
            />
            <q-checkbox
              v-model="form.textualMaterialCodes.festschrift"
              :label="t('admin.edit.fields.festschrift')"
            />
            <q-checkbox
              v-model="form.textualMaterialCodes.indexIndicator"
              :label="t('admin.edit.fields.indexIndicator')"
            />
          </div>

          <div class="col-12 col-md-4">
            <q-input
              v-model="form.cartographicMathematicalData"
              outlined
              :label="t('admin.edit.fields.cartographicMathematicalData')"
              :hint="t('admin.edit.hints.cartographicMathematicalData')"
            />
          </div>
          <div class="col-12 col-md-4">
            <q-input
              v-model="form.numberingAndDates"
              outlined
              :label="t('admin.edit.fields.numberingAndDates')"
              :hint="t('admin.edit.hints.numberingAndDates')"
            />
          </div>
          <div class="col-12 col-md-4">
            <q-input
              v-model="form.musicEditionStatement"
              outlined
              :label="t('admin.edit.fields.musicEditionStatement')"
            />
          </div>
        </div>
      </div>
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AuthorsEditor from './form/AuthorsEditor.vue';
import CodeMultiSelect from './form/CodeMultiSelect.vue';
import CodeSelect from './form/CodeSelect.vue';
import CorporateBodiesEditor from './form/CorporateBodiesEditor.vue';
import StringListInput from './form/StringListInput.vue';
import SuggestTextInput from './form/SuggestTextInput.vue';
import TextListEditor from './form/TextListEditor.vue';
import type { CodeLists, MetadataForm } from './form/metadataForm';

// ---------------------------------------------------------------------------
// The structured editor over every DomainRecord field, grouped the way a
// cataloguer reads a record: identification → responsibility → publication →
// physical → series → identifiers → languages → notes, with the rarely used
// COMARC 105 / 206 / 207 / 208 codes folded away under "Advanced".
//
// `modelValue` is the page's reactive MetadataForm; fields bind into it
// directly, so the page reads the same object back when it saves.
// ---------------------------------------------------------------------------

const props = defineProps<{
  modelValue: MetadataForm;
  codeLists: CodeLists;
  codeListsFailed: boolean;
  isNew: boolean;
}>();

const { t } = useI18n();

// Alias so the template binds v-model into the shared reactive object.
const form = toRef(props, 'modelValue');

// Open the advanced block whenever it holds data, so nothing is hidden.
const advancedOpen = ref(false);
watch(
  () => props.modelValue,
  (m) => {
    const tmc = m.textualMaterialCodes;
    const hasData =
      tmc.illustrationCodes.length > 0 ||
      tmc.contentTypeCodes.length > 0 ||
      tmc.conferencePublication ||
      tmc.festschrift ||
      tmc.indexIndicator ||
      tmc.literaryForm !== null ||
      tmc.biographyCode !== null ||
      !!m.cartographicMathematicalData ||
      !!m.numberingAndDates ||
      !!m.musicEditionStatement;
    if (hasData) advancedOpen.value = true;
  },
  { immediate: true },
);
</script>

<style scoped lang="sass">
.form-section
  padding-bottom: 8px
  margin-bottom: 24px

.section-title
  font-size: 0.78rem
  font-weight: 700
  letter-spacing: 0.08em
  text-transform: uppercase
  color: $muted
  margin: 0 0 16px
  padding-bottom: 8px
  border-bottom: 1px solid $divider

.advanced-section
  border: 1px solid $divider
  border-radius: $radius

  :deep(.section-title-header)
    font-weight: 600
</style>
