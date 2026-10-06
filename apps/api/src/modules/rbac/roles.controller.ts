import { PERMISSIONS, ROLES } from '@alora/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { trimmed } from '../../common/validators/fields.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PermissionsService } from './permissions.service.js';

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  /** Users in this agency who have the role. */
  users: number;
}

const ROLE_NAME = /^[a-z][a-z0-9_]{1,49}$/;

export class CreateRoleDto {
  /** lower_snake_case, e.g. `intake_coordinator`; must not be a built-in role name. */
  @Transform(trimmed)
  @Matches(ROLE_NAME, { message: 'name must be lower_snake_case, 2–50 characters (e.g. intake_coordinator)' })
  name!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions?: string[];
}

/**
 * Agency custom roles (D-099). Built-in roles are defined in code and read-only here. No privilege escalation: the
 * caller must already hold every permission a role carries — both before and after an edit — so nobody can create
 * or reshape a role beyond their own access.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(caller: AuthUser): Promise<RoleView[]> {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ agencyId: null, isSystem: true }, { agencyId: caller.agencyId }] },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: { where: { user: { agencyId: caller.agencyId } } } } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.rolePermissions.map(({ permission }) => `${permission.resource}:${permission.action}`).sort(),
      users: role._count.userRoles,
    }));
  }

  private async assertHolds(caller: AuthUser, permissions: Iterable<string>) {
    const mine = (await this.permissions.forUser(caller)).permissions;
    const missing = [...permissions].filter((p) => !mine.has(p));
    if (missing.length) throw new ForbiddenException(`You can only use permissions you have yourself (missing: ${missing.slice(0, 5).join(', ')})`);
  }

  private async permissionIds(permissions: string[]): Promise<string[]> {
    if (!permissions.length) return [];
    const rows = await this.prisma.permission.findMany({
      where: { OR: permissions.map((p) => ({ resource: p.split(':')[0]!, action: p.split(':')[1]! })) },
      select: { id: true },
    });
    if (rows.length !== permissions.length) throw new BadRequestException('Unknown permission');
    return rows.map((r) => r.id);
  }

  private async findCustom(caller: AuthUser, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, OR: [{ agencyId: null, isSystem: true }, { agencyId: caller.agencyId }] },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem || role.agencyId !== caller.agencyId) throw new ForbiddenException('Built-in roles are set by the platform and can’t be changed');
    return role;
  }

  async create(caller: AuthUser, dto: CreateRoleDto): Promise<RoleView> {
    if ((ROLES as readonly string[]).includes(dto.name)) throw new ConflictException('That name is a built-in role');
    if (!dto.permissions.length) throw new BadRequestException('Give the role at least one permission');
    await this.assertHolds(caller, dto.permissions);
    const ids = await this.permissionIds(dto.permissions);
    const exists = await this.prisma.role.count({ where: { agencyId: caller.agencyId, name: dto.name } });
    if (exists) throw new ConflictException('A role with that name already exists');
    const role = await this.prisma.role.create({
      data: {
        agencyId: caller.agencyId,
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
        rolePermissions: { create: ids.map((permissionId) => ({ permissionId })) },
      },
    });
    return (await this.list(caller)).find((r) => r.id === role.id)!;
  }

  async update(caller: AuthUser, id: string, dto: UpdateRoleDto): Promise<RoleView> {
    const role = await this.findCustom(caller, id);
    if (dto.permissions) {
      if (!dto.permissions.length) throw new BadRequestException('Give the role at least one permission');
      const current = role.rolePermissions.map(({ permission }) => `${permission.resource}:${permission.action}`);
      await this.assertHolds(caller, new Set([...current, ...dto.permissions]));
      const ids = await this.permissionIds(dto.permissions);
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
        this.prisma.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) }),
        ...(dto.description !== undefined ? [this.prisma.role.update({ where: { id }, data: { description: dto.description } })] : []),
      ]);
      // Takes effect at once on this API instance, within 30 s on others (PermissionsService cache).
      this.permissions.invalidate();
    } else if (dto.description !== undefined) {
      await this.prisma.role.update({ where: { id }, data: { description: dto.description } });
    }
    return (await this.list(caller)).find((r) => r.id === id)!;
  }

  async remove(caller: AuthUser, id: string): Promise<void> {
    const role = await this.findCustom(caller, id);
    await this.assertHolds(caller, role.rolePermissions.map(({ permission }) => `${permission.resource}:${permission.action}`));
    const inUse = await this.prisma.userRole.count({ where: { roleId: id } });
    if (inUse) throw new ConflictException(`${inUse} user${inUse === 1 ? ' has' : 's have'} this role — give them another role first`);
    await this.prisma.role.delete({ where: { id } });
  }
}

/**
 * Roles a user of this agency can be given: the built-in roles plus the agency's own custom roles (DESIGN.md §6.15),
 * and managing the custom ones (D-099). Who may grant which role to a user is decided in UsersService.
 */
@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Permissions('users:read')
  @Get()
  list(@CurrentUser() caller: AuthUser): Promise<RoleView[]> {
    return this.roles.list(caller);
  }

  @Permissions('settings:update', 'users:update')
  @Audit({ action: 'CREATE_ROLE', resourceType: 'role' })
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(caller, dto);
  }

  @Permissions('settings:update', 'users:update')
  @Audit({ action: 'UPDATE_ROLE', resourceType: 'role' })
  @Patch(':id')
  update(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(caller, id, dto);
  }

  @Permissions('settings:update', 'users:update')
  @Audit({ action: 'DELETE_ROLE', resourceType: 'role' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.roles.remove(caller, id);
  }
}
