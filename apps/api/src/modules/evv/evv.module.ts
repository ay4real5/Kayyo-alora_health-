import { Module } from '@nestjs/common';
import { EvvController } from './evv.controller.js';
import { EvvService } from './evv.service.js';

@Module({
  controllers: [EvvController],
  providers: [EvvService],
  exports: [EvvService],
})
export class EvvModule {}
