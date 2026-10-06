import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { ConflictDetectorService } from './conflict-detector.service.js';
import { OpenShiftsController } from './open-shifts.controller.js';
import { CaregiverMatchService } from './caregiver-match.service.js';
import { OpenShiftsService } from './open-shifts.service.js';
import { RecurringController } from './recurring.controller.js';
import { RecurringService } from './recurring.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { ShiftSwapsService } from './shift-swaps.service.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [BillingModule],
  controllers: [SchedulingController, RecurringController, OpenShiftsController],
  providers: [VisitsService, ConflictDetectorService, RecurringService, OpenShiftsService, ShiftSwapsService, CaregiverMatchService],
  exports: [VisitsService, ConflictDetectorService, RecurringService, OpenShiftsService, CaregiverMatchService],
})
export class SchedulingModule {}
