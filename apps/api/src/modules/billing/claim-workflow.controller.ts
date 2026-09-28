import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { ClaimWorkflowService } from './claim-workflow.service.js';
import { AgingQueryDto, DecideAppealDto, FileAppealDto, RebillClaimDto } from './dto/claims.dto.js';

const uuid = () => new ParseUUIDPipe();

/** Submission, appeals and corrected claims (DESIGN.md §6.7, §10.1, DECISIONS D-063). */
@ApiTags('billing')
@Controller('billing/claims')
export class ClaimWorkflowController {
  constructor(private readonly workflow: ClaimWorkflowService) {}

  /** The claim was sent through the clearinghouse portal (until P3-09 automates it). */
  @Permissions('billing:submit')
  @Audit({ action: 'SUBMIT_CLAIM', resourceType: 'claims' })
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.workflow.markSubmitted(caller, id);
  }

  @Permissions('billing:update')
  @Audit({ action: 'APPEAL_CLAIM', resourceType: 'claims' })
  @Post(':id/appeals')
  appeal(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: FileAppealDto) {
    return this.workflow.fileAppeal(caller, id, dto);
  }

  @Permissions('billing:update')
  @Audit({ action: 'DECIDE_CLAIM_APPEAL', resourceType: 'claims' })
  @Post(':id/appeals/:appealId/decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('appealId', uuid()) appealId: string,
    @Body() dto: DecideAppealDto,
  ) {
    return this.workflow.decideAppeal(caller, id, appealId, dto);
  }

  /** A corrected claim (frequency 7) replacing this one. */
  @Permissions('billing:create')
  @Audit({ action: 'REBILL_CLAIM', resourceType: 'claims' })
  @Post(':id/rebill')
  rebill(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: RebillClaimDto) {
    return this.workflow.rebill(caller, id, dto.reason);
  }
}

@ApiTags('billing')
@Controller('billing/reports')
export class BillingReportsController {
  constructor(private readonly workflow: ClaimWorkflowService) {}

  /** Accounts receivable aging: 0–30, 31–60, 61–90, 91–120, 120+ days, per payer and private pay. */
  @Permissions('billing:read')
  @Get('aging')
  aging(@CurrentUser() caller: AuthUser, @Query() query: AgingQueryDto) {
    return this.workflow.aging(caller, query);
  }
}
