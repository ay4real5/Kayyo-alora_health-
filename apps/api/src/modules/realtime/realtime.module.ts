import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeAuthService } from './realtime-auth.service.js';
import { LiveMonitorGateway, NotificationsGateway } from './realtime.gateways.js';
import { RealtimeService } from './realtime.service.js';

/** Socket.IO (DECISIONS D-041). Global so any module can inject RealtimeService. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeAuthService, NotificationsGateway, LiveMonitorGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
