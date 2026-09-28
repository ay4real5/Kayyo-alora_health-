import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { RecurringExtensionJob } from './recurring-extension.job.js';
import { VisitMonitorService } from './visit-monitor.service.js';

/** Background jobs (DECISIONS D-041). In-process cron for now; BullMQ arrives with the notification queue (P2-12). */
@Module({
  imports: [SchedulingModule],
  providers: [VisitMonitorService, RecurringExtensionJob],
  exports: [VisitMonitorService],
})
export class JobsModule {}
