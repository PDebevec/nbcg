<template>
  <q-page>
    <div class="sub-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="header-kicker q-mb-xs">{{ t('common.library') }}</div>
        <h1 class="text-h4 text-weight-bold text-white q-my-none">{{ t('about.title') }}</h1>
      </div>
    </div>

    <div class="page-body q-px-md q-py-xl">
      <div class="content-card q-pa-xl">
        <div class="section-label text-library-muted q-mb-xs">{{ t('about.kicker') }}</div>
        <h2 class="text-h5 text-weight-bold text-library-primary q-mt-none q-mb-md">
          {{ t('about.title') }}
        </h2>
        <p class="lead">{{ t('index.aboutP1') }}</p>
        <p>{{ t('index.aboutP2') }}</p>
        <p>{{ t('index.aboutP3') }}</p>
        <p>{{ t('index.aboutP4') }}</p>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<style scoped lang="sass">
@use 'sass:color'

.sub-header
  background: linear-gradient(90deg, $primary 0%, color.adjust($primary, $lightness: -10%) 100%)

.header-kicker
  font-size: 0.72rem
  font-weight: 700
  letter-spacing: 0.14em
  text-transform: uppercase
  color: rgba($paper, 0.6)

.page-body
  max-width: 1024px
  margin: 0 auto

.section-label
  letter-spacing: 0.08em
  text-transform: uppercase
  font-size: 0.72rem
  font-weight: 700

.content-card
  background: linear-gradient(180deg, color.adjust($paper, $lightness: 2%), $paper)
  border: 1px solid $divider
  border-radius: 16px
  box-shadow: 0 4px 20px rgba($dark, 0.06)
  p
    font-size: 0.97rem
    line-height: 1.75
    color: $ink
    margin-bottom: 1.1rem
    &:last-child
      margin-bottom: 0
  .lead
    font-size: 1.12rem
    line-height: 1.7
    color: color.adjust($ink, $lightness: 6%)
    font-weight: 500
    margin-bottom: 1.4rem
</style>
