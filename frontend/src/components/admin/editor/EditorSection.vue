<template>
  <q-card :id="`section-${section.key}`" flat bordered class="editor-section" :aria-labelledby="headingId">
    <div
      class="editor-section__head"
      :class="{ 'editor-section__head--closed': !open, 'editor-section__head--empty': isEmpty }"
      @click="open = !open"
    >
      <span class="editor-section__number" :class="{ 'editor-section__number--empty': isEmpty }">
        {{ section.number }}
      </span>
      <h2 :id="headingId" class="editor-section__title">{{ title }}</h2>
      <q-badge
        class="badge-soft badge-soft--sm editor-section__count"
        :class="isEmpty ? 'badge-soft--muted' : 'badge-soft--primary'"
      >
        {{ section.filled }} / {{ section.total }}
      </q-badge>
      <q-badge v-if="section.blocking > 0" class="badge-soft badge-soft--sm badge-soft--negative">
        <span class="adm-dot editor-section__dot editor-section__dot--negative" />
        {{ t('admin.edit.nRequiredEmpty', { count: section.blocking }) }}
      </q-badge>
      <q-badge v-else-if="section.neededToPublish > 0" class="badge-soft badge-soft--sm badge-soft--warning">
        <span class="adm-dot adm-dot--warning editor-section__dot" />
        {{ t('admin.edit.nNeededToPublish', { count: section.neededToPublish }) }}
      </q-badge>
      <span class="editor-section__summary ellipsis">
        {{ isEmpty && !open ? t('admin.edit.sectionEmpty', { fields: summary }) : summary }}
      </span>
      <q-btn
        flat
        dense
        round
        color="grey-7"
        :icon="open ? 'o_expand_less' : 'o_expand_more'"
        :aria-expanded="open"
        :aria-label="open ? t('admin.edit.collapse', { section: title }) : t('admin.edit.expand', { section: title })"
        @click.stop="open = !open"
      />
    </div>
    <q-slide-transition>
      <div v-show="open" class="editor-section__body">
        <slot />
      </div>
    </q-slide-transition>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SectionState } from './editorContext';

// One section of the item editor as a card: a numbered head with the title, a
// "filled / total" count, what is inside in one line, and a collapse toggle.
// A section holding nothing reads muted; one that is holding up a save or a
// publish carries a pill that says so.

const props = defineProps<{
  section: SectionState;
  title: string;
  /** What is inside, in one line. */
  summary: string;
}>();

const open = defineModel<boolean>('open', { required: true });

const { t } = useI18n();

const headingId = computed(() => `section-title-${props.section.key}`);
const isEmpty = computed(() => props.section.filled === 0);
</script>

<style scoped lang="sass">
.editor-section
  overflow: hidden
  scroll-margin-top: 16px

.editor-section__head
  display: flex
  align-items: center
  gap: 12px
  min-height: 56px
  padding: 12px 20px
  background: $paper-deep
  border-bottom: 1px solid $divider
  cursor: pointer

.editor-section__head--closed
  border-bottom-color: transparent

.editor-section__head--empty
  background: $surface

.editor-section__number
  display: flex
  align-items: center
  justify-content: center
  flex: none
  width: 28px
  height: 28px
  border-radius: $radius
  background: $primary
  color: $paper
  font-size: 12px
  font-weight: 700

.editor-section__number--empty
  background: $soft-muted
  color: $soft-muted-ink

.editor-section__title
  margin: 0
  font-size: 15px
  line-height: 1.3
  font-weight: 700
  letter-spacing: 0
  white-space: nowrap

.editor-section__head--empty .editor-section__title
  color: $ink-soft

.editor-section__count
  font-weight: 700
  font-variant-numeric: tabular-nums

.editor-section__dot
  width: 6px
  height: 6px

.editor-section__dot--negative
  background: $negative

.editor-section__summary
  flex: 1 1 auto
  min-width: 0
  font-size: 13px
  color: $muted

.editor-section__body
  display: flex
  flex-direction: column
  gap: 16px
  padding: 20px
</style>
