import { SetMetadata } from '@nestjs/common';

export const SCOPES_KEY = 'required_scopes';

/**
 * Requires the principal to hold ALL listed scopes (AND semantics).
 * Checked by ScopesGuard. Anonymous requests are rejected with 401.
 */
export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(SCOPES_KEY, scopes);
