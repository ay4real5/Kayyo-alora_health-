import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator.js';
import { PermissionsService } from './permissions.service.js';

/** Global guard, runs after JwtAuthGuard. Enforces @Permissions(); routes without it pass through. */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    // Defensive: @Permissions on a @Public() route, or guard order changed — never allow without a user.
    if (!user) throw new UnauthorizedException('Missing access token');

    const access = await this.permissions.forUser(user);
    if (!required.every((permission) => access.permissions.has(permission))) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
