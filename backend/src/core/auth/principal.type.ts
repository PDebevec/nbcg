import { VisibilityStatus } from '../../../generated/prisma/enums';

export interface Principal {
  sub: string;
  username: string;
  email?: string;
  /**
   * "First Last" from the token's own name claims, never a database lookup.
   * Snapshotted onto every row this principal writes — see {@link Actor}.
   */
  displayName: string;
  scopes: Set<string>;
  isAnonymous: boolean;
}

export function createAnonymousPrincipal(): Principal {
  return {
    sub: 'anonymous',
    username: 'anonymous',
    displayName: 'Anonymous',
    scopes: new Set(),
    isAnonymous: true,
  };
}

export interface VisibilityFilter {
  records: VisibilityStatus[];
  drafts: VisibilityStatus[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
