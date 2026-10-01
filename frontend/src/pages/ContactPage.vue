<template>
  <q-page>
    <div class="site-container pub-page">
      <PageHead :title="t('contact.title')" :lead="t('contact.lead')" :crumb="t('nav.contact')" />

      <div class="pub-grid pub-grid--even">
        <div class="contact">
          <a href="tel:+38241234243" class="pub-card contact__card">
            <span class="contact__icon"><q-icon name="o_call" size="24px" /></span>
            <span class="contact__text">
              <span class="pub-eyebrow">{{ t('contact.phone') }}</span>
              <span class="contact__value">{{ t('footer.phone') }}</span>
            </span>
          </a>
          <a href="mailto:info@dlib.me" class="pub-card contact__card">
            <span class="contact__icon"><q-icon name="o_mail" size="24px" /></span>
            <span class="contact__text">
              <span class="pub-eyebrow">{{ t('contact.email') }}</span>
              <span class="contact__value contact__value--link">{{ t('footer.email') }}</span>
              <span class="contact__note">{{ t('contact.emailNote') }}</span>
            </span>
          </a>
          <div class="pub-card contact__card">
            <span class="contact__icon"><q-icon name="o_place" size="24px" /></span>
            <span class="contact__text">
              <span class="pub-eyebrow">{{ t('contact.address') }}</span>
              <span class="contact__value contact__value--sm">{{ t('contact.libraryName') }}</span>
              <span class="contact__place">{{ t('contact.libraryPlace') }}</span>
            </span>
          </div>

          <div class="contact__social">
            <span class="contact__follow">{{ t('contact.follow') }}</span>
            <q-btn round unelevated color="primary" icon="fab fa-facebook-f" href="https://www.facebook.com" target="_blank" aria-label="Facebook" />
            <q-btn round unelevated color="primary" icon="fab fa-twitter" href="https://www.twitter.com" target="_blank" aria-label="Twitter" />
          </div>
        </div>

        <aside class="pub-aside">
          <a :href="MAPS_URL" target="_blank" rel="noopener" class="map">
            <span class="map__pin">
              <q-icon name="o_place" size="18px" />
              {{ t('contact.mapOpen') }}
            </span>
          </a>
          <section class="pub-card pub-card--navy visit">
            <div class="pub-eyebrow">{{ t('contact.visitKicker') }}</div>
            <h2 class="pub-h2">{{ t('contact.libraryName') }}</h2>
            <p class="visit__text">{{ t('contact.visitText') }}</p>
            <q-btn
              unelevated
              no-caps
              icon-right="o_open_in_new"
              :label="t('contact.mapOpen')"
              :href="MAPS_URL"
              target="_blank"
              class="visit__btn"
            />
          </section>
        </aside>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import PageHead from 'components/PageHead.vue';

const { t } = useI18n();

const MAPS_URL = 'https://maps.google.com/?q=Nacionalna+biblioteka+Crne+Gore+Cetinje';
</script>

<style scoped lang="sass">
.contact
  display: flex
  flex-direction: column
  gap: 16px

.contact__card
  display: flex
  align-items: center
  gap: 20px
  padding: 22px 26px
  color: $ink
  text-decoration: none
  transition: border-color 0.15s, box-shadow 0.15s
  &[href]:hover
    border-color: $primary
    box-shadow: 0 4px 18px rgba($dark, 0.08)

.contact__icon
  width: 52px
  height: 52px
  flex-shrink: 0
  display: flex
  align-items: center
  justify-content: center
  border-radius: 12px
  background: #F1EADB
  color: $primary

.contact__text
  display: flex
  flex-direction: column
  gap: 4px
  min-width: 0

.contact__value
  font-size: 20px
  font-weight: 600
  color: $primary
  &--link
    text-decoration: underline
    text-underline-offset: 4px
    text-decoration-thickness: 1.5px
  &--sm
    font-size: 18px
    line-height: 1.3

.contact__note
  font-size: 13.5px
  color: $muted

.contact__place
  font-size: 15px
  color: $ink-soft

.contact__social
  display: flex
  align-items: center
  gap: 14px
  padding: 8px 4px 0

.contact__follow
  font-size: 13px
  font-weight: 600
  letter-spacing: 0.06em
  text-transform: uppercase
  color: $muted

// Map tile: a link to the map service, no embedded map
.map
  display: flex
  align-items: center
  justify-content: center
  height: 300px
  border-radius: 10px
  border: 1px solid #D8CCB3
  background: $divider
  background-image: radial-gradient(circle, rgba($primary, 0.12) 1px, transparent 1px)
  background-size: 18px 18px
  text-decoration: none
  transition: border-color 0.15s
  &:hover
    border-color: $primary

.map__pin
  display: inline-flex
  align-items: center
  gap: 10px
  padding: 12px 18px
  background: $surface
  border: 1px solid $divider
  border-radius: 999px
  font-size: 14px
  font-weight: 600
  color: $primary

.visit
  display: flex
  flex-direction: column
  gap: 10px

.visit__text
  margin: 0
  font-size: 14.5px
  line-height: 1.55
  color: $on-navy

.visit__btn
  align-self: flex-start
  margin-top: 6px
  background: $surface
  color: $primary
  font-weight: 600
</style>
