import { VisibilityStatus } from '../../../generated/prisma/enums';

export interface Principal {
  sub: string;
  username: string;
  email?: string;
  scopes: Set<string>;
  isAnonymous: boolean;
}

export function createAnonymousPrincipal(): Principal {
  return {
    sub: 'anonymous',
    username: 'anonymous',
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
