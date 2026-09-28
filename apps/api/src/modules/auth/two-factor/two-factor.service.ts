import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PhiContext, PhiCryptoService } from '../../../common/crypto/phi-crypto.service.js';
import type { AuthUser } from '../../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { PasswordService } from '../password.service.js';
import type { ClientInfo } from '../token.service.js';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-codes.js';
import { twoFactorPolicy } from './two-factor-policy.js';
import { base32Decode, base32Encode, generateSecret, otpauthUri, verifyTotp } from './totp.js';

/** Shown as the account name in authenticator apps. Rename when the product name is final (Q-004). */
export const TOTP_ISSUER = 'Alora Health';

export interface RecoveryCodes {
  /** Shown once. Each works one time at login in place of an authenticator code. */
  recoveryCodes: string[];
}

export interface TwoFactorSetup {
  /** Render as a QR code for the authenticator app to scan. */
  otpauthUri: string;
  /** The same secret for manual entry. Shown once; never retrievable again. */
  secret: string;
}

interface TwoFactorUser {
  id: string;
  twoFaSecret: string | null;
  twoFaLastUsedStep: number | null;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PhiCryptoService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  /** Step 1: create a secret. 2FA is not active until the user proves the app works (enable). */
  async setup(auth: AuthUser, client: ClientInfo): Promise<TwoFactorSetup> {
    const user = await this.findUser(auth);
    if (user.is2faEnabled) throw new ConflictException('Two-factor authentication is already enabled');

    const secret = generateSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFaSecret: Buffer.from(this.crypto.encrypt(base32Encode(secret), PhiContext.UserTwoFaSecret)).toString(
          'base64',
        ),
        twoFaLastUsedStep: null,
      },
    });
    await this.audit.record({ agencyId: auth.agencyId, userId: user.id, action: 'TWO_FA_SETUP_STARTED', ...client });
    return { otpauthUri: otpauthUri(TOTP_ISSUER, user.email, secret), secret: base32Encode(secret) };
  }

  /** Step 2: the first valid code switches 2FA on. Returns backup codes — shown once, never again. */
  async enable(auth: AuthUser, code: string, client: ClientInfo): Promise<RecoveryCodes> {
    const user = await this.findUser(auth);
    if (user.is2faEnabled) throw new ConflictException('Two-factor authentication is already enabled');
    if (!user.twoFaSecret) throw new BadRequestException('Start two-factor setup first');
    if (!(await this.consumeCode(user, code))) throw new BadRequestException('Invalid authentication code');

    await this.prisma.user.update({ where: { id: user.id }, data: { is2faEnabled: true } });
    const recoveryCodes = await this.replaceRecoveryCodes(user.id);
    await this.audit.record({ agencyId: auth.agencyId, userId: user.id, action: 'TWO_FA_ENABLED', ...client });
    return { recoveryCodes };
  }

  /** Needs both the password and a current code, so a stolen session alone can't remove 2FA. */
  async disable(auth: AuthUser, password: string, code: string, client: ClientInfo): Promise<void> {
    const user = await this.requirePasswordAndCode(auth, password, code);
    if ((await twoFactorPolicy(this.prisma, user.id)).mandatory) {
      throw new ForbiddenException('Your role requires two-factor authentication; it cannot be turned off');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { is2faEnabled: false, twoFaSecret: null, twoFaLastUsedStep: null },
      }),
      this.prisma.twoFaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await this.audit.record({ agencyId: auth.agencyId, userId: user.id, action: 'TWO_FA_DISABLED', ...client });
  }

  /** New set of backup codes; all previous ones stop working. Needs the password and a current code. */
  async regenerateRecoveryCodes(
    auth: AuthUser,
    password: string,
    code: string,
    client: ClientInfo,
  ): Promise<RecoveryCodes> {
    const user = await this.requirePasswordAndCode(auth, password, code);
    const recoveryCodes = await this.replaceRecoveryCodes(user.id);
    await this.audit.record({
      agencyId: auth.agencyId,
      userId: user.id,
      action: 'TWO_FA_RECOVERY_CODES_REGENERATED',
      ...client,
    });
    return { recoveryCodes };
  }

  /** Uses up one backup code (atomically — each works exactly once). */
  async consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
    const normalized = normalizeRecoveryCode(input);
    if (!normalized) return false;
    const used = await this.prisma.twoFaRecoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(normalized), usedAt: null },
      data: { usedAt: new Date() },
    });
    return used.count === 1;
  }

  remainingRecoveryCodes(userId: string): Promise<number> {
    return this.prisma.twoFaRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.twoFaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.twoFaRecoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(normalizeRecoveryCode(code)!) })),
      }),
    ]);
    return codes;
  }

  private async requirePasswordAndCode(auth: AuthUser, password: string, code: string) {
    const user = await this.findUser(auth);
    if (!user.is2faEnabled) throw new BadRequestException('Two-factor authentication is not enabled');
    const passwordOk = await this.passwords.verify(user.passwordHash, password);
    if (!passwordOk || !(await this.consumeCode(user, code))) {
      throw new ForbiddenException('Password or authentication code is incorrect');
    }
    return user;
  }

  /**
   * Checks a code and marks its time step as used, atomically — so the same code can't be used twice,
   * even by two simultaneous requests.
   */
  async consumeCode(user: TwoFactorUser, code: string): Promise<boolean> {
    if (!user.twoFaSecret) return false;
    const secret = this.crypto.decrypt(Buffer.from(user.twoFaSecret, 'base64'), PhiContext.UserTwoFaSecret);
    const step = verifyTotp(base32Decode(secret), code);
    if (step === null) return false;

    const claimed = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ twoFaLastUsedStep: null }, { twoFaLastUsedStep: { lt: step } }],
      },
      data: { twoFaLastUsedStep: step },
    });
    return claimed.count === 1;
  }

  private async findUser(auth: AuthUser) {
    const user = await this.prisma.user.findFirst({
      where: { id: auth.userId, agencyId: auth.agencyId, isActive: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
