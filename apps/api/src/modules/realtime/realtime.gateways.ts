import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { RealtimeAuthService, socketUser } from './realtime-auth.service.js';

export const agencyRoom = (agencyId: string) => `agency:${agencyId}`;
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * `/notifications` — every signed-in user; each joins `user:{id}` and receives `notification:new` (the same PHI-free
 * record the inbox API returns). Caregivers' shift events travel as notifications too (D-041).
 */
@WebSocketGateway({ namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Namespace;

  constructor(private readonly auth: RealtimeAuthService) {}

  afterInit(server: Namespace): void {
    server.use(this.auth.middleware());
  }

  async handleConnection(socket: Socket): Promise<void> {
    const user = socketUser(socket);
    if (user) await socket.join(userRoom(user.userId));
  }
}

/**
 * `/live-monitor` — supervisors (`evv:read`); each joins `agency:{id}` and receives visit events (clock-in/out,
 * geofence, late, no-show, missed). Clients refetch `GET /evv/live` for the full picture after an event.
 */
@WebSocketGateway({ namespace: '/live-monitor' })
export class LiveMonitorGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Namespace;

  constructor(private readonly auth: RealtimeAuthService) {}

  afterInit(server: Namespace): void {
    server.use(this.auth.middleware('evv:read'));
  }

  async handleConnection(socket: Socket): Promise<void> {
    const user = socketUser(socket);
    if (user) await socket.join(agencyRoom(user.agencyId));
  }
}
