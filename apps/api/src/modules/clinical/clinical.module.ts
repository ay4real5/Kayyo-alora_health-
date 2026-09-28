import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module.js';
import { ClinicalController } from './clinical.controller.js';
import { ClinicalService } from './clinical.service.js';

/** Clinical records: medications, physician orders, plans of care, assessments (DECISIONS D-055). */
@Module({
  imports: [PatientsModule],
  controllers: [ClinicalController],
  providers: [ClinicalService],
})
export class ClinicalModule {}
