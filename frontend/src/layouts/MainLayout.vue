<template>
  <q-layout view="lHh Lpr lff" class="library-shell">
    <!-- Public site shell (design canvas "NBCG Public Redesign", home board): a quiet
         72px header with the menu on the left and language + account as plain text on
         the right; the catalogue's search row still hangs under it until the catalogue
         page gets its own search band. -->
    <q-header reveal bordered class="site-header">
      <q-toolbar class="site-header__bar site-container">
        <router-link to="/" class="site-header__logo">
          <img :src="logo" alt="Digitalna biblioteka Crne Gore" />
        </router-link>

        <nav class="site-nav" :aria-label="t('nav.main')">
          <q-btn
            v-for="link in headerLinks"
            :key="link.to"
            flat
            no-caps
            :label="t(link.labelKey)"
            :to="link.to"
            class="site-nav__link"
            :class="{ 'site-nav__link--active': isLinkActive(link.to, link.exact) }"
            :aria-current="isLinkActive(link.to, link.exact) ? 'page' : undefined"
          />
          <template v-if="auth.authenticated && canAccessAdmin">
            <q-separator vertical class="site-header__sep" />
            <q-btn
              flat
              no-caps
              icon="o_shield"
              :label="t('admin.title')"
              to="/admin"
              class="site-nav__link site-nav__link--admin"
            />
          </template>
        </nav>

        <q-space />

        <div class="site-header__tools">
          <q-btn
            v-if="isCatalog && !searchOpen"
            flat
            dense
            round
            icon="o_search"
            class="site-header__icon-btn"
            @click="searchOpen = true"
          >
            <q-tooltip>{{ t('catalog.showSearch') }}</q-tooltip>
          </q-btn>

          <LanguageLinks />

          <q-separator vertical class="site-header__sep" />

          <q-btn
            v-if="!auth.authenticated"
            flat
            no-caps
            icon="o_login"
            :label="t('auth.login')"
            class="site-header__account"
            @click="onLogin"
          />
          <q-btn
            v-else
            flat
            no-caps
            icon="o_person"
            icon-right="o_expand_more"
            :label="displayName"
            class="site-header__account"
            :aria-label="t('nav.accountMenu', { name: displayName })"
          >
            <q-menu auto-close class="site-menu">
              <q-list>
                <q-item clickable to="/profil">
                  <q-item-section avatar><q-icon name="o_person" /></q-item-section>
                  <q-item-section>{{ t('nav.profile') }}</q-item-section>
                </q-item>
                <q-separator />
                <q-item clickable @click="onLogout">
                  <q-item-section avatar><q-icon name="o_logout" /></q-item-section>
                  <q-item-section>{{ t('auth.logout') }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>

        <!-- Below 1024px everything folds into one menu -->
        <q-btn flat dense round icon="o_menu" class="site-header__menu-btn" :aria-label="t('nav.menu')">
          <q-menu class="site-menu">
            <q-list style="min-width: 220px">
              <q-item
                v-for="link in navLinks"
                :key="link.to"
                clickable
                v-close-popup
                :to="link.to"
                :exact="link.exact"
              >
                <q-item-section avatar>
                  <q-icon :name="link.icon" />
                </q-item-section>
                <q-item-section>{{ t(link.labelKey) }}</q-item-section>
              </q-item>
              <q-separator />
              <q-item v-if="auth.authenticated && canAccessAdmin" clickable v-close-popup to="/admin">
                <q-item-section avatar><q-icon name="o_shield" /></q-item-section>
                <q-item-section>{{ t('admin.title') }}</q-item-section>
              </q-item>
              <q-item v-if="auth.authenticated" clickable v-close-popup to="/profil">
                <q-item-section avatar><q-icon name="o_person" /></q-item-section>
                <q-item-section>{{ displayName }}</q-item-section>
              </q-item>
              <q-item v-if="auth.authenticated" clickable v-close-popup @click="onLogout">
                <q-item-section avatar><q-icon name="o_logout" /></q-item-section>
                <q-item-section>{{ t('auth.logout') }}</q-item-section>
              </q-item>
              <q-item v-else clickable v-close-popup @click="onLogin">
                <q-item-section avatar><q-icon name="o_login" /></q-item-section>
                <q-item-section>{{ t('auth.login') }}</q-item-section>
              </q-item>
              <q-separator />
              <q-item>
                <q-item-section avatar><q-icon name="o_language" /></q-item-section>
                <q-item-section><LanguageLinks /></q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>

      <!-- CATALOG SEARCH ROW -->
      <template v-if="isCatalog">
        <q-slide-transition>
          <div v-show="searchOpen" class="site-search-row">
            <div class="site-container row items-center no-wrap q-py-sm">
              <q-btn
                flat dense round
                icon="o_expand_less"
                color="library-muted"
                @click="searchOpen = false"
              >
                <q-tooltip>{{ t('catalog.hideSearch') }}</q-tooltip>
              </q-btn>

              <q-input
                v-model="searchText"
                outlined dense
                debounce="350"
                :placeholder="t('catalog.searchWithin')"
                class="col q-mx-md"
              >
                <template #prepend>
                  <q-icon name="o_search" size="18px" color="library-muted" />
                </template>
                <template #append>
                  <q-btn
                    flat round dense
                    :icon="fullText ? 'manage_search' : 'text_fields'"
                    :color="fullText ? 'primary' : 'library-muted'"
                    size="sm"
                    @click="fullText = !fullText"
                  >
                    <q-tooltip>{{ fullText ? t('catalog.fullTextOn') : t('catalog.fullTextOff') }}</q-tooltip>
                  </q-btn>
                </template>
              </q-input>

              <q-btn
                flat dense no-caps
                :round="!$q.screen.gt.sm"
                icon="backspace"
                color="library-muted"
                :label="$q.screen.gt.sm ? t('catalog.clearSearch') : undefined"
                :disable="!searchText"
                @click="searchText = ''"
              />
            </div>
          </div>
        </q-slide-transition>
      </template>
    </q-header>

    <q-page-container>
      <router-view v-slot="{ Component }">
        <transition name="page-transition" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </q-page-container>

    <!-- FOOTER -->
    <q-footer class="site-footer">
      <div class="site-container site-footer__main">
        <div class="site-footer__brand">
          <span class="site-footer__logo">
            <img :src="logo" alt="Digitalna biblioteka Crne Gore" />
          </span>
          <div class="site-footer__eyebrow">{{ t('footer.mission') }}</div>
          <p class="site-footer__text">{{ t('footer.missionText') }}</p>
        </div>

        <div class="site-footer__col">
          <div class="site-footer__eyebrow">{{ t('footer.navigation') }}</div>
          <router-link
            v-for="link in footerLinks"
            :key="link.to"
            :to="link.to"
            class="site-footer__link"
          >{{ t(link.labelKey) }}</router-link>
        </div>

        <div class="site-footer__col">
          <div class="site-footer__eyebrow">{{ t('footer.contact') }}</div>
          <div class="site-footer__row">
            <q-icon name="o_place" size="18px" />
            <span>{{ t('footer.address') }}</span>
          </div>
          <div class="site-footer__row">
            <q-icon name="o_call" size="18px" />
            <span>{{ t('footer.phone') }}</span>
          </div>
          <div class="site-footer__row">
            <q-icon name="o_mail" size="18px" />
            <a href="mailto:info@dlib.me" class="site-footer__mail">{{ t('footer.email') }}</a>
          </div>
          <div class="site-footer__social">
            <q-btn
              round
              unelevated
              icon="fab fa-facebook-f"
              class="site-footer__social-btn"
              href="https://www.facebook.com"
              target="_blank"
              aria-label="Facebook"
            />
            <q-btn
              round
              unelevated
              icon="fab fa-twitter"
              class="site-footer__social-btn"
              href="https://www.twitter.com"
              target="_blank"
              aria-label="Twitter"
            />
          </div>
        </div>
      </div>

      <div class="site-footer__bottom">
        <div class="site-container site-footer__bottom-row">
          <span>{{ year }} {{ t('footer.copyright') }}</span>
          <router-link to="/uslovi-koriscenja" class="site-footer__bottom-link">{{ t('nav.terms') }}</router-link>
        </div>
      </div>
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import logo from 'src/assets/logoV3_trimmed_white.jpg';
import LanguageLinks from 'components/LanguageLinks.vue';
import { auth, login, logout } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { useCatalogSearch } from 'src/composables/useCatalogSearch';

const { t } = useI18n();
const $q = useQuasar();
const { canAccessAdmin } = useAuthz();
const route = useRoute();

const { searchText, fullText, searchOpen } = useCatalogSearch();
const isCatalog = computed(() => route.path === '/catalog');

const displayName = computed(() => auth.fullName || auth.username || t('nav.profile'));

function isLinkActive(to: string, exact = false) {
  return exact ? route.path === to : route.path.startsWith(to);
}

function onLogin() {
  void login('/profil');
}

function onLogout() {
  void logout();
}

const year = new Date().getFullYear();

const navLinks = [
  { labelKey: 'nav.home', to: '/', icon: 'o_home', exact: true },
  { labelKey: 'nav.about', to: '/o-nama', icon: 'o_info', exact: false },
  { labelKey: 'nav.terms', to: '/uslovi-koriscenja', icon: 'o_gavel', exact: false },
  { labelKey: 'nav.advancedSearch', to: '/napredna-pretraga', icon: 'o_manage_search', exact: false },
  { labelKey: 'nav.contact', to: '/kontakt', icon: 'o_mail', exact: false },
];

// Advanced search is hidden in the header (keeps the toolbar on one line);
// it stays reachable through the footer and mobile menu.
const headerLinks = navLinks.filter((l) => l.to !== '/napredna-pretraga');

const footerLinks = [
  { labelKey: 'nav.home', to: '/' },
  { labelKey: 'nav.catalog', to: '/catalog' },
  { labelKey: 'nav.advancedSearch', to: '/napredna-pretraga' },
  { labelKey: 'nav.about', to: '/o-nama' },
  { labelKey: 'nav.terms', to: '/uslovi-koriscenja' },
  { labelKey: 'nav.contact', to: '/kontakt' },
];
</script>

<style scoped lang="sass">
.library-shell
  background: $paper
  min-height: 100vh

// ── Header ─────────────────────────────────────────────────────────────────
.site-header
  background: $surface
  color: $ink
  border-bottom-color: $divider
  box-shadow: none

.site-header__bar
  min-height: 72px
  gap: 32px

.site-header__logo
  display: inline-flex
  align-items: center
  flex-shrink: 0
  img
    height: 44px
    width: auto
    display: block
    // The logo is a JPG on white: multiply hides the white box on the cream header
    mix-blend-mode: multiply

.site-nav
  display: flex
  align-items: stretch
  align-self: stretch
  gap: 4px
  margin-left: -16px

.site-nav__link
  padding: 0 14px
  font-size: 15px
  font-weight: 500
  color: $ink-soft
  border-radius: 0
  :deep(.q-icon)
    font-size: 17px
  :deep(.q-icon.on-left)
    margin-right: 8px

  &--active
    font-weight: 600
    color: $primary
    box-shadow: inset 0 -3px 0 $primary

  &--admin
    font-weight: 600
    color: $eyebrow

.site-header__sep
  height: 22px
  align-self: center
  background: $divider

.site-header__tools
  display: flex
  align-items: center
  gap: 18px

.site-header__icon-btn
  color: $ink-soft

.site-header__account
  min-height: 44px
  padding: 0 4px
  font-size: 14.5px
  font-weight: 600
  color: $primary
  border-radius: $radius
  :deep(.q-icon)
    font-size: 18px
  :deep(.q-icon.on-left)
    margin-right: 8px
  :deep(.q-icon.on-right)
    font-size: 16px
    margin-left: 6px

.site-header__menu-btn
  display: none
  color: $ink

@media (max-width: 1023px)
  .site-nav,
  .site-header__tools
    display: none
  .site-header__menu-btn
    display: inline-flex
  .site-header__bar
    min-height: 64px
    gap: 16px
  .site-header__logo img
    height: 38px

.site-search-row
  border-top: 1px solid $divider
  background: $surface

// ── Footer ─────────────────────────────────────────────────────────────────
.site-footer
  background: $navy-deep
  color: $on-navy

.site-footer__main
  display: grid
  grid-template-columns: minmax(0, 5fr) minmax(0, 3fr) minmax(0, 4fr)
  gap: 48px
  padding-top: 48px
  padding-bottom: 40px

@media (max-width: 1023px)
  .site-footer__main
    grid-template-columns: 1fr 1fr
    gap: 32px
  .site-footer__brand
    grid-column: 1 / -1

@media (max-width: 599px)
  .site-footer__main
    grid-template-columns: 1fr

.site-footer__brand,
.site-footer__col
  display: flex
  flex-direction: column
  align-items: flex-start
  gap: 12px

.site-footer__logo
  display: inline-block
  background: $paper
  border-radius: $radius
  padding: 8px 12px
  img
    height: 44px
    width: auto
    display: block

.site-footer__eyebrow
  font-size: 12px
  font-weight: 700
  letter-spacing: 0.1em
  text-transform: uppercase
  color: $gold

.site-footer__brand .site-footer__eyebrow
  margin-top: 8px

.site-footer__text
  margin: 0
  max-width: 460px
  font-size: 14.5px
  line-height: 1.6
  color: #B7BDD0

.site-footer__link
  font-size: 14.5px
  color: $on-navy-strong
  text-decoration: none
  transition: color 0.15s
  &:hover
    color: white

.site-footer__row
  display: flex
  align-items: flex-start
  gap: 10px
  font-size: 14.5px
  color: $on-navy-strong
  .q-icon
    flex-shrink: 0
    margin-top: 2px

.site-footer__mail
  color: $on-navy-strong
  text-decoration: underline
  text-underline-offset: 3px
  &:hover
    color: white

.site-footer__social
  display: flex
  gap: 8px
  margin-top: 6px

.site-footer__social-btn
  width: 40px
  height: 40px
  background: rgba($paper, 0.12)
  color: white
  &:hover
    background: $secondary

.site-footer__bottom
  border-top: 1px solid rgba($paper, 0.12)

.site-footer__bottom-row
  min-height: 52px
  display: flex
  align-items: center
  justify-content: space-between
  gap: 16px
  flex-wrap: wrap
  font-size: 13px
  color: $on-navy-muted

.site-footer__bottom-link
  color: #A9B0C7
  text-decoration: none
  &:hover
    color: white
</style>
