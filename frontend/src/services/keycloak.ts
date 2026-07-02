import Keycloak from 'keycloak-js';
import { reactive, readonly } from 'vue';

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
}

// ---------------------------------------------------------------------------
// Keycloak singleton
//
// Authorization Code flow with PKCE (public SPA client `nbcg-web`).
// The realm is configured with an audience mapper that adds `nbcg-api` to the
// issued access tokens, so the same token authorizes the NestJS backend.
// ---------------------------------------------------------------------------

const url = import.meta.env.VITE_KEYCLOAK_URL;
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
  return keycloak.logout({ redirectUri: window.location.origin + '/' });
}

/**
 * Return a valid access token, refreshing it first if it expires within the
 * next 30 seconds. Returns undefined when the user is not authenticated.
 */
export async function getValidToken(): Promise<string | undefined> {
  if (!keycloak.authenticated) return undefined;
  try {
    await keycloak.updateToken(30);
  } catch {
    // Refresh token expired / session ended — force a fresh login.
    await login();
    return undefined;
  }
  return keycloak.token;
}
