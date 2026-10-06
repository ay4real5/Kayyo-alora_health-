import { Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { TimeOffController } from './time-off.controller.js';
import { TimeOffService } from './time-off.service.js';

@Module({
  controllers: [StaffController, TimeOffController],
  providers: [StaffService, CredentialsService, TimeOffService],
  exports: [StaffService, TimeOffService],
})
export class StaffModule {}
