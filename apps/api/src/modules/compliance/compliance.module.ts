import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { PatientsModule } from '../patients/patients.module.js';
import { ComplianceService } from './compliance.service.js';
import { CredentialExpiryJob } from './credential-expiry.job.js';
import { AuditLogQueryDto, CreateIncidentDto, ListIncidentsQueryDto, UpdateIncidentDto } from './dto/compliance.dto.js';

const uuid = () => new ParseUUIDPipe();

/** Compliance (DESIGN.md §6.12, DECISIONS D-062). */
@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Permissions('compliance:read')
  @Get('dashboard')
  dashboard(@CurrentUser() caller: AuthUser) {
    return this.compliance.dashboard(caller);
  }

  @Permissions('compliance:read')
  @Get('incidents')
  listIncidents(@CurrentUser() caller: AuthUser, @Query() query: ListIncidentsQueryDto) {
    return this.compliance.listIncidents(caller, query);
  }

  @Permissions('compliance:create')
  @Audit({ action: 'REPORT_INCIDENT', resourceType: 'incident_reports' })
  @Post('incidents')
  createIncident(@CurrentUser() caller: AuthUser, @Body() dto: CreateIncidentDto) {
    return this.compliance.createIncident(caller, dto);
  }

  @Permissions('compliance:read')
  @Get('incidents/:id')
  getIncident(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.compliance.getIncident(caller, id);
  }

  @Permissions('compliance:update')
  @Audit({ action: 'UPDATE_INCIDENT', resourceType: 'incident_reports' })
  @Patch('incidents/:id')
  updateIncident(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: UpdateIncidentDto) {
    return this.compliance.updateIncident(caller, id, dto);
  }

  /** Searching the audit log is itself audited. */
  @Permissions('audit_logs:read')
  @Audit({ action: 'SEARCH_AUDIT_LOG', resourceType: 'audit_logs' })
  @Get('audit-logs')
  auditLogs(@CurrentUser() caller: AuthUser, @Query() query: AuditLogQueryDto) {
    return this.compliance.auditLogs(caller, query);
  }

  @Permissions('audit_logs:read')
  @Get('hipaa-checklist')
  hipaaChecklist(@CurrentUser() caller: AuthUser) {
    return this.compliance.hipaaChecklist(caller);
  }
}

@Module({
  imports: [PatientsModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, CredentialExpiryJob],
  exports: [ComplianceService, CredentialExpiryJob],
})
export class ComplianceModule {}
