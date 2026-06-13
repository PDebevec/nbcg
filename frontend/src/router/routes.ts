import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/IndexPage.vue') },
      { path: 'catalog', component: () => import('pages/CatalogPage.vue') },
      { path: 'catalog/:id', component: () => import('pages/RecordDetailPage.vue') },
      { path: 'o-nama', component: () => import('pages/AboutPage.vue') },
      { path: 'uslovi-koriscenja', component: () => import('pages/TermsOfUsePage.vue') },
      { path: 'napredna-pretraga', component: () => import('pages/AdvancedSearchPage.vue') },
      { path: 'kontakt', component: () => import('pages/ContactPage.vue') },
      { path: 'profil', component: () => import('pages/ProfilePage.vue') },
    ],
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
