<template>
  <q-dialog :model-value="modelValue" persistent @update:model-value="emit('update:modelValue', $event)">
    <q-card class="adm-dialog unsaved">
      <div class="unsaved__head">
        <q-avatar size="40px" square class="unsaved__icon">
          <q-icon name="o_warning_amber" size="20px" />
        </q-avatar>
        <div class="column q-gutter-y-xs">
          <h2 class="adm-dialog__title">{{ t('admin.edit.unsaved.title') }}</h2>
          <p class="unsaved__text">
            {{ t('admin.edit.unsaved.text', { fields: fieldNames, title: itemTitle || '—' }) }}
          </p>
        </div>
      </div>

      <div v-if="changes.length" class="unsaved__list">
        <div v-for="change in changes" :key="change.label" class="unsaved__row">
          <span class="unsaved__label">{{ change.label }}</span>
          <template v-if="change.after !== undefined">
            <span v-if="change.before" class="unsaved__before">{{ change.before }}</span>
            <span v-if="change.before" class="unsaved__arrow">→</span>
            <span class="text-weight-bold">{{ change.after || '—' }}</span>
          </template>
          <span v-else class="unsaved__summary">{{ t('admin.edit.unsaved.changed') }}</span>
        </div>
      </div>

      <div class="unsaved__foot">
        <q-btn flat no-caps color="negative" :label="t('admin.edit.unsaved.discard')" @click="emit('discard')" />
        <q-space />
        <q-btn outline no-caps color="primary" :label="t('admin.edit.unsaved.stay')" @click="emit('stay')" />
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="o_save"
          :label="t('admin.edit.unsaved.save')"
          :loading="saving"
          :disable="!canSave"
          @click="emit('save')"
        >
          <q-tooltip v-if="!canSave">{{ t('admin.edit.unsaved.cannotSave') }}</q-tooltip>
        </q-btn>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// Leaving the editor with a dirty form (nice-to-have A1): save and leave, stay,
// or throw the changes away — with what changed spelled out, so the choice is
// not made blind.

export interface UnsavedChange {
  label: string;
  /** Short scalar values only; `after === undefined` for a change that does not fit on a line (a list, a block). */
  before?: string | undefined;
  after?: string | undefined;
}

const props = defineProps<{
  modelValue: boolean;
  itemTitle: string;
  changes: UnsavedChange[];
  /** The save check passes — otherwise "Save and leave" would only be refused. */
  canSave: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'save'): void;
  (e: 'stay'): void;
  (e: 'discard'): void;
}>();

const { t } = useI18n();

const fieldNames = computed(() => props.changes.map((change) => change.label).join(', '));
</script>

<style scoped lang="sass">
.unsaved
  width: 520px

.unsaved__head
  display: flex
  align-items: flex-start
  gap: 14px
  padding: 22px 24px 8px

.unsaved__icon
  border-radius: 10px
  background: $soft-warning
  color: $soft-warning-ink

.unsaved__text
  margin: 0
  font-size: 14px
  line-height: 1.5
  color: $ink-soft

.unsaved__list
  display: flex
  flex-direction: column
  gap: 6px
  margin: 8px 24px 0
  padding: 10px 14px
  max-height: 220px
  overflow-y: auto
  background: $paper-deep
  border-radius: $radius
  font-size: 13px

.unsaved__row
  display: flex
  align-items: baseline
  gap: 8px

.unsaved__label
  flex: none
  min-width: 96px
  font-weight: 600
  color: $muted

.unsaved__before
  color: #8A8272
  text-decoration: line-through

.unsaved__arrow
  color: #8A8272

.unsaved__summary
  color: $ink-soft

.unsaved__foot
  display: flex
  align-items: center
  gap: 8px
  padding: 20px 24px 22px
</style>
