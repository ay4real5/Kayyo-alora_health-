import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { AuditPartitionsJob } from './audit-partitions.job.js';
import { NotificationDeliveryJob } from './notification-delivery.job.js';
import { RecurringExtensionJob } from './recurring-extension.job.js';
import { VisitMonitorService } from './visit-monitor.service.js';

/** Background jobs (DECISIONS D-041). In-process cron; notification delivery uses a database outbox, not BullMQ (D-071). */
@Module({
  imports: [SchedulingModule],
  providers: [VisitMonitorService, RecurringExtensionJob, AuditPartitionsJob, NotificationDeliveryJob],
  exports: [VisitMonitorService],
})
export class JobsModule {}
