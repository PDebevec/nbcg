<template>
  <q-page>
    <div class="site-container pub-page">
      <PageHead :title="t('about.title')" :lead="t('about.lead')" :crumb="t('nav.about')" />

      <div class="pub-grid">
        <article class="pub-card pub-card--prose pub-prose">
          <p class="pub-prose__lead">{{ t('index.aboutP1') }}</p>
          <p>{{ t('index.aboutP2') }}</p>
          <h2>{{ t('about.whereTitle') }}</h2>
          <p>{{ t('index.aboutP3') }}</p>
          <h2>{{ t('about.programmeTitle') }}</h2>
          <p>{{ t('index.aboutP4') }}</p>
        </article>

        <aside class="pub-aside">
          <section class="pub-card pub-card--navy glance" :aria-label="t('about.glanceTitle')">
            <div class="pub-eyebrow">{{ t('about.glanceKicker') }}</div>
            <h2 class="pub-h2 glance__title">{{ t('about.glanceTitle') }}</h2>
            <ul class="pub-facts">
              <li v-for="fact in FACTS" :key="fact.key" class="pub-fact">
                <span class="pub-fact__icon"><q-icon :name="fact.icon" size="20px" /></span>
                <span class="pub-fact__text">
                  <span class="pub-fact__title">{{ t(`index.facts.${fact.key}Title`) }}</span>
                  <span class="pub-fact__desc">{{ t(`index.facts.${fact.key}Text`) }}</span>
                </span>
              </li>
            </ul>
          </section>

          <LinkCard icon="o_menu_book" :title="t('about.browseTitle')" :text="t('about.browseText')" to="/catalog" />
          <LinkCard icon="o_mail" :title="t('about.contactTitle')" :text="t('about.contactText')" to="/kontakt" />
        </aside>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import PageHead from 'components/PageHead.vue';
import LinkCard from 'components/LinkCard.vue';

const { t } = useI18n();

// The same three facts as the home page's About block
const FACTS = [
  { key: 'since', icon: 'o_calendar_today' },
  { key: 'titles', icon: 'o_inventory_2' },
  { key: 'programme', icon: 'o_account_balance' },
];
</script>

<style scoped lang="sass">
.glance
  display: flex
  flex-direction: column
  gap: 6px

.glance__title
  margin-bottom: 8px
</style>
