<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card v-if="failure" class="adm-dialog adm-dialog--wide">
      <div class="validation-head">
        <q-avatar size="40px" square class="validation-head__icon">
          <q-icon name="o_cancel" size="20px" />
        </q-avatar>
        <div class="col column q-gutter-y-xs">
          <h2 class="adm-dialog__title">{{ t(`admin.validation.title.${action}`) }}</h2>
          <p class="validation-head__text">
            <template v-if="total && total > 1">
              <strong>
                {{ t(`admin.validation.batch.${action}`, { failed: failure.items.length, total }) }}
              </strong>
              {{ t('admin.validation.batchNothing') }}
            </template>
            <template v-else>{{ t(`admin.validation.single.${action}`) }}</template>
          </p>
        </div>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :aria-label="t('admin.common.close')" />
      </div>

      <div class="validation-items">
        <div v-for="(item, index) in failure.items" :key="item.id ?? index" class="validation-item">
          <div class="row items-center no-wrap q-gutter-x-sm">
            <q-badge v-if="typeLabel(item.id)" class="badge-soft badge-soft--sm badge-soft--primary validation-item__type">
              {{ typeLabel(item.id) }}
            </q-badge>
            <span class="col validation-item__title ellipsis">
              {{ titleOf(item.id) }}
            </span>
            <q-badge class="badge-soft badge-soft--sm badge-soft--outline">
              {{ t(`admin.validation.checkedAs.${item.state}`) }}
            </q-badge>
            <router-link
              v-if="item.id && item.id !== currentItemId"
              v-close-popup
              :to="`/admin/items/${item.id}`"
              class="adm-link validation-item__link"
            >
              {{ t('admin.common.openInEditor') }}
              <q-icon name="o_arrow_forward" size="14px" />
            </router-link>
          </div>
          <ul class="validation-rows">
            <li v-for="missing in item.missing" :key="`m-${missing.path}`">
              <span class="validation-rows__kind">{{ t('admin.validation.missing') }}</span>
              <span>
                <strong>{{ fieldLabel(missing.label, missing.path) }}</strong>
              </span>
            </li>
            <li v-for="violation in item.violations" :key="`v-${violation.path}-${violation.constraint}`">
              <span class="validation-rows__kind validation-rows__kind--check">
                {{ t('admin.validation.check') }}
              </span>
              <span>
                <strong>{{ fieldLabel(violation.label, violation.path) }}</strong>
                <span class="adm-muted"> · {{ violationText(violation) }}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div class="validation-foot">
        <span class="adm-dialog__foot-note">{{ t('admin.validation.footNote') }}</span>
        <q-btn v-close-popup unelevated no-caps color="primary" :label="t('admin.common.close')" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ConstraintViolation, Label, ValidationFailure } from 'src/api/errors';
import { useSchemaLabel } from 'src/composables/useSchemaForm';

// ---------------------------------------------------------------------------
// What a `400 METADATA_VALIDATION_FAILED` says, item by item. Every write is
// checked against the metadata schema for the state the item ends up in, so
// this one dialog serves bulk publish, the editor's save / publish / return to
// draft, and completing a review task. Field captions come with the error
// (`label: { en, cnr }`), so nothing here knows the schema.
// ---------------------------------------------------------------------------

export type ValidationAction = 'publish' | 'save' | 'toDraft';

export interface ValidationItemInfo {
  title: string;
  /** Material type caption, already in the UI language. */
  type?: string | undefined;
}

const props = defineProps<{
  modelValue: boolean;
  failure: ValidationFailure | null;
  action: ValidationAction;
  /** Titles for the failing ids — the error itself only carries ids. */
  items?: Record<string, ValidationItemInfo> | undefined;
  /** How many items the refused request covered (a batch is all-or-nothing). */
  total?: number | undefined;
  /** The item the editor is showing: no "Open in editor" link for it. */
  currentItemId?: string | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { t } = useI18n();
const { tl } = useSchemaLabel();

function titleOf(id: string | null): string {
  if (!id) return t('admin.validation.newItem');
  return props.items?.[id]?.title || id;
}

function typeLabel(id: string | null): string | undefined {
  return id ? props.items?.[id]?.type : undefined;
}

/** "Corporate body name" → "Corporate body name (2)" for `corporateBodies[1].name`. */
function fieldLabel(label: Label, path: string): string {
  const index = /\[(\d+)\]/.exec(path);
  const text = tl(label) || path;
  return index ? `${text} (${Number(index[1]) + 1})` : text;
}

function violationText(violation: ConstraintViolation): string {
  if (violation.constraint === 'pattern' && violation.hint) return tl(violation.hint);
  return t(`admin.validation.constraints.${violation.constraint}`, { limit: violation.limit ?? '' });
}
</script>

<style scoped lang="sass">
.validation-head
  display: flex
  align-items: flex-start
  gap: 14px
  padding: 22px 24px 8px

.validation-head__icon
  border-radius: 10px
  background: $soft-negative
  color: $soft-negative-ink

.validation-head__text
  margin: 0
  font-size: 14px
  line-height: 1.5
  color: $ink-soft

.validation-items
  display: flex
  flex-direction: column
  gap: 10px
  padding: 12px 24px 4px
  max-height: 50vh
  overflow-y: auto

.validation-item
  display: flex
  flex-direction: column
  gap: 10px
  padding: 12px 14px
  background: #FBF8F1
  border: 1px solid $divider
  border-radius: $radius

.validation-item__type
  text-transform: uppercase
  letter-spacing: 0.04em
  font-weight: 700
  border-radius: 6px

.validation-item__title
  font-size: 14px
  font-weight: 700

.validation-item__link
  font-size: 13px

.validation-rows
  margin: 0
  padding: 0
  list-style: none
  display: flex
  flex-direction: column
  gap: 6px
  font-size: 13px
  li
    display: flex
    align-items: baseline
    gap: 10px

.validation-rows__kind
  width: 64px
  flex: none
  font-size: 11px
  font-weight: 700
  letter-spacing: 0.06em
  text-transform: uppercase
  color: $soft-warning-ink

.validation-rows__kind--check
  color: $soft-negative-ink

.validation-foot
  display: flex
  align-items: center
  gap: 8px
  padding: 16px 24px 22px
</style>
