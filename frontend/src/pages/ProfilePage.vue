<template>
  <q-page>
    <div class="sub-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="header-kicker q-mb-xs">{{ t('common.library') }}</div>
        <h1 class="text-h4 text-weight-bold text-white q-my-none">{{ t('profile.title') }}</h1>
      </div>
    </div>

    <div class="page-body q-px-md q-py-xl">
      <div class="content-card q-pa-xl text-center">
        <q-icon name="account_circle" size="56px" color="primary" class="q-mb-md" />
        <div class="text-h6 text-weight-bold text-library-primary q-mb-sm">
          {{ t('profile.unavailableTitle') }}
        </div>
        <p class="text-library-muted q-mb-lg">
          {{ t('profile.unavailableText') }}
        </p>
        <q-btn unelevated no-caps color="primary" :label="t('common.backHome')" icon="home" to="/" />
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

.content-card
  background: $paper
  border: 1px solid $divider
  border-radius: 16px
  box-shadow: 0 4px 20px rgba($dark, 0.06)
</style>
