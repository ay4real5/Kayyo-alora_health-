import { twoFactorPolicy } from './two-factor/two-factor-policy.js';
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
import { PermissionsService } from '../rbac/permissions.service.js';
import { PasswordService } from './password.service.js';
import { passwordChangeRequired } from './password-policy.js';
import { TokenService, type ClientInfo, type TokenPair } from './token.service.js';
import { TwoFactorService } from './two-factor/two-factor.service.js';

/** One message for every login failure, so callers can't tell which emails exist or are locked. */
export const INVALID_LOGIN = 'Invalid email or password, or the account is temporarily locked';

export type LoginResult = TokenPair;

/** Returned by /auth/login instead of tokens when the user has 2FA on. */
export interface TwoFactorChallenge {
  requires2FA: true;
  twoFactorToken: string;
  expiresIn: number;
}

type AuditBase = { agencyId: string; userId: string } & ClientInfo;

export interface MeResult {
  id: string;
  agencyId: string;
  email: string;
  firstName: string;
  lastName: string;
  is2faEnabled: boolean;
  /** The user's role requires 2FA (D-045); if it's off, only 2FA setup works until it's on. */
  is2faRequired: boolean;
  /** IANA timezone of the user's agency, e.g. America/Chicago — clients use it for "today". */
  agencyTimezone: string;
  agency: { name: string; phone: string | null };
  /** The password was never set or is too old — only this endpoint and change-password work until it changes. */
  mustChangePassword: boolean;
  /** Unused backup codes, when 2FA is on — clients should warn when this gets low. */
  recoveryCodesRemaining: number | null;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxAttempts: number;
  private readonly lockoutMs: number;
  private readonly passwordMaxAgeDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
    private readonly permissions: PermissionsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.lockoutMs = config.get('LOGIN_LOCKOUT_MINUTES', { infer: true }) * 60_000;
    this.passwordMaxAgeDays = config.get('PASSWORD_MAX_AGE_DAYS', { infer: true });
  }

  async login(email: string, password: string, client: ClientInfo): Promise<LoginResult | TwoFactorChallenge> {
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
      return fail('wrong_password', { locked: await this.registerFailure(user.id, auditBase) });
    }

    if (user.is2faEnabled) {
      // Password is right, but no session until a TOTP code is verified at /auth/2fa/verify.
      // Failed-attempt counters are only reset once the whole login succeeds.
      await this.audit.record({ ...auditBase, action: 'LOGIN_2FA_CHALLENGE' });
      return {
        requires2FA: true,
        ...(await this.tokens.signTwoFactorChallenge({ userId: user.id, agencyId: user.agencyId })),
      };
    }

    return this.completeLogin(user, client, 'password');
  }

  /** Second login step for 2FA users. Wrong codes count towards the same lockout as wrong passwords. */
  async verifyTwoFactorLogin(
    twoFactorToken: string,
    proof: { code?: string; recoveryCode?: string },
    client: ClientInfo,
  ): Promise<LoginResult> {
    if (Boolean(proof.code) === Boolean(proof.recoveryCode)) {
      throw new BadRequestException('Send either an authenticator code or a recovery code');
    }
    const pending = await this.tokens.verifyTwoFactorChallenge(twoFactorToken);
    const user = await this.prisma.user.findFirst({
      where: { id: pending.userId, agencyId: pending.agencyId },
      include: { agency: { select: { isActive: true } } },
    });
    if (!user) throw new UnauthorizedException(INVALID_LOGIN);

    const auditBase = { agencyId: user.agencyId, userId: user.id, ...client };
    const blocked =
      !user.isActive ||
      !user.agency.isActive ||
      !user.is2faEnabled ||
      (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now());
    if (blocked) {
      await this.audit.record({ ...auditBase, action: 'LOGIN_FAILED', details: { reason: '2fa_blocked' } });
      throw new UnauthorizedException(INVALID_LOGIN);
    }

    const usingRecovery = Boolean(proof.recoveryCode);
    const ok = usingRecovery
      ? await this.twoFactor.consumeRecoveryCode(user.id, proof.recoveryCode!)
      : await this.twoFactor.consumeCode(user, proof.code!);
    if (!ok) {
      const locked = await this.registerFailure(user.id, auditBase);
      const reason = usingRecovery ? 'wrong_recovery_code' : 'wrong_2fa_code';
      await this.audit.record({ ...auditBase, action: 'LOGIN_FAILED', details: { reason, locked } });
      throw new UnauthorizedException('Invalid authentication code');
    }

    if (usingRecovery) {
      const remaining = await this.twoFactor.remainingRecoveryCodes(user.id);
      await this.audit.record({ ...auditBase, action: 'TWO_FA_RECOVERY_CODE_USED', details: { remaining } });
    }
    return this.completeLogin(user, client, usingRecovery ? 'password+recovery_code' : 'password+totp');
  }

  /** Counts a failed attempt; locks the account (and ends its sessions) at the limit. Returns true if locked. */
  private async registerFailure(userId: string, auditBase: AuditBase): Promise<boolean> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (updated.failedLoginAttempts < this.maxAttempts) return false;

    await this.prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + this.lockoutMs), failedLoginAttempts: 0 },
    });
    await this.tokens.revokeAllForUser(userId, 'locked');
    await this.audit.record({ ...auditBase, action: 'ACCOUNT_LOCKED', details: { reason: 'failed_logins' } });
    return true;
  }

  private async completeLogin(
    user: { id: string; agencyId: string },
    client: ClientInfo,
    method: 'password' | 'password+totp' | 'password+recovery_code',
  ): Promise<LoginResult> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await this.tokens.issueForNewSession({ userId: user.id, agencyId: user.agencyId }, client);
    await this.audit.record({
      agencyId: user.agencyId,
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      details: { method },
      ...client,
    });
    return tokens;
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
      include: { agency: { select: { timezone: true, name: true, phone: true } } },
    });
    if (!user) throw new NotFoundException('User not found');

    // Same lookup the RbacGuard uses, so the UI sees exactly what the API will enforce.
    const access = await this.permissions.forUser(auth);
    return {
      id: user.id,
      agencyId: user.agencyId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      is2faEnabled: user.is2faEnabled,
      is2faRequired: (await twoFactorPolicy(this.prisma, user.id)).mandatory,
      mustChangePassword: passwordChangeRequired(user.passwordChangedAt, this.passwordMaxAgeDays),
      agencyTimezone: user.agency.timezone,
      // For "call the office" in the apps.
      agency: { name: user.agency.name, phone: user.agency.phone },
      recoveryCodesRemaining: user.is2faEnabled ? await this.twoFactor.remainingRecoveryCodes(user.id) : null,
      roles: access.roles,
      permissions: [...access.permissions].sort(),
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
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
