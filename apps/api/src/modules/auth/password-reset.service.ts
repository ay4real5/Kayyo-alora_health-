import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailSender } from '../notifications/delivery/senders.js';
import { normalizeEmail } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService, type ClientInfo } from './token.service.js';

/** How long a reset link works. */
export const RESET_LINK_MINUTES = 30;
const INVALID_LINK = 'This reset link is invalid or has expired. Ask for a new one.';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * "Forgot password" (D-072). The request always gets the same answer, whether or not the address has an account, and
 * the email goes out in the background so timing doesn't tell either. The link is single use, works for 30 minutes,
 * carries the token in the URL fragment (never sent to servers, so never in any log), and only its hash is stored.
 * Needs the email channel (SendGrid) and FRONTEND_URL; without them nothing is sent.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly email: EmailSender,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Can a reset email be sent at all? (The sign-in page says "ask your administrator" when not.) */
  get available(): boolean {
    return this.email.enabled && Boolean(this.config.get('FRONTEND_URL', { infer: true }));
  }

  /** Returns at once; the work (and any email) happens in the background. */
  request(email: string, client: ClientInfo): { accepted: true; emailAvailable: boolean } {
    void this.sendLink(normalizeEmail(email), client).catch((error: Error) =>
      this.logger.error('password reset request failed', error.stack),
    );
    return { accepted: true, emailAvailable: this.available };
  }

  /** Exposed for tests: the background part of `request`. */
  async sendLink(email: string, client: ClientInfo, now = new Date()): Promise<void> {
    if (!this.available) return;
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, agencyId: true, email: true, isActive: true } });
    if (!user?.isActive) return;
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(now.getTime() + RESET_LINK_MINUTES * 60_000) },
      }),
    ]);
    const link = `${this.config.get('FRONTEND_URL', { infer: true })!.replace(/\/$/, '')}/reset-password#token=${token}`;
    const sent = await this.email.sendText(
      user.email,
      'Reset your Alora password',
      [
        'Someone — hopefully you — asked to reset the password for your Alora account.',
        '',
        `Choose a new password here (the link works once, for ${RESET_LINK_MINUTES} minutes):`,
        link,
        '',
        "If you didn't ask for this, ignore this email; your password stays as it is.",
      ].join('\n'),
    );
    await this.audit.record({
      agencyId: user.agencyId,
      userId: user.id,
      action: sent.ok ? 'PASSWORD_RESET_REQUESTED' : 'PASSWORD_RESET_EMAIL_FAILED',
      ...client,
    });
  }

  async reset(token: string, newPassword: string, client: ClientInfo, now = new Date()): Promise<{ reset: true }> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: { select: { id: true, agencyId: true, isActive: true, passwordHash: true } } },
    });
    if (!row || row.usedAt || row.expiresAt <= now || !row.user.isActive) throw new BadRequestException(INVALID_LINK);
    if (await this.passwords.verify(row.user.passwordHash, newPassword)) {
      throw new BadRequestException('New password must be different from the current one');
    }
    // Claim the link first so two submissions can't both use it.
    const claimed = await this.prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (!claimed.count) throw new BadRequestException(INVALID_LINK);
    await this.prisma.user.update({
      where: { id: row.user.id },
      // A reset also clears a lockout — the person proved they control the email address.
      data: { passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: now, failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.tokens.revokeAllForUser(row.user.id, 'password_changed');
    await this.audit.record({ agencyId: row.user.agencyId, userId: row.user.id, action: 'PASSWORD_RESET', ...client });
    return { reset: true };
  }
}
