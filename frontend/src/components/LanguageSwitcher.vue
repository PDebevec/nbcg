<template>
  <q-btn-dropdown
    flat
    no-caps
    dense
    class="lang-switcher"
    :label="current.short"
    icon="language"
  >
    <q-list>
      <q-item
        v-for="lang in LANGUAGES"
        :key="lang.value"
        clickable
        v-close-popup
        :active="lang.value === locale"
        active-class="lang-active"
        @click="setLocale(lang.value)"
      >
        <q-item-section>{{ lang.label }}</q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { LANGUAGES, setLocale } from 'src/boot/i18n';

// Dropdown variant of the language choice (admin drawer, public mobile menu).
// The public header uses LanguageLinks instead.

const { locale } = useI18n();

const current = computed(
  () => LANGUAGES.find((l) => l.value === locale.value) ?? LANGUAGES[0]!,
);
</script>

<style scoped lang="sass">
.lang-switcher
  color: $dark
  font-weight: 600
  font-size: 0.85rem
  min-height: 40px
  border-radius: 8px
  padding: 0 10px

.lang-active
  color: $primary
  font-weight: 700
</style>
