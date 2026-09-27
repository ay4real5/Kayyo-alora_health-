import { Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  controllers: [StaffController],
  providers: [StaffService, CredentialsService],
  exports: [StaffService],
})
export class StaffModule {}
