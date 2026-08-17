<template>
  <q-layout view="lHh Lpr lff" class="library-shell">
    <q-header reveal class="app-header" bordered>
      <div class="toolbar-shadow">
      <q-toolbar class="header-toolbar q-px-md">
        <!-- LOGO -->
        <router-link to="/" class="logo-link">
          <img :src="logo" alt="Digitalna biblioteka Crne Gore" class="header-logo" />
        </router-link>

        <q-space />

        <q-btn
          v-if="isCatalog && !searchOpen"
          flat dense round
          icon="search"
          class="nav-user"
          @click="searchOpen = true"
        >
          <q-tooltip>{{ t('catalog.showSearch') }}</q-tooltip>
        </q-btn>

        <!-- NAVIGATION -->
        <nav class="header-nav row items-center no-wrap">
          <q-btn
            v-for="link in headerLinks"
            :key="link.to"
            flat
            no-caps
            :label="t(link.labelKey)"
            :to="link.to"
            class="nav-btn"
            :class="{ 'nav-btn--active': isLinkActive(link.to, link.exact) }"
          />

          <q-separator vertical class="nav-divider q-mx-md" />

          <template v-if="auth.authenticated">
            <q-btn
              v-if="canAccessAdmin"
              flat
              icon="admin_panel_settings"
              class="nav-btn nav-user"
              :class="{ 'nav-btn--active': isLinkActive('/admin') }"
              to="/admin"
            >
              <q-tooltip>{{ t('admin.title') }}</q-tooltip>
            </q-btn>
            <q-btn
              flat
              icon="account_circle"
              class="nav-btn nav-user"
              :class="{ 'nav-btn--active': isLinkActive('/profil') }"
              to="/profil"
            >
              <q-tooltip>{{ auth.username || t('nav.profile') }}</q-tooltip>
            </q-btn>
            <q-btn flat icon="logout" class="nav-btn nav-user" @click="onLogout">
              <q-tooltip>{{ t('auth.logout') }}</q-tooltip>
            </q-btn>
          </template>
          <q-btn
            v-else
            unelevated
            no-caps
            color="primary"
            icon="login"
            :label="t('auth.login')"
            class="nav-login self-center"
            @click="onLogin"
          />

          <q-separator vertical class="nav-divider q-mx-md" />

          <LanguageSwitcher />
        </nav>

        <!-- MOBILE MENU -->
        <q-btn flat dense round icon="menu" class="nav-menu-btn text-library-ink">
          <q-menu>
            <q-list style="min-width: 200px">
              <q-item
                v-for="link in navLinks"
                :key="link.to"
                clickable
                v-close-popup
                :to="link.to"
                :exact="link.exact"
              >
                <q-item-section avatar>
                  <q-icon :name="link.icon" color="primary" />
                </q-item-section>
                <q-item-section>{{ t(link.labelKey) }}</q-item-section>
              </q-item>
              <q-separator />
              <q-item v-if="auth.authenticated && canAccessAdmin" clickable v-close-popup to="/admin">
                <q-item-section avatar>
                  <q-icon name="admin_panel_settings" color="primary" />
                </q-item-section>
                <q-item-section>{{ t('admin.title') }}</q-item-section>
              </q-item>
              <q-item v-if="auth.authenticated" clickable v-close-popup to="/profil">
                <q-item-section avatar>
                  <q-icon name="account_circle" color="primary" />
                </q-item-section>
                <q-item-section>{{ auth.username || t('nav.profile') }}</q-item-section>
              </q-item>
              <q-item v-if="auth.authenticated" clickable v-close-popup @click="onLogout">
                <q-item-section avatar>
                  <q-icon name="logout" color="primary" />
                </q-item-section>
                <q-item-section>{{ t('auth.logout') }}</q-item-section>
              </q-item>
              <q-item v-else clickable v-close-popup @click="onLogin">
                <q-item-section avatar>
                  <q-icon name="login" color="primary" />
                </q-item-section>
                <q-item-section>{{ t('auth.login') }}</q-item-section>
              </q-item>
              <q-separator />
              <q-item>
                <q-item-section>
                  <LanguageSwitcher />
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
      </div>

      <!-- CATALOG SEARCH ROW -->
      <template v-if="isCatalog">
        <q-slide-transition>
          <div v-show="searchOpen">
            <q-separator color="library-divider" />
            <div class="search-row row items-center no-wrap q-px-md q-py-sm">
              <q-btn
                flat dense round
                icon="expand_less"
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
                  <q-icon name="search" size="18px" color="library-muted" />
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
    <q-footer class="app-footer">
      <div class="footer-main q-px-md q-py-xl">
        <div class="footer-body row q-col-gutter-xl">
          <div class="col-12 col-md-5">
            <img :src="logo" alt="Digitalna biblioteka Crne Gore" class="footer-logo q-mb-md" />
            <div class="footer-heading">{{ t('footer.mission') }}</div>
            <p class="footer-text">{{ t('footer.missionText') }}</p>
          </div>

          <div class="col-6 col-md-3">
            <div class="footer-heading">{{ t('footer.navigation') }}</div>
            <div class="column q-gutter-xs">
              <router-link
                v-for="link in navLinks"
                :key="link.to"
                :to="link.to"
                class="footer-link"
              >{{ t(link.labelKey) }}</router-link>
            </div>
          </div>

          <div class="col-6 col-md-4">
            <div class="footer-heading">{{ t('footer.contact') }}</div>
            <div class="footer-text">
              <div class="row items-center q-gutter-sm q-mb-xs">
                <q-icon name="call" size="18px" />
                <span>{{ t('footer.phone') }}</span>
              </div>
              <div class="row items-center q-gutter-sm">
                <q-icon name="mail" size="18px" />
                <a href="mailto:info@dlib.me" class="footer-link-inline">{{ t('footer.email') }}</a>
              </div>
            </div>
            <div class="row q-gutter-sm q-mt-md">
              <q-btn
                round
                unelevated
                icon="fab fa-facebook-f"
                class="footer-social"
                href="https://www.facebook.com"
                target="_blank"
              >
                <q-tooltip>Facebook</q-tooltip>
              </q-btn>
              <q-btn
                round
                unelevated
                icon="fab fa-twitter"
                class="footer-social"
                href="https://www.twitter.com"
                target="_blank"
              >
                <q-tooltip>Twitter</q-tooltip>
              </q-btn>
            </div>
          </div>
        </div>
      </div>

      <div class="footer-bottom q-px-md q-py-sm text-center">
        {{ year }} &nbsp;{{ t('footer.copyright') }}
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
import LanguageSwitcher from 'components/LanguageSwitcher.vue';
import { auth, login, logout } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { useCatalogSearch } from 'src/composables/useCatalogSearch';

