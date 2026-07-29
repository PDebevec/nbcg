import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as jwksRsa from 'jwks-rsa';
import type { Request } from 'express';

/**
 * Cookie fallback for browser-native loads (<img src>, <a href>) that cannot
 * carry an Authorization header. Accepted ONLY for the streaming download GET —
 * every other endpoint stays Bearer-only, which keeps CSRF a non-issue (the
 * one cookie-authenticated route is an idempotent GET with no side effects).
 * The Authorization header wins when both are present (extractor order below).
 */
const TOKEN_COOKIE = 'nbcg_at';
const DOWNLOAD_PATH = /^\/api\/files\/[^/]+\/download\/?$/;

function downloadCookieExtractor(req: Request): string | null {
  if (req.method !== 'GET' || !DOWNLOAD_PATH.test(req.path)) return null;
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`).exec(cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

@Injectable()
export class KeycloakJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        downloadCookieExtractor,
      ]),
      audience: process.env.KEYCLOAK_CLIENT_ID,
      issuer: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`,
      algorithms: ['RS256'],
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
      }),
    });
  }

  async validate(payload: any) {
    const clientId = process.env.KEYCLOAK_CLIENT_ID ?? 'nbcg-api';
    const clientRoles: string[] =
      payload.resource_access?.[clientId]?.roles ?? [];

    return {
      sub: payload.sub,
      username: payload.preferred_username,
      email: payload.email,
      scopes: clientRoles,
    };
  }
}
