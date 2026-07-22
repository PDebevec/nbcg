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
        v-for="lang in languages"
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
import { LOCALE_STORAGE_KEY } from 'src/boot/i18n';

const { locale } = useI18n();

const languages = [
  { value: 'me', label: 'Crnogorski', short: 'CG' },
  { value: 'en-US', label: 'English', short: 'EN' },
];

const current = computed(
  () => languages.find((l) => l.value === locale.value) ?? languages[0]!,
);

function setLocale(value: string) {
  locale.value = value;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // ignore storage errors (private mode etc.)
  }
}
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
