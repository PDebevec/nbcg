import { defineBoot } from '#q-app/wrappers';
import { api } from './axios';
import { keycloak, initKeycloak, getValidToken } from 'src/services/keycloak';

// ---------------------------------------------------------------------------
// Keycloak boot
//
// 1. Initializes the adapter (silent check-sso) before the app mounts.
// 2. Attaches a fresh Bearer token to every `api` request.
// 3. Exposes $keycloak on the global properties for Options-API components.
// ---------------------------------------------------------------------------

declare module 'vue' {
  interface ComponentCustomProperties {
    $keycloak: typeof keycloak;
  }
}

export default defineBoot(async ({ app }) => {
  await initKeycloak();

  app.config.globalProperties.$keycloak = keycloak;

  // Inject (and refresh) the access token on outgoing API calls.
  api.interceptors.request.use(async (config) => {
    const token = await getValidToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
});
