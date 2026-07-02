<template>
  <q-page>
    <div class="sub-header q-px-md q-py-lg">
      <div class="page-body">
        <div class="header-kicker q-mb-xs">{{ t('common.library') }}</div>
        <h1 class="text-h4 text-weight-bold text-white q-my-none">{{ t('profile.title') }}</h1>
      </div>
    </div>

    <div class="page-body q-px-md q-py-xl">
      <div class="content-card q-pa-xl">
        <div class="text-center q-mb-lg">
          <q-icon name="account_circle" size="56px" color="primary" class="q-mb-sm" />
          <div class="text-h6 text-weight-bold text-library-primary">
            {{ auth.fullName || auth.username }}
          </div>
        </div>

        <q-list separator>
          <q-item>
            <q-item-section>
              <q-item-label caption>{{ t('profile.username') }}</q-item-label>
              <q-item-label>{{ auth.username || '—' }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>
              <q-item-label caption>{{ t('profile.email') }}</q-item-label>
              <q-item-label>{{ auth.email || '—' }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>
              <q-item-label caption>{{ t('profile.roles') }}</q-item-label>
              <q-item-label>
                <template v-if="auth.roles.length">
                  <q-chip
                    v-for="role in auth.roles"
                    :key="role"
                    dense
                    color="primary"
                    text-color="white"
                    :label="role"
                  />
                </template>
                <span v-else class="text-library-muted">{{ t('profile.noRoles') }}</span>
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>

        <div class="row justify-center q-gutter-sm q-mt-lg">
          <q-btn outline no-caps color="primary" :label="t('common.backHome')" icon="home" to="/" />
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="t('auth.logout')"
            icon="logout"
            @click="onLogout"
          />
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { auth, logout } from 'src/services/keycloak';

const { t } = useI18n();

function onLogout() {
  void logout();
}
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
