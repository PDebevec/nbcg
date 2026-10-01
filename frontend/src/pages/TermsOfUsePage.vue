<template>
  <q-page>
    <div class="site-container pub-page">
      <PageHead :title="t('terms.title')" :lead="t('terms.lead')" :crumb="t('nav.terms')" />

      <div class="pub-grid">
        <article class="pub-card terms">
          <section v-for="(section, i) in SECTIONS" :key="section" class="terms__section">
            <span class="terms__num">{{ i + 1 }}</span>
            <div class="terms__body">
              <h2 class="terms__title">{{ t(`terms.${section}Title`) }}</h2>
              <p class="terms__text">{{ t(`terms.${section}`) }}</p>
            </div>
          </section>
        </article>

        <aside class="pub-aside">
          <section class="pub-card short" :aria-label="t('terms.shortTitle')">
            <div class="pub-eyebrow">{{ t('terms.shortKicker') }}</div>
            <h2 class="pub-h2 short__title">{{ t('terms.shortTitle') }}</h2>
            <ul class="pub-facts">
              <li v-for="rule in RULES" :key="rule.key" class="pub-fact short__rule">
                <span class="pub-fact__icon pub-fact__icon--sm" :class="rule.ok ? 'pub-fact__icon--ok' : 'pub-fact__icon--no'">
                  <q-icon :name="rule.ok ? 'o_check' : 'o_close'" size="15px" />
                </span>
                <span class="pub-fact__text">{{ t(`terms.${rule.key}`) }}</span>
              </li>
            </ul>
          </section>

          <LinkCard navy icon="o_mail" :title="t('terms.consentTitle')" :text="t('terms.consentText')" to="/kontakt" />
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

const SECTIONS = ['p1', 'p2'] as const;

const RULES = [
  { key: 'can1', ok: true },
  { key: 'can2', ok: true },
  { key: 'cannot1', ok: false },
];
</script>

<style scoped lang="sass">
.terms
  padding: 12px 44px 40px

@media (max-width: 599px)
  .terms
    padding: 4px 18px 22px

.terms__section
  display: flex
  gap: 22px
  padding: 28px 0
  border-bottom: 1px solid $divider-soft
  &:last-child
    padding-bottom: 0
    border-bottom: none

.terms__num
  flex-shrink: 0
  width: 40px
  height: 40px
  display: flex
  align-items: center
  justify-content: center
  border-radius: 50%
  background: #F1EADB
  color: $primary
  font-family: $serif
  font-size: 18px
  font-weight: 600

.terms__body
  display: flex
  flex-direction: column
  gap: 8px

.terms__title
  margin: 0
  font-family: $serif
  font-size: 24px
  font-weight: 600
  line-height: 1.2
  color: $ink

.terms__text
  margin: 0
  font-size: 15.5px
  line-height: 1.7
  color: #3A362E

.short
  display: flex
  flex-direction: column
  gap: 4px

.short__title
  margin-bottom: 10px

.short__rule
  padding: 12px 0
  gap: 12px
</style>
