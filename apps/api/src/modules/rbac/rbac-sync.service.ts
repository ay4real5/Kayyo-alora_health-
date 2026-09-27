import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PERMISSION_CATALOGUE, ROLE_DEFAULT_PERMISSIONS, ROLES, type Role } from '@alora/shared';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Makes the database match the code on every start (DECISIONS D-022):
 *  - `permissions` gets every entry of PERMISSION_CATALOGUE (entries later removed from code are left in
 *    place so existing custom-role grants don't break),
 *  - the 11 built-in roles exist (agency_id NULL, is_system) with exactly ROLE_DEFAULT_PERMISSIONS.
 * Idempotent and safe from several instances at once. Reads first, then writes only the difference.
 */
@Injectable()
export class RbacSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<void> {
    const wanted = Object.entries(PERMISSION_CATALOGUE).flatMap(([resource, actions]) =>
      actions.map((action) => ({ resource, action })),
    );
    await this.prisma.permission.createMany({ data: wanted, skipDuplicates: true });
    const permissionIds = new Map(
      (await this.prisma.permission.findMany()).map((p) => [`${p.resource}:${p.action}`, p.id]),
    );

    await this.prisma.role.createMany({
      data: ROLES.map((name) => ({ name, agencyId: null, isSystem: true, description: describeRole(name) })),
      skipDuplicates: true, // the partial unique index on system-role names makes this race-safe
    });
    const systemRoles = await this.prisma.role.findMany({
      where: { agencyId: null, isSystem: true },
      include: { rolePermissions: true },
    });

    let added = 0;
    let removed = 0;
    for (const role of systemRoles) {
      const defaults = ROLE_DEFAULT_PERMISSIONS[role.name as Role];
      if (!defaults) continue; // a system role no longer in code: left alone
      const wantedIds = new Set(defaults.map((permission) => permissionIds.get(permission)!));
      const currentIds = new Set(role.rolePermissions.map((rp) => rp.permissionId));

      const toAdd = [...wantedIds].filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !wantedIds.has(id));
      if (toAdd.length) {
        await this.prisma.rolePermission.createMany({
          data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
          skipDuplicates: true,
        });
      }
      if (toRemove.length) {
        await this.prisma.rolePermission.deleteMany({
          where: { roleId: role.id, permissionId: { in: toRemove } },
        });
      }
      added += toAdd.length;
      removed += toRemove.length;
    }
    if (added || removed) this.logger.log(`System role permissions synced (+${added} / -${removed})`);
  }
}

function describeRole(role: Role): string {
  return `Built-in role: ${role.replaceAll('_', ' ')}`;
}
