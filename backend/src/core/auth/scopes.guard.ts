import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from './scopes.decorator';
import { createAnonymousPrincipal, Principal } from './principal.type';

/**
 * Global guard that:
 * 1. Normalizes req.user (set by OptionalJwtGuard) into req.principal.
 * 2. If @RequireScopes() is present, enforces that the principal holds all listed scopes.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Normalize principal from Passport user (set by OptionalJwtGuard)
    if (!request.principal) {
      const user = request.user;
      if (user) {
        request.principal = {
          sub: user.sub,
          username: user.username,
          email: user.email,
          scopes: new Set(user.scopes as string[]),
          isAnonymous: false,
        } satisfies Principal;
      } else {
        request.principal = createAnonymousPrincipal();
      }
    }

    // Check static @RequireScopes metadata
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes || requiredScopes.length === 0) return true;

    const principal: Principal = request.principal;

    if (principal.isAnonymous) {
      throw new UnauthorizedException();
    }

    const hasAll = requiredScopes.every((s) => principal.scopes.has(s));
    if (!hasAll) {
      throw new ForbiddenException('Insufficient scopes');
    }

    return true;
  }
}
