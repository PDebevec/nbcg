<template>
  <q-page>
    <div class="sub-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="header-kicker q-mb-xs">{{ t('common.library') }}</div>
        <h1 class="text-h4 text-weight-bold text-white q-my-none">{{ t('contact.title') }}</h1>
      </div>
    </div>

    <div class="page-body q-px-md q-py-xl">
      <div class="content-card q-pa-xl">
        <div class="row items-center q-gutter-md q-mb-lg">
          <q-icon name="call" color="primary" size="28px" />
          <div>
            <div class="text-weight-semibold text-library-ink">{{ t('contact.phone') }}</div>
            <div class="text-library-muted">+ 382 41 234 243, lokal 13</div>
          </div>
        </div>

        <q-separator color="grey-3" class="q-my-md" />

        <div class="row items-center q-gutter-md q-mb-lg">
          <q-icon name="mail" color="primary" size="28px" />
          <div>
            <div class="text-weight-semibold text-library-ink">{{ t('contact.email') }}</div>
            <a href="mailto:info@dlib.me" class="contact-link">info@dlib.me</a>
          </div>
        </div>

        <q-separator color="grey-3" class="q-my-md" />

        <div class="row items-center q-gutter-md">
          <q-icon name="location_on" color="primary" size="28px" />
          <div>
            <div class="text-weight-semibold text-library-ink">{{ t('contact.address') }}</div>
            <div class="text-library-muted">
              {{ t('contact.addressValue') }}
            </div>
          </div>
        </div>

        <div class="row q-gutter-sm q-mt-xl">
          <q-btn
            round
            unelevated
            color="primary"
            icon="fab fa-facebook-f"
            href="https://www.facebook.com"
            target="_blank"
          >
            <q-tooltip>Facebook</q-tooltip>
          </q-btn>
          <q-btn
            round
            unelevated
            color="primary"
            icon="fab fa-twitter"
            href="https://www.twitter.com"
            target="_blank"
          >
            <q-tooltip>Twitter</q-tooltip>
          </q-btn>
        </div>
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

.contact-link
  color: $primary
  text-decoration: none
  &:hover
    text-decoration: underline
</style>
