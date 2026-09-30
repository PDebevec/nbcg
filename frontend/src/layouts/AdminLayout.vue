<template>
  <!-- No q-header: every page brings its own AdminPageHeader. -->
  <q-layout view="lHh Lpr lFf" class="admin-shell">
    <!-- Always visible: desktop behavior prevents the mobile overlay mode -->
    <q-drawer :model-value="true" behavior="desktop" :width="248" class="admin-drawer">
      <div class="admin-drawer__inner">
        <router-link to="/" class="admin-drawer__logo">
          <img :src="logo" alt="Digitalna biblioteka Crne Gore" />
        </router-link>

        <q-list class="admin-drawer__nav">
          <q-item-label header class="admin-drawer__group">{{ t('admin.nav.groupCatalogue') }}</q-item-label>
          <q-item clickable to="/admin" exact active-class="admin-drawer__item--active" class="admin-drawer__item">
            <q-item-section avatar><q-icon name="o_dashboard" /></q-item-section>
            <q-item-section>{{ t('admin.nav.dashboard') }}</q-item-section>
          </q-item>
          <q-item
            v-if="canManageDrafts"
            clickable
            to="/admin/drafts"
            active-class="admin-drawer__item--active"
            class="admin-drawer__item"
          >
            <q-item-section avatar><q-icon name="o_edit_note" /></q-item-section>
            <q-item-section>{{ t('admin.nav.drafts') }}</q-item-section>
          </q-item>
          <q-item
            v-if="canManageRecords"
            clickable
            to="/admin/records"
            active-class="admin-drawer__item--active"
            class="admin-drawer__item"
          >
            <q-item-section avatar><q-icon name="o_menu_book" /></q-item-section>
            <q-item-section>{{ t('admin.nav.records') }}</q-item-section>
          </q-item>
          <q-item
            v-if="canImport"
            clickable
            to="/admin/import"
            active-class="admin-drawer__item--active"
            class="admin-drawer__item"
          >
            <q-item-section avatar><q-icon name="o_cloud_download" /></q-item-section>
            <q-item-section>{{ t('admin.nav.import') }}</q-item-section>
          </q-item>

          <template v-if="isStaff">
            <q-item-label header class="admin-drawer__group">{{ t('admin.nav.groupWork') }}</q-item-label>
            <q-item
              clickable
              to="/admin/tasks"
              active-class="admin-drawer__item--active"
              class="admin-drawer__item"
            >
              <q-item-section avatar><q-icon name="o_assignment_turned_in" /></q-item-section>
              <q-item-section>{{ t('admin.nav.tasks') }}</q-item-section>
              <q-item-section v-if="taskCount.open > 0" side>
                <q-badge class="badge-soft badge-soft--sm badge-soft--accent admin-drawer__count">
                  {{ taskCount.open }}
                </q-badge>
              </q-item-section>
            </q-item>
          </template>

          <q-item-label header class="admin-drawer__group">{{ t('admin.nav.groupInsight') }}</q-item-label>
          <q-item clickable to="/admin/stats" active-class="admin-drawer__item--active" class="admin-drawer__item">
            <q-item-section avatar><q-icon name="o_bar_chart" /></q-item-section>
            <q-item-section>{{ t('admin.nav.stats') }}</q-item-section>
          </q-item>
        </q-list>

        <q-space />

        <div class="admin-drawer__foot">
          <router-link to="/profil" class="admin-drawer__user">
            <UserAvatar :name="displayName" :size="34" />
            <div class="admin-drawer__user-text">
              <span class="admin-drawer__user-name ellipsis">{{ displayName }}</span>
              <span class="admin-drawer__user-role ellipsis">{{ roleCaption }}</span>
            </div>
          </router-link>
          <div class="row no-wrap q-gutter-x-xs">
            <q-btn
              outline
              no-caps
              dense
              icon="o_arrow_back"
              :label="t('admin.backToSite')"
              to="/"
              class="col admin-drawer__btn"
            />
            <LanguageSwitcher class="admin-drawer__btn admin-drawer__lang" />
          </div>
        </div>
      </div>
    </q-drawer>

    <q-page-container>
      <!-- Keyed on the path: /admin/items/new → /admin/items/:id and records ↔ drafts get a fresh
           page instance (and fresh leave guards); a query change (?tab=, ?task=) does not remount. -->
      <router-view :key="route.path" />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import logo from 'src/assets/logoV3_trimmed_white.jpg';
