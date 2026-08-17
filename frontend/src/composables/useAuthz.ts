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

  return {
    canAccessAdmin,
    canManageRecords,
    canManageDrafts,
    canTransition,
    canImport,
    canSeeAttribution,
    canManageUsers,
  };
}
