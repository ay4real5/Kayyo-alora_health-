import { Module } from '@nestjs/common';
import { ConflictDetectorService } from './conflict-detector.service.js';
import { RecurringController } from './recurring.controller.js';
import { RecurringService } from './recurring.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  controllers: [SchedulingController, RecurringController],
  providers: [VisitsService, ConflictDetectorService, RecurringService],
  exports: [VisitsService, ConflictDetectorService, RecurringService],
})
export class SchedulingModule {}
