<template>
  <q-layout view="lHh Lpr lFf" class="library-shell">
    <q-header class="app-header" bordered>
      <q-toolbar class="q-px-md">
        <!-- LOGO + TITLE -->
        <q-btn flat dense round icon="auto_stories" class="text-white q-mr-sm" to="/" :ripple="false" />
        <div>
          <div class="header-title">NBCG Digital Library</div>
          <div class="header-subtitle">National and Central Library</div>
        </div>

        <q-space />

        <!-- RIGHT ACTIONS -->
        <q-btn v-if="false" flat dense round icon="search" class="text-white" />
        <q-btn v-if="false" flat dense round icon="notifications_none" class="text-white q-ml-xs" />
        <q-btn flat dense round icon="account_circle" class="text-white q-ml-xs" />
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
void router;
</script>

<style scoped lang="sass">
@use 'sass:color'

.library-shell
  background: linear-gradient(180deg, color.adjust($paper, $lightness: 3%), $paper 35%, #ffffff)
  min-height: 100vh

.app-header
  background: linear-gradient(90deg, $primary 0%, color.adjust($primary, $lightness: -10%) 100%)
  color: white
  box-shadow: 0 2px 12px rgba($dark, 0.18)

.header-title
  font-size: 1rem
  font-weight: 700
  line-height: 1.2
  color: white
  letter-spacing: 0.01em

.header-subtitle
  font-size: 0.65rem
  font-weight: 400
  letter-spacing: 0.06em
  color: rgba(white, 0.60)
  text-transform: uppercase
</style>
