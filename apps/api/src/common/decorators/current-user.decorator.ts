import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The authenticated caller, set by JwtAuthGuard from the verified access token. */
export interface AuthUser {
  userId: string;
  agencyId: string;
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
