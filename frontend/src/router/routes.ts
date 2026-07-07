import type { RouteRecordRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    /** Keycloak scopes the user must ALL hold (checked in router guard). */
    scopes?: string[];
  }
}

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
      {
        path: 'profil',
        component: () => import('pages/ProfilePage.vue'),
        meta: { requiresAuth: true },
      },
    ],
  },

  {
    path: '/admin',
    component: () => import('layouts/AdminLayout.vue'),
    meta: {
      requiresAuth: true,
      scopes: ['drafts:view:hidden', 'records:view:hidden'],
    },
    children: [
      { path: '', component: () => import('pages/admin/AdminDashboardPage.vue') },
      {
        path: 'records',
        component: () => import('pages/admin/AdminItemsPage.vue'),
        props: { collection: 'records' },
        meta: { scopes: ['records:manage'] },
      },
      {
        path: 'drafts',
        component: () => import('pages/admin/AdminItemsPage.vue'),
        props: { collection: 'drafts' },
        meta: { scopes: ['drafts:manage'] },
      },
      { path: 'items/new', component: () => import('pages/admin/AdminItemEditPage.vue') },
      { path: 'items/:id', component: () => import('pages/admin/AdminItemEditPage.vue') },
      {
        path: 'import',
        component: () => import('pages/admin/AdminImportPage.vue'),
        meta: { scopes: ['import:execute'] },
      },
    ],
  },

  {
    path: '/403',
    component: () => import('pages/ForbiddenPage.vue'),
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
