<template>
  <div class="form-field">
    <label v-if="label" class="form-field__label" :for="forId">
      {{ label }}
      <span v-if="required" class="form-field__required" aria-hidden="true">*</span>
      <span v-else-if="publishOnly" class="form-field__publish">
        · {{ t('admin.edit.neededToPublish') }}
      </span>
    </label>
    <slot />
    <div v-if="hint || $slots.hint" class="form-field__hint" :class="{ 'form-field__hint--warning': warning }">
      <slot name="hint">{{ hint }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// Label above a Quasar field (the admin forms do not use floating labels),
// with the required marker and a hint line under it.

defineProps<{
  label?: string | undefined;
  /** `for` of the label — pass the same value as the input's `for` prop. */
  forId?: string | undefined;
  required?: boolean | undefined;
  /** Not needed to save, but needed before the item can be published. */
  publishOnly?: boolean | undefined;
  hint?: string | undefined;
  /** Hint in the warning tone (a field that is holding up a save or a publish). */
  warning?: boolean | undefined;
}>();

const { t } = useI18n();
</script>

<style scoped lang="sass">
.form-field
  display: flex
  flex-direction: column
  gap: 6px
  min-width: 0

.form-field__label
  font-size: 13px
  font-weight: 600
  color: $ink-soft

.form-field__required
  color: $negative

.form-field__publish
  font-size: 12px
  color: $soft-warning-ink

.form-field__hint
  font-size: 12px
  line-height: 1.4
  color: $muted

.form-field__hint--warning
  color: $soft-warning-ink
</style>