const { t } = useI18n();
const $q = useQuasar();
const { canAccessAdmin } = useAuthz();
const route = useRoute();

const { searchText, fullText, searchOpen } = useCatalogSearch();
const isCatalog = computed(() => route.path === '/catalog');

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
  { labelKey: 'nav.home', to: '/', icon: 'home', exact: true },
  { labelKey: 'nav.about', to: '/o-nama', icon: 'info', exact: false },
  { labelKey: 'nav.terms', to: '/uslovi-koriscenja', icon: 'gavel', exact: false },
  { labelKey: 'nav.advancedSearch', to: '/napredna-pretraga', icon: 'manage_search', exact: false },
  { labelKey: 'nav.contact', to: '/kontakt', icon: 'mail', exact: false },
];

// Advanced search is hidden in the header (keeps the toolbar on one line);
// it stays reachable through the footer and mobile menu.
const headerLinks = navLinks.filter((l) => l.to !== '/napredna-pretraga');
</script>

<style scoped lang="sass">
@use 'sass:color'

.library-shell
  background: linear-gradient(180deg, $surface, $paper 35%, $surface)
  min-height: 100vh

.app-header
  background: $surface
  color: $ink
  box-shadow: 0 2px 12px rgba($dark, 0.10)

// Full-width wrapper so the toolbar's shadow spans the header and falls
// onto the catalog search row below it
.toolbar-shadow
  position: relative
  z-index: 1
  background: $surface
  box-shadow: 0 1px 3px rgba($dark, 0.06)

// Matches the catalog search row height (dense input + q-py-sm)
.header-toolbar
  min-height: 56px
  width: 100%

.logo-link
  display: inline-flex
  align-items: center

.header-logo
  height: 40px
  width: auto
  display: block

.footer-logo
  height: 56px
  width: auto
  display: block
  background: $surface
  border-radius: 8px
  padding: 6px 10px

.header-nav
  gap: 4px
  align-self: stretch

  .lang-switcher
    height: 100%
    border-radius: 0

.nav-btn
  color: $dark
  font-weight: 500
  font-size: 0.88rem
  border-radius: 0
  height: 100%
  padding: 0 14px
  position: relative

  &--active
    color: $primary
    background: rgba($primary, 0.04)
    &::after
      content: ''
      position: absolute
      left: 0
      right: 0
      bottom: -1px
      height: 3px
      background: $primary
      z-index: 1

.nav-login
  border-radius: 8px
  min-height: 40px
  padding: 0 16px

.nav-divider
  height: 22px
  align-self: center

.nav-user
  color: $dark
  padding: 0 10px

.nav-menu-btn
  display: none

@media (max-width: 1023px)
  .header-nav
    display: none
  .nav-menu-btn
    display: inline-flex


// FOOTER
.app-footer
  background: linear-gradient(160deg, $dark 0%, color.adjust($primary, $lightness: -22%) 100%)
  color: rgba(white, 0.82)

.footer-body
  max-width: 1280px
  margin: 0 auto

.footer-heading
  font-size: 0.78rem
  font-weight: 700
  letter-spacing: 0.10em
  text-transform: uppercase
  color: $secondary
  margin-bottom: 12px

.footer-text
  font-size: 0.88rem
  line-height: 1.6
  color: rgba(white, 0.72)

.footer-link
  color: rgba(white, 0.72)
  text-decoration: none
  font-size: 0.88rem
  transition: color 0.15s
  &:hover
    color: white

.footer-link-inline
  color: rgba(white, 0.72)
  text-decoration: none
  &:hover
    color: white

.footer-social
  background: rgba(white, 0.10)
  color: white
  &:hover
    background: $secondary

.footer-bottom
  background: rgba(black, 0.28)
  font-size: 0.82rem
  color: rgba(white, 0.6)
</style>
