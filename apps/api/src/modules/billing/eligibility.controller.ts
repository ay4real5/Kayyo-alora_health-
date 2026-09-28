import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { CreateEligibilityCheckDto, EligibilityResponseDto, ListEligibilityQueryDto } from './dto/eligibility.dto.js';
import { EligibilityService } from './eligibility.service.js';

const uuid = () => new ParseUUIDPipe();

/** Eligibility verification, X12 270/271 (DESIGN.md §6.10, DECISIONS D-060). */
@ApiTags('billing')
@Controller('billing/eligibility')
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Permissions('billing:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListEligibilityQueryDto) {
    return this.eligibility.list(caller, query.patientId);
  }

  /** Makes the 270 for the patient's primary payer. 422 ELIGIBILITY_INCOMPLETE lists what's missing. */
  @Permissions('billing:read')
  @Audit({ action: 'REQUEST_ELIGIBILITY', resourceType: 'eligibility_checks' })
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateEligibilityCheckDto) {
    return this.eligibility.create(caller, dto.patientId, dto.serviceDate);
  }

  /** A 271 answer; filed on the request with the same trace number. */
  @Permissions('billing:update')
  @Audit({ action: 'RECORD_ELIGIBILITY_RESPONSE', resourceType: 'eligibility_checks' })
  @Post('responses')
  respond(@CurrentUser() caller: AuthUser, @Body() dto: EligibilityResponseDto) {
    return this.eligibility.recordResponse(caller, dto.content);
  }

  @Permissions('billing:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.eligibility.get(caller, id);
  }

  /** The 270 file, to send through the clearinghouse portal until P3-08 connects it. */
  @Permissions('billing:read')
  @Get(':id/270')
  async request270(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    const file = await this.eligibility.request270(caller, id);
    return new StreamableFile(Buffer.from(file.content), {
      type: 'application/edi-x12',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }
}
