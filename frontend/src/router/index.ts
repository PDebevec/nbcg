import { defineRouter } from '#q-app/wrappers';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';
import routes from './routes';
import { keycloak, login } from 'src/services/keycloak';
import { hasAllScopes } from 'src/composables/useAuthz';

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default defineRouter(function (/* { store, ssrContext } */) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  // Redirect to Keycloak login for routes flagged with `meta.requiresAuth`
  // (routes declaring `meta.scopes` implicitly require auth too).
  // A logged-in user missing any required scope gets the 403 page instead.
  Router.beforeEach((to) => {
    const requiredScopes = to.matched.flatMap((r) => r.meta.scopes ?? []);
    const needsAuth =
      to.matched.some((r) => r.meta.requiresAuth) || requiredScopes.length > 0;

    if (needsAuth && !keycloak.authenticated) {
      void login(to.fullPath);
      return false;
    }
    if (requiredScopes.length > 0 && !hasAllScopes(...requiredScopes)) {
      return '/403';
    }
    return true;
  });

  return Router;
});
