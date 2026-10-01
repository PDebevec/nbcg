<template>
  <div class="page-head">
    <nav class="page-head__crumb" :aria-label="t('nav.breadcrumb')">
      <router-link to="/" class="page-head__crumb-link">{{ t('nav.home') }}</router-link>
      <q-icon name="o_chevron_right" size="14px" />
      <span class="page-head__crumb-current">{{ crumb ?? title }}</span>
    </nav>
    <h1 class="page-head__title">{{ title }}</h1>
    <p v-if="lead" class="page-head__lead">{{ lead }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// Head of a public subpage: breadcrumb, serif title, one-line lead — on the
// paper ground, no band (the home hero is the only navy band).

defineProps<{
  title: string;
  lead?: string;
  /** Breadcrumb label when it differs from the title */
  crumb?: string;
}>();

const { t } = useI18n();
</script>

<style scoped lang="sass">
.page-head
  display: flex
  flex-direction: column
  gap: 12px
  max-width: 820px

.page-head__crumb
  display: flex
  align-items: center
  gap: 8px
  font-size: 13.5px
  color: $muted

.page-head__crumb-link
  color: $muted
  text-decoration: none
  &:hover
    color: $primary

.page-head__crumb-current
  color: $ink

.page-head__title
  margin: 6px 0 0
  font-family: $serif
  font-size: 42px
  font-weight: 600
  line-height: 1.1
  letter-spacing: -0.01em
  color: $ink

.page-head__lead
  margin: 0
  font-size: 18px
  line-height: 1.55
  color: $ink-soft

@media (max-width: 599px)
  .page-head__title
    font-size: 30px
  .page-head__lead
    font-size: 16px
</style>
