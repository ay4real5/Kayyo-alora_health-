import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PatientsService } from '../patients/patients.service.js';
import type { GrantPortalAccessDto } from './dto/portal.dto.js';

const PORTAL_USER = {
  select: { id: true, email: true, firstName: true, lastName: true, isActive: true, lastLoginAt: true, passwordChangedAt: true },
} as const;

export interface PortalAccessView {
  portalUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    /** Still on the temporary password. */
    mustChangePassword: boolean;
  } | null;
}

/**
 * A temporary password that meets the policy (upper, lower, digit, special, ≥ 12): three groups of four unambiguous
 * characters, e.g. `Kp7x-Rm4t-Wq9z`. The user must change it at first sign-in (password_changed_at is null).
 */
export function temporaryPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789'];
  const all = sets.join('');
  const pick = (s: string) => s[randomInt(s.length)]!;
  const groups = [0, 1, 2].map(() => [pick(sets[0]!), pick(sets[1]!), pick(sets[2]!), pick(all)].join(''));
  return groups.join('-');
}

/**
 * Staff side of the patient portal (D-058): who can sign in to see this patient. One portal account per patient; a
 * family member caring for several patients of the agency uses one account for all of them. Without an email provider
 * yet, staff hand over a temporary password (shown once) — invitation emails come with P2-11.
 */
@Injectable()
export class PortalAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async get(caller: AuthUser, patientId: string): Promise<PortalAccessView> {
    await this.patients.assertAccessible(caller, patientId);
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { portalUser: PORTAL_USER },
    });
    return { portalUser: patient.portalUser ? toView(patient.portalUser) : null };
  }

  /** Creates the portal account (returns its temporary password once) or links an existing portal account. */
  async grant(caller: AuthUser, patientId: string, dto: GrantPortalAccessDto): Promise<PortalAccessView & { temporaryPassword?: string }> {
    await this.patients.assertAccessible(caller, patientId);
    const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { portalUserId: true } });
    if (patient.portalUserId) throw new ConflictException('This patient already has portal access — remove it first');

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, agencyId: true, isActive: true, userRoles: { select: { role: { select: { name: true } } } } },
    });
    let temporary: string | undefined;
    let userId: string;
    if (existing) {
      const portalOnly = existing.userRoles.length > 0 && existing.userRoles.every((r) => r.role.name === 'portal_user');
      // Don't reveal whether the address belongs to staff or another agency.
      if (existing.agencyId !== caller.agencyId || !portalOnly) {
        throw new ConflictException('That email address is already used by another account');
      }
      userId = existing.id;
      if (!existing.isActive) {
        temporary = temporaryPassword();
        await this.prisma.user.update({
          where: { id: userId },
          data: { isActive: true, passwordHash: await this.passwords.hash(temporary), passwordChangedAt: null },
        });
      }
    } else {
      const role = await this.prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'portal_user' } });
      temporary = temporaryPassword();
      userId = (
        await this.prisma.user.create({
          data: {
            agencyId: caller.agencyId,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash: await this.passwords.hash(temporary),
            passwordChangedAt: null,
            userRoles: { create: { roleId: role.id } },
          },
          select: { id: true },
        })
      ).id;
    }
    // Guarded: two staff granting at once → one wins.
    const linked = await this.prisma.patient.updateMany({ where: { id: patientId, portalUserId: null }, data: { portalUserId: userId } });
    if (!linked.count) throw new ConflictException('This patient already has portal access — remove it first');
    return { ...(await this.get(caller, patientId)), ...(temporary ? { temporaryPassword: temporary } : {}) };
  }

  /** New temporary password; signs the portal user out everywhere. */
  async resetPassword(caller: AuthUser, patientId: string): Promise<PortalAccessView & { temporaryPassword: string }> {
    const userId = await this.linkedUser(caller, patientId);
    const temporary = temporaryPassword();
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(temporary), passwordChangedAt: null, failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.tokens.revokeAllForUser(userId, 'password_changed');
    return { ...(await this.get(caller, patientId)), temporaryPassword: temporary };
  }

  /** Unlinks the patient. An account left with no patients is deactivated and signed out. */
  async revoke(caller: AuthUser, patientId: string): Promise<void> {
    const userId = await this.linkedUser(caller, patientId);
    await this.prisma.patient.update({ where: { id: patientId }, data: { portalUserId: null } });
    const remaining = await this.prisma.patient.count({ where: { portalUserId: userId } });
    if (!remaining) {
      await this.prisma.user.update({ where: { id: userId }, data: { isActive: false } });
      await this.tokens.revokeAllForUser(userId, 'inactive');
      await this.audit.record({ agencyId: caller.agencyId, userId: caller.userId, action: 'DEACTIVATE_PORTAL_USER', resourceType: 'users', resourceId: userId });
    }
  }

  private async linkedUser(caller: AuthUser, patientId: string): Promise<string> {
    await this.patients.assertAccessible(caller, patientId);
    const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { portalUserId: true } });
    if (!patient.portalUserId) throw new NotFoundException('This patient has no portal access');
    return patient.portalUserId;
  }
}

function toView(u: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
}): NonNullable<PortalAccessView['portalUser']> {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    mustChangePassword: u.passwordChangedAt === null,
  };
}
