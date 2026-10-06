import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ComplianceModule } from '../compliance/compliance.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import {
  AdmitReferralDto,
  CreateReferralDto,
  IntakeDto,
  ListReferralsQueryDto,
  ReferralNoteDto,
  ReferralSourceDto,
  ReferralStatusDto,
  SourcesReportQueryDto,
  UpdateReferralDto,
  UpdateReferralSourceDto,
} from './dto/referrals.dto.js';
import { ReferralsService } from './referrals.service.js';

const uuid = () => new ParseUUIDPipe();

/** The referral pipeline and its sources (D-098). */
@ApiTags('referrals')
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Permissions('referrals:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() q: ListReferralsQueryDto) {
    return this.referrals.list(caller, q);
  }

  @Permissions('referrals:read')
  @Get('board')
  board(@CurrentUser() caller: AuthUser) {
    return this.referrals.board(caller);
  }

  @Permissions('referrals:read')
  @Get('sources')
  sources(@CurrentUser() caller: AuthUser) {
    return this.referrals.listSources(caller);
  }

  @Permissions('referrals:manage')
  @Audit({ action: 'CREATE_REFERRAL_SOURCE' })
  @Post('sources')
  createSource(@CurrentUser() caller: AuthUser, @Body() dto: ReferralSourceDto) {
    return this.referrals.createSource(caller, dto);
  }

  @Permissions('referrals:manage')
  @Audit({ action: 'UPDATE_REFERRAL_SOURCE' })
  @Patch('sources/:id')
  updateSource(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: UpdateReferralSourceDto) {
    return this.referrals.updateSource(caller, id, dto);
  }

  /** Referrals, admissions and conversion per source (default the last 90 days). */
  @Permissions('referrals:read')
  @Get('sources/report')
  sourcesReport(@CurrentUser() caller: AuthUser, @Query() q: SourcesReportQueryDto) {
    return this.referrals.sourcesReport(caller, q.from, q.to);
  }

  @Permissions('referrals:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.referrals.get(caller, id);
  }

  @Permissions('referrals:manage')
  @Audit({ action: 'CREATE_REFERRAL' })
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateReferralDto) {
    return this.referrals.create(caller, dto);
  }

  @Permissions('referrals:manage')
  @Audit({ action: 'UPDATE_REFERRAL' })
  @Patch(':id')
  update(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: UpdateReferralDto) {
    return this.referrals.update(caller, id, dto);
  }

  @Permissions('referrals:manage')
  @Audit({ action: 'CHANGE_REFERRAL_STATUS' })
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: ReferralStatusDto) {
    return this.referrals.setStatus(caller, id, dto);
  }

  @Permissions('referrals:manage')
  @Post(':id/notes')
  addNote(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: ReferralNoteDto) {
    return this.referrals.addNote(caller, id, dto.note);
  }

  /** Create the patient from the referral and mark it admitted. */
  @Permissions('referrals:manage', 'patients:create')
  @Audit({ action: 'ADMIT_REFERRAL' })
  @Post(':id/admit')
  @HttpCode(HttpStatus.OK)
  admit(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: AdmitReferralDto) {
    return this.referrals.admit(caller, id, dto);
  }
}

/**
 * The public "I need care" form (D-098), e.g. embedded on the agency's website. No sign-in; a few submissions per
 * hour per address. The agency id in the path is not a secret.
 */
@ApiTags('referrals')
@Public()
@Controller('intake')
export class IntakeController {
  constructor(private readonly referrals: ReferralsService) {}

  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post(':agencyId')
  @HttpCode(HttpStatus.ACCEPTED)
  submit(@Param('agencyId', uuid()) agencyId: string, @Body() dto: IntakeDto) {
    return this.referrals.intake(agencyId, dto);
  }
}

@Module({
  imports: [PatientsModule, ComplianceModule],
  controllers: [ReferralsController, IntakeController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
