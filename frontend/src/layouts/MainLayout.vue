<template>
  <q-layout view="lHh Lpr lFf" class="library-shell">
    <q-header class="bg-library-primary text-white" bordered>
      <q-toolbar class="q-px-md q-py-sm">
        <q-btn flat dense round icon="menu_book" aria-label="Menu" @click="toggleLeftDrawer" />

        <q-toolbar-title>
          <div class="text-weight-bold">NBCG Digital Library</div>
          <div class="text-caption text-blue-1">Catalog, records</div>
        </q-toolbar-title>

      </q-toolbar>
    </q-header>

    <q-drawer v-model="leftDrawerOpen" show-if-above bordered :width="280" class="bg-library-paper text-library-ink">
      <div class="q-pa-md column full-height">
        <div class="library-chip q-mb-lg">
          <q-icon name="auto_stories" size="18px" />
          <span>Digital Collections</span>
        </div>

        <q-list padding class="col">
          <EssentialLink v-for="link in mainLinks" :key="link.title" v-bind="link" />
        </q-list>

        <q-separator color="grey-4" class="q-my-sm" />

        <q-list padding>
          <EssentialLink v-bind="adminLink" />
        </q-list>
      </div>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import EssentialLink, { type EssentialLinkProps } from 'components/EssentialLink.vue';

const mainLinks: EssentialLinkProps[] = [
  {
    title: 'Home',
    icon: 'dashboard',
    link: '/',
  },
  {
    title: 'Catalog',
    icon: 'menu_book',
    link: '/catalog',
  },
  {
    title: 'Records',
    icon: 'inventory_2',
    link: '#',
  },
];

const adminLink: EssentialLinkProps = {
  title: 'Administration',
  icon: 'shield',
  link: '#',
};

const leftDrawerOpen = ref(false);

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value;
}
</script>

<style scoped lang="sass">
@use 'sass:color'

.library-shell
  background: linear-gradient(180deg, color.adjust($paper, $lightness: 3%), $paper 35%, #ffffff)
  min-height: 100vh

.library-chip
  display: inline-flex
  align-items: center
  gap: 0.5rem
  padding: 0.45rem 0.85rem
  border-radius: 999px
  background: rgba($secondary, 0.14)
  color: $secondary
  font-weight: 600
</style>
