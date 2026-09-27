/** Shapes returned by the API's /auth endpoints (see docs/api/openapi.json). */

export interface Me {
  id: string;
  agencyId: string;
  email: string;
  firstName: string;
  lastName: string;
  is2faEnabled: boolean;
  recoveryCodesRemaining: number | null;
  roles: string[];
  permissions: string[];
}

/** In cookie mode the refresh token is in an httpOnly cookie, so the body only carries the access token. */
export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
  mustChangePassword?: boolean;
}

export interface TwoFactorChallenge {
  requires2FA: true;
  twoFactorToken: string;
  expiresIn: number;
}

export type LoginOutcome =
  | { kind: 'signed-in'; mustChangePassword: boolean }
  | { kind: 'two-factor'; twoFactorToken: string };
