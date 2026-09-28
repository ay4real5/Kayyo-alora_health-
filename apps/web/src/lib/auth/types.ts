/** Shapes returned by the API's /auth endpoints (see docs/api/openapi.json). */

export interface Me {
  id: string;
  agencyId: string;
  email: string;
  firstName: string;
  lastName: string;
  is2faEnabled: boolean;
  /** The user's role requires 2FA (D-045). */
  is2faRequired: boolean;
  /** Password never set or too old — every other API route answers 403 until it changes (P4-09). */
  mustChangePassword: boolean;
  /** IANA timezone of the agency — use it (not the browser clock) for "today". */
  agencyTimezone: string;
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
  /** 2FA is required for this role and not on yet: only setup works until it is (D-045). */
  mustEnable2fa?: boolean;
}

export interface TwoFactorChallenge {
  requires2FA: true;
  twoFactorToken: string;
  expiresIn: number;
}

export type LoginOutcome =
  | { kind: 'signed-in'; mustChangePassword: boolean; mustEnable2fa: boolean }
  | { kind: 'two-factor'; twoFactorToken: string };
