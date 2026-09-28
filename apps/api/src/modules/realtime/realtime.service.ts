import { Injectable, Logger } from '@nestjs/common';
import {
  agencyRoom,
  LiveMonitorGateway,
  NotificationsGateway,
  userRoom,
} from './realtime.gateways.js';

/** Live-monitor events (DESIGN.md §8.1). Sent only to `evv:read` holders in the agency. */
export type MonitorEvent =
  | 'visit:clock-in'
  | 'visit:clock-out'
  | 'visit:geofence-violation'
  | 'visit:late'
  | 'visit:noshow'
  | 'visit:missed';

/**
 * The one place that pushes to sockets. Emitting never throws: a failed push must not fail the request that caused
 * it (the data is in the database; clients catch up when they reconnect or refetch).
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly notifications: NotificationsGateway,
    private readonly monitor: LiveMonitorGateway,
  ) {}

  toUser(userId: string, event: 'notification:new', payload: unknown): void {
    this.safely(() => this.notifications.server?.to(userRoom(userId)).emit(event, payload));
  }

  toMonitor(agencyId: string, event: MonitorEvent, payload: Record<string, unknown>): void {
    this.safely(() =>
      this.monitor.server?.to(agencyRoom(agencyId)).emit(event, { ...payload, at: new Date() }),
    );
  }

  private safely(send: () => unknown): void {
    try {
      send();
    } catch (error) {
      this.logger.warn(
        `realtime emit failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
