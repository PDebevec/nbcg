import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Global guard that attempts JWT validation but never rejects.
 * If the token is valid, req.user is set by Passport.
 * If the token is missing or invalid, req.user is set to null.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // No token or invalid token — that's fine, we allow anonymous
    }
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest(_err: any, user: any, _info: any, _context: any, _status?: any) {
    return user || null;
  }
}
