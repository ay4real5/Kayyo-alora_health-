import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module.js';
import { NoteAiService } from './note-ai.service.js';
import { VisitDocsController } from './visit-docs.controller.js';
import { VisitDocsService } from './visit-docs.service.js';

@Module({
  imports: [ComplianceModule],
  controllers: [VisitDocsController],
  providers: [VisitDocsService, NoteAiService],
  exports: [NoteAiService],
})
export class VisitDocsModule {}
