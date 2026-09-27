import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { TokenService, type ClientInfo, type TokenPair } from './token.service.js';

/** One message for every login failure, so callers can't tell which emails exist or are locked. */
export const INVALID_LOGIN = 'Invalid email or password, or the account is temporarily locked';

export interface LoginResult extends TokenPair {
  /** True when the password is older than PASSWORD_MAX_AGE_DAYS; clients should prompt a change. */
  mustChangePassword: boolean;
}

export interface MeResult {
  id: string;
  agencyId: string;
  email: string;
  firstName: string;
  lastName: string;
  is2faEnabled: boolean;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxAttempts: number;
  private readonly lockoutMs: number;
  private readonly passwordMaxAgeMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.lockoutMs = config.get('LOGIN_LOCKOUT_MINUTES', { infer: true }) * 60_000;
    this.passwordMaxAgeMs = config.get('PASSWORD_MAX_AGE_DAYS', { infer: true }) * 24 * 60 * 60_000;
  }

  async login(email: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      include: { agency: { select: { isActive: true } } },
    });

    if (!user) {
      await this.passwords.burnTime(password);
      this.logger.warn(`Login failed for unknown email [ip ${client.ipAddress ?? '?'}]`);
      throw new UnauthorizedException(INVALID_LOGIN);
    }

    const auditBase = { agencyId: user.agencyId, userId: user.id, ...client };
    const fail = async (reason: string, extra: Record<string, boolean> = {}): Promise<never> => {
      await this.audit.record({ ...auditBase, action: 'LOGIN_FAILED', details: { reason, ...extra } });
      throw new UnauthorizedException(INVALID_LOGIN);
    };

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.passwords.burnTime(password);
      return fail('locked');
    }
    if (!user.isActive || !user.agency.isActive) {
      await this.passwords.burnTime(password);
      return fail('inactive');
    }

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      const lockNow = updated.failedLoginAttempts >= this.maxAttempts;
      if (lockNow) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + this.lockoutMs), failedLoginAttempts: 0 },
        });
        await this.tokens.revokeAllForUser(user.id, 'locked');
        await this.audit.record({ ...auditBase, action: 'ACCOUNT_LOCKED', details: { reason: 'failed_logins' } });
      }
      return fail('wrong_password', { locked: lockNow });
    }

    if (user.is2faEnabled) {
      // Fail closed until the 2FA step exists (ROADMAP P1-07): never skip a second factor silently.
      return fail('2fa_not_implemented');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await this.tokens.issueForNewSession({ userId: user.id, agencyId: user.agencyId }, client);
    await this.audit.record({ ...auditBase, action: 'LOGIN_SUCCESS' });

    return { ...tokens, mustChangePassword: this.isPasswordExpired(user.passwordChangedAt) };
  }

  refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, client);
  }

  async logout(refreshToken: string, client: ClientInfo): Promise<void> {
    const session = await this.tokens.revoke(refreshToken);
    if (session) await this.audit.record({ ...session, action: 'LOGOUT', ...client });
  }

  async me(auth: AuthUser): Promise<MeResult> {
    const user = await this.prisma.user.findFirst({
      where: { id: auth.userId, agencyId: auth.agencyId, isActive: true },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const permissions = new Set<string>();
    for (const { role } of user.userRoles) {
      for (const { permission } of role.rolePermissions) {
        permissions.add(`${permission.resource}:${permission.action}`);
      }
    }
    return {
      id: user.id,
      agencyId: user.agencyId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      is2faEnabled: user.is2faEnabled,
      roles: user.userRoles.map(({ role }) => role.name).sort(),
      permissions: [...permissions].sort(),
    };
  }

  /** Changes the password, signs out every other session, and returns a fresh session for this client. */
  async changePassword(
    auth: AuthUser,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { id: auth.userId, agencyId: auth.agencyId, isActive: true },
    });
    if (!user) throw new UnauthorizedException(INVALID_LOGIN);
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new ForbiddenException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: new Date() },
    });
    await this.tokens.revokeAllForUser(user.id, 'password_changed');
    await this.audit.record({ agencyId: user.agencyId, userId: user.id, action: 'PASSWORD_CHANGED', ...client });
    return this.tokens.issueForNewSession(auth, client);
  }

  private isPasswordExpired(changedAt: Date | null): boolean {
    if (this.passwordMaxAgeMs === 0) return false;
    if (!changedAt) return true; // never set (e.g. admin-created account) → ask for a real password
    return Date.now() - changedAt.getTime() > this.passwordMaxAgeMs;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
