import { Injectable, Logger } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TokenService } from '../auth/token.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';

/** What a connected socket carries once authenticated. */
export interface SocketUser extends AuthUser {
  permissions: ReadonlySet<string>;
}

export function socketUser(socket: Socket): SocketUser | undefined {
  return (socket.data as { user?: SocketUser }).user;
}

/** The access token from the handshake: `io(url, { auth: { token } })`. Never a query string (those get logged). */
function handshakeToken(socket: Socket): string | null {
  const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  return typeof token === 'string' && token.length > 0 && token.length < 4096 ? token : null;
}

/**
 * Authenticates Socket.IO connections (DECISIONS D-041) as namespace middleware, so a refused socket never connects:
 * the client gets `connect_error` with message `unauthorized` or `forbidden`. A valid access token for an active user
 * is required, plus the namespace's permission if any. The connection is closed when the token expires, so a socket
 * never outlives its 15-minute access token — the client reconnects with a fresh one.
 */
@Injectable()
export class RealtimeAuthService {
  private readonly logger = new Logger(RealtimeAuthService.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  middleware(required?: string) {
    return (socket: Socket, next: (error?: Error) => void) => {
      this.authenticate(socket, required).then(
        () => next(),
        (error: unknown) => {
          const code =
            error instanceof Error && error.message === 'forbidden' ? 'forbidden' : 'unauthorized';
          this.logger.debug(`socket ${socket.id} refused: ${code}`);
          next(new Error(code)); // generic reason; never echo the token
        },
      );
    };
  }

  private async authenticate(socket: Socket, required?: string): Promise<void> {
    const token = handshakeToken(socket);
    if (!token) throw new Error('unauthorized');
    const claims = await this.tokens.verifyAccessTokenWithExpiry(token);
    if (claims.passwordChangeRequired) throw new Error('forbidden'); // forced password change first (P4-09)
    if (claims.twoFactorSetupRequired) throw new Error('forbidden'); // mandatory 2FA not set up yet (D-045)
    const active = await this.prisma.user.count({
      where: { id: claims.userId, agencyId: claims.agencyId, isActive: true },
    });
    if (!active) throw new Error('unauthorized');
    const access = await this.permissions.forUser(claims);
    if (required && !access.permissions.has(required)) throw new Error('forbidden');

    const user: SocketUser = {
      userId: claims.userId,
      agencyId: claims.agencyId,
      permissions: access.permissions,
    };
    (socket.data as { user?: SocketUser }).user = user;
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, claims.expiresAt.getTime() - Date.now()),
    );
    timer.unref();
    socket.once('disconnect', () => clearTimeout(timer));
  }
}
