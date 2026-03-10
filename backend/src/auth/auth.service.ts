import { Injectable, ForbiddenException } from '@nestjs/common';
import { AuthUser } from './auth.type';

@Injectable()
export class AuthService {
  /**
   * Extract authenticated user from request
   */
  getUser(req: any): AuthUser {
    return req.user as AuthUser;
  }

  /**
   * Role check helper
   */
  hasRole(user: AuthUser, role: string): boolean {
    return user.roles.includes(role);
  }

  /**
   * Ownership check helper
   */
  assertOwner(user: AuthUser, ownerUserId: string) {
    if (user.userId !== ownerUserId) {
      throw new ForbiddenException('Not owner');
    }
  }

  /**
   * Admin override check
   */
  assertOwnerOrAdmin(user: AuthUser, ownerUserId: string) {
    if (user.userId === ownerUserId) return;
    if (this.hasRole(user, 'admin')) return;
    throw new ForbiddenException('Forbidden');
  }
}
