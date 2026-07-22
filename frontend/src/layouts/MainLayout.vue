<template>
  <q-layout view="lHh Lpr lff" class="library-shell">
    <q-header class="app-header" bordered>
      <q-toolbar class="header-toolbar q-px-md">
        <!-- LOGO -->
        <router-link to="/" class="logo-link">
          <img :src="logo" alt="Digitalna biblioteka Crne Gore" class="header-logo" />
        </router-link>

        <q-space />

        <!-- NAVIGATION -->
        <nav class="header-nav row items-center no-wrap">
          <q-btn
            v-for="link in headerLinks"
            :key="link.to"
            flat
            no-caps
            :icon="link.icon"
            :label="t(link.labelKey)"
            :to="link.to"
            :exact="link.exact"
            class="nav-btn"
            active-class="nav-btn--active"
          />

          <q-separator vertical inset class="q-mx-sm nav-divider" />

          <template v-if="auth.authenticated">
            <q-btn v-if="canAccessAdmin" flat round icon="admin_panel_settings" class="nav-user" to="/admin">
              <q-tooltip>{{ t('admin.title') }}</q-tooltip>
            </q-btn>
            <q-btn flat round icon="account_circle" class="nav-user" to="/profil">
              <q-tooltip>{{ auth.username || t('nav.profile') }}</q-tooltip>
            </q-btn>
            <q-btn
              flat
              no-caps
              icon="logout"
              :label="t('auth.logout')"
              class="nav-btn"
              @click="onLogout"
            />
          </template>
          <q-btn
            v-else
            unelevated
            no-caps
            color="primary"
            icon="login"
            :label="t('auth.login')"
            class="q-ml-xs"
            @click="onLogin"
          />

          <LanguageSwitcher class="q-ml-xs" />
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
    </q-header>

    <q-page-container>
      <router-view />
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
import { useI18n } from 'vue-i18n';
import logo from 'src/assets/logoV2_trimmed_white.jpg';
import LanguageSwitcher from 'components/LanguageSwitcher.vue';
import { auth, login, logout } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';

const { t } = useI18n();
const { canAccessAdmin } = useAuthz();

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
  background: linear-gradient(180deg, color.adjust($paper, $lightness: 3%), $paper 35%, #ffffff)
  min-height: 100vh

.app-header
  background: #ffffff
  color: $ink
  box-shadow: 0 2px 12px rgba($dark, 0.10)

.header-toolbar
  min-height: 72px
  max-width: 1280px
  width: 100%
  margin: 0 auto

.logo-link
  display: inline-flex
  align-items: center

.header-logo
  height: 56px
  width: auto
  display: block

.footer-logo
  height: 56px
  width: auto
  display: block
  background: #ffffff
  border-radius: 8px
  padding: 6px 10px

.header-nav
  gap: 2px

.nav-btn
  color: $dark
  font-weight: 500
  font-size: 0.84rem
  border-radius: 8px

  &--active
    color: $primary
    background: rgba($primary, 0.08)

.nav-divider
  height: 24px

.nav-user
  color: $dark

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
