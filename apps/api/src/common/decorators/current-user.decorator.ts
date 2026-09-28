import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The authenticated caller, set by JwtAuthGuard from the verified access token. */
export interface AuthUser {
  userId: string;
  agencyId: string;
  /** Set when the user must set up 2FA before doing anything else (D-045). */
  twoFactorSetupRequired?: boolean;
  /** Set when the user must choose a new password before doing anything else (P4-09). */
  passwordChangeRequired?: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<Request>().user;
  if (!user) throw new Error('@CurrentUser() used on a route without authentication');
  return user;
});
