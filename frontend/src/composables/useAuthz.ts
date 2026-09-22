import { computed } from 'vue';
import { auth } from 'src/services/keycloak';

// ---------------------------------------------------------------------------
// Scope-based authorization helpers.
//
// Scopes come from the Keycloak token (resource roles of the API client) and
// are only used to shape the UI — every endpoint re-checks them server-side.
// ---------------------------------------------------------------------------

export function hasScope(scope: string): boolean {
  return auth.roles.includes(scope);
}

export function hasAllScopes(...scopes: string[]): boolean {
  return scopes.every((s) => auth.roles.includes(s));
}

/**
 * The router guard (`meta.scopes`) is AND-only, so a "holds at least one of"
 * rule can only be expressed here, for showing/hiding controls. The API's 403
 * remains the authority.
 */
export function hasAnyScope(...scopes: string[]): boolean {
  return scopes.some((s) => auth.roles.includes(s));
}

export function useAuthz() {
  const canAccessAdmin = computed(() =>
    hasAllScopes('drafts:view:hidden', 'records:view:hidden'),
  );
  const canManageRecords = computed(() => hasScope('records:manage'));
  const canManageDrafts = computed(() => hasScope('drafts:manage'));
  const canTransition = computed(() => canManageRecords.value && canManageDrafts.value);
  const canImport = computed(() => hasScope('import:execute'));
  // Mirrors the backend attribution bar exactly; if they ever disagree the
  // backend wins, because it strips the field from the response.
  const canSeeAttribution = computed(() => canManageDrafts.value || canManageRecords.value);
  const canManageUsers = computed(() => hasScope('users:manage'));
  // The bar for task delegation and the user directory: at least one write
  // capability. The same rule as canSeeAttribution, named for what it gates.
  const isStaff = computed(() => hasAnyScope('drafts:manage', 'records:manage'));

  return {
    canAccessAdmin,
    canManageRecords,
    canManageDrafts,
    canTransition,
    canImport,
    canSeeAttribution,
    canManageUsers,
    isStaff,
  };
}
