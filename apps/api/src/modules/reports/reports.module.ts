import { Controller, Get, HttpCode, HttpStatus, Injectable, Logger, Module, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { IsDateOnly } from '../../common/validators/is-date-only.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { BillingModule } from '../billing/billing.module.js';
import { ReportsService, toCsv } from './reports.service.js';

export class ReportQueryDto {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  /** csv → `{ fileName, content }` instead of JSON (list reports only). */
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

/** Every 15 minutes (DESIGN.md §14.2). Idempotent; several API instances may run it. */
@Injectable()
export class ReportsRefreshJob {
  private readonly logger = new Logger(ReportsRefreshJob.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Cron('*/15 * * * *', { name: 'report-views' })
  async run(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return;
    try {
      await this.reports.refreshViews();
    } catch (error) {
      this.logger.error('report view refresh failed', (error as Error).stack);
    }
  }
}

/** Reports (DESIGN.md §6.11, §14, DECISIONS D-065). `reports:read`. */
@ApiTags('reports')
@Permissions('reports:read')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('census')
  async census(@CurrentUser() caller: AuthUser, @Query() q: ReportQueryDto) {
    return this.reports.census(caller, await this.reports.range(caller, q.from, q.to));
  }

  @Get('visit-utilization')
  async visitUtilization(@CurrentUser() caller: AuthUser, @Query() q: ReportQueryDto) {
    const r = await this.reports.visitUtilization(caller, await this.reports.range(caller, q.from, q.to));
    if (q.format !== 'csv') return r;
    return {
      fileName: `visit-utilization-${r.from}-to-${r.to}.csv`,
      content: toCsv(
        [
          { key: 'date', label: 'Date' },
          { key: 'scheduled', label: 'Scheduled' },
          { key: 'completed', label: 'Completed' },
          { key: 'missed', label: 'Missed' },
          { key: 'cancelled', label: 'Cancelled' },
          { key: 'open', label: 'Not yet done' },
        ],
        r.daily,
      ),
    };
  }

  @Get('evv-compliance')
  async evvCompliance(@CurrentUser() caller: AuthUser, @Query() q: ReportQueryDto) {
    return this.reports.evvCompliance(caller, await this.reports.range(caller, q.from, q.to));
  }

  @Get('staff-productivity')
  async staffProductivity(@CurrentUser() caller: AuthUser, @Query() q: ReportQueryDto) {
    const r = await this.reports.staffProductivity(caller, await this.reports.range(caller, q.from, q.to));
    if (q.format !== 'csv') return r;
    return {
      fileName: `staff-productivity-${r.from}-to-${r.to}.csv`,
      content: toCsv(
        [
          { key: 'name', label: 'Staff' },
          { key: 'discipline', label: 'Discipline' },
          { key: 'completedVisits', label: 'Completed visits' },
          { key: 'missedVisits', label: 'Missed visits' },
          { key: 'hours', label: 'Hours (EVV)' },
          { key: 'averageVisitMinutes', label: 'Average visit (min)' },
        ],
        r.rows,
      ),
    };
  }

  /** Lists patients by name — audited as a report download when exported. */
  @Audit({ action: 'REPORT_MISSED_VISITS', resourceType: 'reports' })
  @Get('missed-visits')
  async missedVisits(@CurrentUser() caller: AuthUser, @Query() q: ReportQueryDto) {
    const r = await this.reports.missedVisits(caller, await this.reports.range(caller, q.from, q.to));
    if (q.format !== 'csv') return r;
    return {
      fileName: `missed-visits-${r.from}-to-${r.to}.csv`,
      content: toCsv(
        [
          { key: 'date', label: 'Date' },
          { key: 'patient', label: 'Patient' },
          { key: 'mrn', label: 'MRN' },
          { key: 'caregiver', label: 'Caregiver' },
          { key: 'visitType', label: 'Visit type' },
          { key: 'status', label: 'Status' },
          { key: 'reason', label: 'Reason' },
        ],
        r.rows,
      ),
    };
  }

  @Get('financial-summary')
  async financialSummary(@CurrentUser() caller: AuthUser, @Query() q: ReportQueryDto) {
    return this.reports.financialSummary(caller, await this.reports.range(caller, q.from, q.to));
  }

  /** "Refresh now" — the views otherwise refresh every 15 minutes. */
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  refresh() {
    return this.reports.refreshViews();
  }
}

@Module({
  imports: [BillingModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRefreshJob],
  exports: [ReportsService],
})
export class ReportsModule {}
