import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { AuditService } from '../audit/audit.service.js';

export interface TokenPair {
  accessToken: string;
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface ClientInfo {
  ipAddress?: string;
  userAgent?: string;
}

interface AccessTokenClaims {
  sub: string;
  agencyId: string;
}

export const JWT_ISSUER = 'alora-api';
export const JWT_AUDIENCE = 'alora';

const SESSION_EXPIRED = 'Session expired. Please log in again.';

/**
 * Access tokens: short-lived HS256 JWTs (stateless).
 * Refresh tokens: 32 random bytes, stored only as a SHA-256 hash (DECISIONS D-020):
 *   - rotated on every use; the new token keeps the session's absolute expiry
 *   - refused when unused for longer than SESSION_IDLE_TIMEOUT_MINUTES (HIPAA auto-logoff)
 *   - presenting an already-rotated token signals theft → every session of that user is revoked
 */
@Injectable()
export class TokenService {
  private readonly accessTtlMinutes: number;
  private readonly refreshTtlDays: number;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.accessTtlMinutes = config.get('ACCESS_TOKEN_TTL_MINUTES', { infer: true });
    this.refreshTtlDays = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    this.idleTimeoutMs = config.get('SESSION_IDLE_TIMEOUT_MINUTES', { infer: true }) * 60_000;
  }

  /** Starts a new session (login). */
  async issueForNewSession(user: AuthUser, client: ClientInfo): Promise<TokenPair> {
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60_000);
    return this.issue(user, expiresAt, client);
  }

  /** Exchanges a refresh token for a new pair. Throws 401 for anything invalid. */
  async rotate(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { select: { id: true, agencyId: true, isActive: true, lockedUntil: true } } },
    });
    if (!stored) throw new UnauthorizedException(SESSION_EXPIRED);

    const { user } = stored;
    if (stored.revokedAt) {
      await this.revokeAllForUser(user.id);
      await this.audit.record({
        agencyId: user.agencyId,
        userId: user.id,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        details: { refreshTokenId: stored.id },
        ...client,
      });
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    const now = Date.now();
    const idle = now - stored.createdAt.getTime() > this.idleTimeoutMs;
    const blocked = !user.isActive || (user.lockedUntil !== null && user.lockedUntil.getTime() > now);
    if (stored.expiresAt.getTime() <= now || idle || blocked) {
      await this.prisma.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    // Revoke-then-issue. If two requests race with the same token, only one wins the update;
    // the loser is treated like reuse (the token was already consumed).
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (consumed.count !== 1) throw new UnauthorizedException(SESSION_EXPIRED);

    return this.issue({ userId: user.id, agencyId: user.agencyId }, stored.expiresAt, client);
  }

  /** Logout: revokes one session. Unknown/already-revoked tokens are ignored (idempotent). */
  async revoke(refreshToken: string): Promise<{ userId: string; agencyId: string } | undefined> {
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      include: { user: { select: { agencyId: true } } },
    });
    if (!stored) return undefined;
    await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { userId: stored.userId, agencyId: stored.user.agencyId };
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return { userId: claims.sub, agencyId: claims.agencyId };
  }

  private async issue(user: AuthUser, expiresAt: Date, client: ClientInfo): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.userId,
        tokenHash: hashToken(refreshToken),
        expiresAt,
        ipAddress: client.ipAddress && /^[0-9a-fA-F:.]+$/.test(client.ipAddress) ? client.ipAddress : null,
        deviceInfo: client.userAgent?.slice(0, 255) ?? null,
      },
    });

    const claims: AccessTokenClaims = { sub: user.userId, agencyId: user.agencyId };
    const accessToken = await this.jwt.signAsync(claims, {
      algorithm: 'HS256',
      expiresIn: this.accessTtlMinutes * 60,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      accessToken,
      accessTokenExpiresIn: this.accessTtlMinutes * 60,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }
}

/** Refresh tokens have 256 bits of entropy, so a fast hash is safe (no brute force possible). */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
