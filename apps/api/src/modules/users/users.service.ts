import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { PermissionsService, type UserAccess } from '../rbac/permissions.service.js';
import type { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/users.dto.js';

/** What the API ever reveals about a user. Never the password hash or 2FA secret. */
export interface UserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  is2faEnabled: boolean;
  isLocked: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: { id: string; name: string }[];
}

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  is2faEnabled: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  userRoles: { select: { role: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/**
 * Agency user administration. Every query is scoped to the caller's agency (D-007): users of other agencies
 * are indistinguishable from users that don't exist (404).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(caller: AuthUser, query: ListUsersQueryDto): Promise<Paginated<UserView>> {
    const where: Prisma.UserWhereInput = {
      agencyId: caller.agencyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.role ? { userRoles: { some: { role: { name: query.role } } } } : {}),
      ...(query.search
        ? {
            OR: ['firstName', 'lastName', 'email'].map((field) => ({
              [field]: { contains: query.search, mode: 'insensitive' as const },
            })),
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return Paginated.of(users.map(toView), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<UserView> {
    return toView(await this.find(caller, id));
  }

  async create(caller: AuthUser, dto: CreateUserDto): Promise<UserView> {
    await this.assertAssignable(caller, dto.roleIds);
    try {
      const user = await this.prisma.user.create({
        data: {
          agencyId: caller.agencyId,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone ?? null,
          passwordHash: await this.passwords.hash(dto.password),
          passwordChangedAt: null, // admin-chosen password → user must change it at first login
          userRoles: { create: unique(dto.roleIds).map((roleId) => ({ roleId })) },
        },
        select: USER_SELECT,
      });
      return toView(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async update(caller: AuthUser, id: string, dto: UpdateUserDto): Promise<UserView> {
    const target = await this.find(caller, id);
    if (dto.roleIds) {
      if (target.id === caller.userId) throw new BadRequestException('You cannot change your own roles');
      await this.assertAssignable(caller, dto.roleIds);
      await this.assertCanManage(caller, target);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: unique(dto.roleIds).map((roleId) => ({ userId: id, roleId })) });
      }
      return tx.user.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        },
        select: USER_SELECT,
      });
    });
    if (dto.roleIds) this.permissions.invalidate({ userId: id, agencyId: caller.agencyId });
    return toView(user);
  }

  /** Blocks login and ends every session immediately (access tokens expire within 15 minutes). */
  async deactivate(caller: AuthUser, id: string): Promise<void> {
    const target = await this.find(caller, id);
    if (target.id === caller.userId) throw new BadRequestException('You cannot deactivate your own account');
    await this.assertCanManage(caller, target);
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    await this.tokens.revokeAllForUser(id, 'inactive');
    this.permissions.invalidate({ userId: id, agencyId: caller.agencyId });
  }

  async reactivate(caller: AuthUser, id: string): Promise<UserView> {
    const target = await this.find(caller, id);
    await this.assertCanManage(caller, target);
    return toView(
      await this.prisma.user.update({ where: { id }, data: { isActive: true }, select: USER_SELECT }),
    );
  }

  async unlock(caller: AuthUser, id: string): Promise<UserView> {
    await this.assertCanManage(caller, await this.find(caller, id));
    return toView(
      await this.prisma.user.update({
        where: { id },
        data: { lockedUntil: null, failedLoginAttempts: 0 },
        select: USER_SELECT,
      }),
    );
  }

  /** For a user who lost their authenticator. They log in with password only and can set 2FA up again. */
  async resetTwoFactor(caller: AuthUser, id: string): Promise<UserView> {
    const target = await this.find(caller, id);
    await this.assertCanManage(caller, target);
    const [, user] = await this.prisma.$transaction([
      this.prisma.twoFaRecoveryCode.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({
        where: { id },
        data: { is2faEnabled: false, twoFaSecret: null, twoFaLastUsedStep: null },
        select: USER_SELECT,
      }),
    ]);
    return toView(user);
  }

  /** The user's own actions from the audit trail, newest first. */
  async activity(caller: AuthUser, id: string, query: PaginationQueryDto) {
    await this.find(caller, id);
    const where = { agencyId: caller.agencyId, userId: id };
    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: query.skip,
        take: query.limit,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          details: true,
          ipAddress: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    // BigInt ids don't serialise to JSON.
    return Paginated.of(entries.map((e) => ({ ...e, id: e.id.toString() })), total, query);
  }

  private async find(caller: AuthUser, id: string): Promise<SelectedUser> {
    const user = await this.prisma.user.findFirst({ where: { id, agencyId: caller.agencyId }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * No privilege escalation: roles must exist for this agency (built-in, or the agency's own custom roles),
   * every permission they carry must already be held by the caller, and only a super_admin can create
   * another super_admin.
   */
  private async assertAssignable(caller: AuthUser, roleIds: string[]): Promise<void> {
    const ids = unique(roleIds);
    if (ids.length === 0) return;
    const granted = await this.permissions.forRoles(ids, caller.agencyId);
    if (granted.roles.length !== ids.length) throw new BadRequestException('One or more roles do not exist');
    await this.assertCovers(caller, granted, 'You cannot grant a role with permissions you do not have yourself');
  }

  /**
   * You can only deactivate, reactivate, re-role or reset 2FA for users whose access you fully hold
   * yourself. Judged from the target's assigned roles, so it also works for deactivated accounts.
   */
  private async assertCanManage(caller: AuthUser, target: SelectedUser): Promise<void> {
    const targetAccess = await this.permissions.forRoles(
      target.userRoles.map(({ role }) => role.id),
      caller.agencyId,
    );
    await this.assertCovers(caller, targetAccess, 'You cannot manage a user with more access than you');
  }

  private async assertCovers(caller: AuthUser, other: UserAccess, message: string): Promise<void> {
    const callerAccess = await this.permissions.forUser(caller);
    const superAdminGap = other.roles.includes('super_admin') && !callerAccess.roles.includes('super_admin');
    const permissionGap = [...other.permissions].some((permission) => !callerAccess.permissions.has(permission));
    if (superAdminGap || permissionGap) throw new ForbiddenException(message);
  }
}

function toView(user: SelectedUser): UserView {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    isActive: user.isActive,
    is2faEnabled: user.is2faEnabled,
    isLocked: user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now(),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    roles: user.userRoles.map(({ role }) => role).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
