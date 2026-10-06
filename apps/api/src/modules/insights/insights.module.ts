import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { BillingModule } from '../billing/billing.module.js';
import { ReferralsModule } from '../referrals/referrals.module.js';
import { InsightsService } from './insights.service.js';
import { WorkforceService } from './workforce.service.js';

/** Optional agency-date window; each report has its own default length. */
export class InsightsRangeQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

/** The Command Center (D-093). Any signed-in staff member; each section needs its own permission. */
@ApiTags('insights')
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly workforce: WorkforceService,
  ) {}

  @Get('command-center')
  commandCenter(@CurrentUser() caller: AuthUser) {
    return this.insights.commandCenter(caller);
  }

  /** EVV patterns worth a look (D-097), default the last 14 days. People who approve EVV. */
  @Permissions('evv:approve')
  @Get('evv-anomalies')
  evvAnomalies(@CurrentUser() caller: AuthUser, @Query() q: InsightsRangeQueryDto) {
    return this.workforce.anomalies(caller, q.from, q.to);
  }

  /** Care Scores for every active caregiver (D-097), default the last 30 days. Decision support for admins/supervisors. */
  @Permissions('staff:update', 'reports:read')
  @Get('care-scores')
  careScores(@CurrentUser() caller: AuthUser, @Query() q: InsightsRangeQueryDto) {
    return this.workforce.careScores(caller, q.from, q.to);
  }

  @Permissions('staff:update', 'reports:read')
  @Get('care-scores/:staffId')
  careScore(@CurrentUser() caller: AuthUser, @Param('staffId', new ParseUUIDPipe()) staffId: string, @Query() q: InsightsRangeQueryDto) {
    return this.workforce.careScoreFor(caller, staffId, q.from, q.to);
  }

  /** The signed-in caregiver's own recognition badges (only when the agency has them switched on). */
  @Get('my-recognition')
  myRecognition(@CurrentUser() caller: AuthUser) {
    return this.workforce.myRecognition(caller);
  }
}

@Module({
  imports: [BillingModule, ReferralsModule],
  controllers: [InsightsController],
  providers: [InsightsService, WorkforceService],
  exports: [InsightsService, WorkforceService],
})
export class InsightsModule {}
