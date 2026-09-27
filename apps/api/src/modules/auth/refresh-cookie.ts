import type { Request, Response } from 'express';
import { API_PREFIX } from '../../config/api.constants.js';
import type { TokenPair } from './token.service.js';

/**
 * Browser clients keep the refresh token in an httpOnly cookie instead of JavaScript memory/storage
 * (DESIGN.md §7.1, DECISIONS D-034). They opt in by sending `X-Auth-Transport: cookie`:
 *  - login / 2FA verify / refresh / change-password then SET the cookie and omit `refreshToken` from the body;
 *  - refresh / logout READ the cookie when the body has no token.
 * CSRF: the cookie is SameSite=Strict, scoped to the auth routes, and only honoured together with the custom
 * header — which a cross-site page can't send without passing CORS (exact origins only, D-008).
 * Mobile/other clients omit the header and keep using tokens in the body.
 */
export const REFRESH_COOKIE = 'alora_rt';
export const TRANSPORT_HEADER = 'x-auth-transport';
const COOKIE_PATH = `/${API_PREFIX}/auth`;

export function wantsCookie(req: Request): boolean {
  return req.header(TRANSPORT_HEADER) === 'cookie';
}

export function readRefreshCookie(req: Request): string | undefined {
  if (!wantsCookie(req)) return undefined;
  for (const part of (req.header('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/** In cookie mode, moves the refresh token into the cookie; otherwise returns the tokens unchanged. */
export function deliverTokens<T extends TokenPair>(
  req: Request,
  res: Response,
  tokens: T,
  secure: boolean,
): T | Omit<T, 'refreshToken'> {
  if (!wantsCookie(req)) return tokens;
  const { refreshToken, ...rest } = tokens;
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires: new Date(tokens.refreshTokenExpiresAt),
  });
  return rest;
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: COOKIE_PATH });
}
