import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_DURING_2FA_SETUP_KEY } from '../../common/decorators/allow-during-2fa-setup.decorator.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { TokenService } from './token.service.js';

/**
 * Registered globally: every route needs `Authorization: Bearer <access token>` unless it's @Public().
 * Secure by default — forgetting a decorator locks a route down rather than exposing it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing access token');

    try {
      request.user = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // Mandatory 2FA not set up yet (D-045): only the setup routes work.
    if (
      request.user.twoFactorSetupRequired &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_2FA_SETUP_KEY, [context.getHandler(), context.getClass()])
    ) {
      throw new ForbiddenException({
        code: 'TWO_FACTOR_SETUP_REQUIRED',
        message: 'Your role requires two-factor authentication. Set it up to continue.',
      });
    }
    return true;
  }
}
