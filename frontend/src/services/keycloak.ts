import Keycloak from 'keycloak-js';
import { reactive, readonly } from 'vue';
import { Notify } from 'quasar';
import { i18n } from 'src/boot/i18n';

// ---------------------------------------------------------------------------
// Reactive auth state for the UI (keycloak's own props are not reactive)
// ---------------------------------------------------------------------------

interface AuthState {
  authenticated: boolean;
  username: string | undefined;
  email: string | undefined;
  fullName: string | undefined;
  roles: string[];
}

const state = reactive<AuthState>({
  authenticated: false,
  username: undefined,
  email: undefined,
  fullName: undefined,
  roles: [],
});

/** Read-only reactive snapshot of the current authentication state. */
export const auth = readonly(state);

// ---------------------------------------------------------------------------
// Token cookie for browser-native file loads
//
// <img src> / <a href> requests to /api/files/:id/download are sent by the
// browser itself, without the Authorization header. The backend accepts the
// token from this cookie on that one endpoint only. Path=/api/files keeps the
// cookie off every other API request.
// ---------------------------------------------------------------------------

const TOKEN_COOKIE = 'nbcg_at';

function syncTokenCookie() {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  if (keycloak.authenticated && keycloak.token) {
    document.cookie = `${TOKEN_COOKIE}=${keycloak.token}; Path=/api/files; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${TOKEN_COOKIE}=; Path=/api/files; SameSite=Lax; Max-Age=0${secure}`;
  }
}

function syncState() {
  const profile = keycloak.tokenParsed as
    | { preferred_username?: string; email?: string; name?: string }
    | undefined;
  const apiClientId = import.meta.env.VITE_KEYCLOAK_API_CLIENT_ID;

  state.authenticated = !!keycloak.authenticated;
  state.username = profile?.preferred_username;
  state.email = profile?.email;
  state.fullName = profile?.name;
  state.roles = keycloak.resourceAccess?.[apiClientId]?.roles ?? [];
  syncTokenCookie();
  if (state.authenticated) sessionExpiredNotified = false;
}

// ---------------------------------------------------------------------------
// Session expiry
//
// When the refresh token dies we deliberately do NOT redirect to Keycloak from
// inside an API call — that would blow away in-progress form state mid-request.
// Instead the request is left to fail (401/404), the UI flips to the anonymous
// state, and a persistent notification lets the user re-login when they choose.
// ---------------------------------------------------------------------------

let sessionExpiredNotified = false;

function handleSessionExpired() {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;

  // Drop the dead tokens — fires onAuthLogout → syncState, which updates the
  // reactive state and clears the download cookie.
  keycloak.clearToken();

  const t = i18n.global.t;
  Notify.create({
    type: 'warning',
    timeout: 0,
    multiLine: true,
    message: t('auth.sessionExpired'),
    actions: [
      {
        label: t('auth.login'),
        color: 'dark',
        noCaps: true,
        handler: () => {
          const path = window.location.hash.startsWith('#/')
            ? window.location.hash.slice(1)
            : undefined;
          void login(path);
        },
      },
      { icon: 'close', color: 'dark', round: true, dense: true },
    ],
  });
}

// ---------------------------------------------------------------------------
// Keycloak singleton
//
// Authorization Code flow with PKCE (public SPA client `nbcg-web`).
// The realm is configured with an audience mapper that adds `nbcg-api` to the
// issued access tokens, so the same token authorizes the NestJS backend.
// ---------------------------------------------------------------------------

// In prod, Keycloak is reachable under the SAME origin as this app (nginx
// proxies /auth/ path-based, on every hostname in available_hostnames). A
// build-time-baked absolute URL would pin the app to whichever hostname was
// canonical at build time — fine when browsed from that hostname, but the
// Keycloak adapter's 3rd-party-cookie-check and login-status iframes load
// cross-origin for every OTHER configured hostname, which their own
// X-Frame-Options: SAMEORIGIN then refuses to display, breaking init()
// entirely ("Timeout when waiting for 3rd party check iframe message").
// Deriving the origin at runtime from the page itself keeps every iframe
// same-origin no matter which hostname the browser used.
//
// Dev has no such shared origin — Keycloak runs on its own port, never
// behind nginx — so it keeps the absolute URL baked in by the CLI.
const url = import.meta.env.PROD
  ? `${window.location.origin}${import.meta.env.VITE_KEYCLOAK_BASE_PATH ?? '/auth'}`
  : import.meta.env.VITE_KEYCLOAK_URL;
const realm = import.meta.env.VITE_KEYCLOAK_REALM;
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;

if (!url || !realm || !clientId) {
  // Fail loud in dev so a missing .env is obvious instead of a silent no-auth state.
  console.error(
    '[keycloak] Missing config. Check VITE_KEYCLOAK_URL / VITE_KEYCLOAK_REALM / VITE_KEYCLOAK_CLIENT_ID in frontend/.env',
  );
}

export const keycloak = new Keycloak({ url, realm, clientId });

/** Resolves once init() has finished (success or failure). */
let initPromise: Promise<boolean> | null = null;

export function initKeycloak(): Promise<boolean> {
  if (initPromise) return initPromise;

  keycloak.onAuthSuccess = syncState;
  keycloak.onAuthRefreshSuccess = syncState;
  keycloak.onAuthLogout = syncState;

  initPromise = keycloak
    .init({
      // `check-sso` does NOT force a login — it silently restores an existing
      // session (if the user is already logged in at Keycloak) and otherwise
      // leaves the app in an anonymous state. Use keycloak.login() to log in.
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      pkceMethod: 'S256',
      // Query (not fragment) response mode plays nicely with the hash router.
      responseMode: 'query',
      // The login-status iframe is flaky behind some browsers / third-party
      // cookie restrictions; rely on token refresh instead.
      checkLoginIframe: false,
    })
    .then((authenticated) => {
      syncState();
      return authenticated;
    })
    .catch((err) => {
      console.error('[keycloak] init failed', err);
      return false;
    });

  return initPromise;
}

/** Redirect the browser to the Keycloak login page. */
export function login(redirectPath?: string): Promise<void> {
  return keycloak.login({
    redirectUri: window.location.origin + (redirectPath ? `/#${redirectPath}` : '/'),
  });
}

/** Log out and return to the home page. */
export function logout(): Promise<void> {
  // Clear explicitly — the logout redirect may fire before onAuthLogout runs
  document.cookie = `${TOKEN_COOKIE}=; Path=/api/files; SameSite=Lax; Max-Age=0`;
  return keycloak.logout({ redirectUri: window.location.origin + '/' });
}

/**
 * Return a valid access token, refreshing it first if it expires within the
 * next 30 seconds. Returns undefined when the user is not authenticated or
 * the session has expired (the caller's request then fails as anonymous).
 */
export async function getValidToken(): Promise<string | undefined> {
  if (!keycloak.authenticated) return undefined;
  try {
    await keycloak.updateToken(30);
  } catch {
    handleSessionExpired();
    return undefined;
  }
  return keycloak.token;
}
