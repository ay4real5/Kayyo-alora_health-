import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { API_PREFIX } from '../../config/api.constants.js';

/** Socket.IO path, under the API prefix so one proxy rule covers REST and sockets. */
export const SOCKET_PATH = `/${API_PREFIX}/socket.io`;

/**
 * Socket.IO with the same exact-origin CORS as the REST API (D-008). Auth is the access token in the handshake
 * (D-041), never a cookie.
 */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const configured: Partial<ServerOptions> = {
      ...options,
      path: SOCKET_PATH,
      cors: { origin: this.origins, credentials: false },
      serveClient: false,
      // Small payloads only; nothing big travels over sockets.
      maxHttpBufferSize: 64 * 1024,
    };
    return super.createIOServer(port, configured as ServerOptions);
  }
}
