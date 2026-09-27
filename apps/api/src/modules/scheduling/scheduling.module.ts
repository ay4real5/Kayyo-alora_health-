import { Module } from '@nestjs/common';
import { ConflictDetectorService } from './conflict-detector.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  controllers: [SchedulingController],
  providers: [VisitsService, ConflictDetectorService],
  exports: [VisitsService, ConflictDetectorService],
})
export class SchedulingModule {}
