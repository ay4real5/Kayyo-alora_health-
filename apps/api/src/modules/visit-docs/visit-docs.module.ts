import { Module } from '@nestjs/common';
import { VisitDocsController } from './visit-docs.controller.js';
import { VisitDocsService } from './visit-docs.service.js';

@Module({
  controllers: [VisitDocsController],
  providers: [VisitDocsService],
})
export class VisitDocsModule {}