import LanguageSwitcher from 'components/LanguageSwitcher.vue';
import UserAvatar from 'components/admin/UserAvatar.vue';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { useSchemaStore } from 'src/stores/schema-store';
import { useTaskCountStore } from 'src/stores/task-count-store';

const { t } = useI18n();
const route = useRoute();
const { canManageRecords, canManageDrafts, canTransition, canImport, canManageUsers, isStaff } =
  useAuthz();
const taskCount = useTaskCountStore();

const displayName = computed(() => auth.fullName || auth.username || '');

const roleCaption = computed(() => {
  const role = canManageUsers.value
    ? t('admin.shell.roles.admin')
    : canTransition.value
      ? t('admin.shell.roles.editor')
      : isStaff.value
        ? t('admin.shell.roles.cataloguer')
        : t('admin.shell.roles.reader');
  return canTransition.value ? `${role} · ${t('admin.shell.canPublish')}` : role;
});

// The admin look is scoped on <body>, because dialogs and menus are
// teleported there (see src/css/admin.sass).
onMounted(() => {
  document.body.classList.add('admin-body');
  // Code lists and field captions for the whole admin area; loaded once per session.
  void useSchemaStore().load();
});
onBeforeUnmount(() => document.body.classList.remove('admin-body'));

// No notifications exist, so keep the count fresh on every navigation.
watch(
  () => route.fullPath,
  () => {
    if (isStaff.value) void taskCount.refresh();
  },
  { immediate: true },
);
</script>

<style scoped lang="sass">
.admin-shell
  background: $paper
  min-height: 100vh

// The class lands on the drawer's content element.
.admin-drawer
  background: $primary

.admin-drawer__inner
  display: flex
  flex-direction: column
  min-height: 100%
  padding: 20px 14px
  box-sizing: border-box
  background: $primary

.admin-drawer__logo
  display: flex
  align-items: center
  justify-content: center
  background: #fff
  border-radius: $radius
  padding: 12px 14px
  margin-bottom: 18px
  img
    width: 100%
    height: auto
    display: block

.admin-drawer__nav
  padding: 0
  display: flex
  flex-direction: column
  gap: 2px

.admin-drawer__group
  padding: 14px 12px 6px
  font-size: 11px
  line-height: 1.4
  letter-spacing: 0.12em
  text-transform: uppercase
  font-weight: 600
  color: #8E97B3

.admin-drawer__item
  min-height: 44px
  padding: 0 12px
  border-radius: $radius
  color: #C9CEDD
  font-size: 14.5px
  font-weight: 500
  &:hover
    color: #fff
    background: rgba(250, 247, 240, 0.07)

  :deep(.q-item__section--avatar)
    min-width: 0
    padding-right: 12px
    color: inherit

  :deep(.q-icon)
    font-size: 20px

  :deep(.q-focus-helper)
    display: none

.admin-drawer__item--active
  color: #fff
  background: rgba(250, 247, 240, 0.13)
  font-weight: 600

.admin-drawer__count
  font-weight: 700
  font-size: 12px

.admin-drawer__foot
  display: flex
  flex-direction: column
  gap: 10px
  padding-top: 14px
  border-top: 1px solid rgba(250, 247, 240, 0.14)

.admin-drawer__user
  display: flex
  align-items: center
  gap: 12px
  padding: 6px 8px
  border-radius: $radius
  text-decoration: none
  color: #fff
  &:hover
    color: #fff
    background: rgba(250, 247, 240, 0.07)

.admin-drawer__user-text
  display: flex
  flex-direction: column
  min-width: 0

.admin-drawer__user-name
  font-size: 14px
  font-weight: 600
  line-height: 1.2

.admin-drawer__user-role
  font-size: 12px
  color: #A9B0C7

.admin-drawer__btn
  min-height: 40px
  color: #E8E4D8 !important
  font-size: 13px
  font-weight: 500
  border-radius: $radius
  &:before
    border-color: rgba(250, 247, 240, 0.22) !important

.admin-drawer__lang
  border: 1px solid rgba(250, 247, 240, 0.22)
  font-weight: 600
</style>
