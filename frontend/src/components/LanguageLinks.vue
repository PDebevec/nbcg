<template>
  <div class="lang-links" role="group" :aria-label="t('nav.language')">
    <template v-for="(lang, i) in LANGUAGES" :key="lang.value">
      <span v-if="i > 0" aria-hidden="true" class="lang-links__sep">/</span>
      <q-btn
        flat
        dense
        no-caps
        :label="lang.short"
        :aria-pressed="lang.value === locale"
        class="lang-links__btn"
        :class="{ 'lang-links__btn--active': lang.value === locale }"
        @click="setLocale(lang.value)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { LANGUAGES, setLocale } from 'src/boot/i18n';

// "ME / EN" as plain text in the public header: the current language is
// underlined, the other one is a quiet link.

const { t, locale } = useI18n();
</script>

<style scoped lang="sass">
.lang-links
  display: flex
  align-items: center
  gap: 2px

.lang-links__sep
  color: $field-border
  font-size: 14px

.lang-links__btn
  min-height: 44px
  padding: 0 6px
  font-size: 14px
  font-weight: 500
  color: $muted
  border-radius: $radius

  &--active
    font-weight: 700
    color: $primary
    text-decoration: underline
    text-decoration-thickness: 2px
    text-underline-offset: 7px
</style>
