<template>
  <!-- Top-left "l" hands the corner to the drawer, so it runs full height beside the header -->
  <q-layout view="lHh Lpr lFf" class="admin-shell">
    <q-header class="admin-header">
      <q-toolbar class="q-px-md">
        <div class="admin-title">{{ t('admin.title') }}</div>

        <q-space />

        <div class="row items-center no-wrap q-gutter-xs">
          <q-btn flat no-caps icon="arrow_back" :label="t('admin.backToSite')" to="/" class="nav-btn" />
          <q-btn flat round icon="account_circle" class="nav-btn" to="/profil">
            <q-tooltip>{{ auth.username || t('nav.profile') }}</q-tooltip>
          </q-btn>
          <LanguageSwitcher />
        </div>
      </q-toolbar>
    </q-header>

    <!-- Always visible: desktop behavior prevents the mobile overlay mode -->
    <q-drawer :model-value="true" behavior="desktop" bordered :width="240" class="admin-drawer">
      <router-link to="/" class="logo-link q-py-md">
        <img :src="logo" alt="Digitalna biblioteka Crne Gore" class="header-logo" />
      </router-link>
      <q-separator />

      <q-list padding>
        <q-item clickable v-ripple to="/admin" exact active-class="drawer-item--active">
          <q-item-section avatar><q-icon name="dashboard" /></q-item-section>
          <q-item-section>{{ t('admin.nav.dashboard') }}</q-item-section>
        </q-item>
        <q-item
          v-if="canManageDrafts"
          clickable
          v-ripple
          to="/admin/drafts"
          active-class="drawer-item--active"
        >
          <q-item-section avatar><q-icon name="edit_note" /></q-item-section>
          <q-item-section>{{ t('admin.nav.drafts') }}</q-item-section>
        </q-item>
        <q-item
          v-if="canManageRecords"
          clickable
          v-ripple
          to="/admin/records"
          active-class="drawer-item--active"
        >
          <q-item-section avatar><q-icon name="library_books" /></q-item-section>
          <q-item-section>{{ t('admin.nav.records') }}</q-item-section>
        </q-item>
        <q-item
          v-if="canImport"
          clickable
          v-ripple
          to="/admin/import"
          active-class="drawer-item--active"
        >
          <q-item-section avatar><q-icon name="cloud_download" /></q-item-section>
          <q-item-section>{{ t('admin.nav.import') }}</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import logo from 'src/assets/logo.png';
import LanguageSwitcher from 'components/LanguageSwitcher.vue';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';

const { t } = useI18n();
const { canManageRecords, canManageDrafts, canImport } = useAuthz();
</script>

<style scoped lang="sass">
.admin-shell
  background: $paper
  min-height: 100vh

.admin-header
  background: #ffffff
  color: $ink
  box-shadow: none
  // Same divider as the q-separator under the drawer's logo container
  border-bottom: 1px solid rgba(0, 0, 0, 0.12)

  // Match the drawer's logo container height (36px logo + 2 × 16px q-py-md)
  .q-toolbar
    min-height: 68px

.admin-drawer
  background: #eceff1
  color: $ink

.drawer-item--active
  color: $primary
  background: rgba($primary, 0.08)
  font-weight: 600

.logo-link
  display: flex
  align-items: center
  justify-content: center

.header-logo
  height: 36px
  width: auto
  display: block

.admin-title
  font-size: 0.78rem
  font-weight: 700
  letter-spacing: 0.14em
  text-transform: uppercase
  color: $primary

.nav-btn
  color: $ink
  font-weight: 500
</style>
