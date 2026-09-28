import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsService } from '../rbac/permissions.service.js';

/**
 * `/portal` is for portal users only (D-058): staff get 403 here, just as portal users get 403 on staff routes (they
 * hold no permissions). Which patient they may see is checked per request by PortalService.
 */
@Injectable()
export class PortalUserGuard implements CanActivate {
  constructor(private readonly permissions: PermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) return false;
    const access = await this.permissions.forUser(user);
    if (!access.roles.includes('portal_user')) throw new ForbiddenException('The patient portal is for patients and families');
    return true;
  }
}
