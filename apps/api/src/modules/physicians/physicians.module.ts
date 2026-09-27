import { Module } from '@nestjs/common';
import { PhysiciansController } from './physicians.controller.js';
import { PhysiciansService } from './physicians.service.js';

@Module({
  controllers: [PhysiciansController],
  providers: [PhysiciansService],
})
export class PhysiciansModule {}
