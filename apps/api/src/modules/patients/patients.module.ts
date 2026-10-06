import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';
import { TimelineService } from './timeline.service.js';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, TimelineService],
  exports: [PatientsService],
})
export class PatientsModule {}
