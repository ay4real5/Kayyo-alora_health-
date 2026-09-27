import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../../database/prisma.service.js';

export interface UserAccess {
  roles: string[];
  permissions: Set<string>;
}

const CACHE_TTL_MS = 30_000;

/**
 * Resolves a user's roles and permissions: user_roles → roles (system roles, or custom roles of the user's
 * OWN agency — never another agency's) → role_permissions. Cached per user for 30 s, so a role change takes
 * effect within 30 s on every API instance; call invalidate() after changing roles for instant effect here.
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, { access: UserAccess; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async forUser(user: AuthUser): Promise<UserAccess> {
    const key = `${user.agencyId}:${user.userId}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.access;

    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId: user.userId,
        user: { agencyId: user.agencyId, isActive: true },
        role: { OR: [{ agencyId: null, isSystem: true }, { agencyId: user.agencyId }] },
      },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });

    const access: UserAccess = {
      roles: userRoles.map(({ role }) => role.name).sort(),
      permissions: new Set(
        userRoles.flatMap(({ role }) =>
          role.rolePermissions.map(({ permission }) => `${permission.resource}:${permission.action}`),
        ),
      ),
    };
    this.cache.set(key, { access, expiresAt: Date.now() + CACHE_TTL_MS });
    return access;
  }

  /**
   * Access granted by a set of roles (only built-in roles and the agency's own custom roles count).
   * Unlike forUser, ignores whether the user is active — for judging deactivated accounts. Not cached.
   */
  async forRoles(roleIds: string[], agencyId: string): Promise<UserAccess> {
    const roles = await this.prisma.role.findMany({
      where: {
        id: { in: roleIds },
        OR: [{ agencyId: null, isSystem: true }, { agencyId }],
      },
      include: { rolePermissions: { include: { permission: true } } },
    });
    return {
      roles: roles.map((role) => role.name).sort(),
      permissions: new Set(
        roles.flatMap((role) =>
          role.rolePermissions.map(({ permission }) => `${permission.resource}:${permission.action}`),
        ),
      ),
    };
  }

  invalidate(user?: AuthUser): void {
    if (user) this.cache.delete(`${user.agencyId}:${user.userId}`);
    else this.cache.clear();
  }
}
