import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { PrismaService } from '../../database/prisma.service.js';

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

/**
 * Roles a user of this agency can be given: the built-in roles plus the agency's own custom roles (DESIGN.md §6.15
 * list). Managing custom roles comes with settings (P4). Who may grant which role is decided in UsersService.
 */
@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions('users:read')
  @Get()
  async list(@CurrentUser() caller: AuthUser): Promise<RoleView[]> {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ agencyId: null, isSystem: true }, { agencyId: caller.agencyId }] },
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.rolePermissions.map(({ permission }) => `${permission.resource}:${permission.action}`).sort(),
    }));
  }
}
