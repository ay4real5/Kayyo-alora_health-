import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { AuthorizationsService } from './authorizations.service.js';
import { BillingReadinessService } from './billing-readiness.service.js';
import { BillingSetupService } from './billing-setup.service.js';
import {
  AuthorizationDto,
  EndPayerRateDto,
  ListActiveQueryDto,
  PayerDto,
  PayerRateDto,
  ReadinessQueryDto,
  ServiceCodeDto,
  UpdateAuthorizationDto,
  UpdatePayerDto,
  UpdateServiceCodeDto,
} from './dto/billing-setup.dto.js';

const uuid = () => new ParseUUIDPipe();

/**
 * Billing setup (DECISIONS D-050). Payers and service codes are readable by anyone who works with authorizations
 * (office + billing) so they can pick them; changing them, and anything about money (rates), is billing's.
 */
@ApiTags('billing')
@Controller('billing')
export class BillingSetupController {
  constructor(
    private readonly setup: BillingSetupService,
    private readonly readiness: BillingReadinessService,
  ) {}

  @Permissions('authorizations:read')
  @Get('payers')
  listPayers(@CurrentUser() caller: AuthUser, @Query() query: ListActiveQueryDto) {
    return this.setup.listPayers(caller, query);
  }

  @Permissions('authorizations:read')
  @Get('payers/:id')
  getPayer(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.setup.getPayer(caller, id);
  }

  @Permissions('billing:update')
  @Audit({ action: 'CREATE_PAYER', resourceType: 'payers' })
  @Post('payers')
  createPayer(@CurrentUser() caller: AuthUser, @Body() dto: PayerDto) {
    return this.setup.createPayer(caller, dto);
  }

  @Permissions('billing:update')
  @Audit({ action: 'UPDATE_PAYER', resourceType: 'payers' })
  @Patch('payers/:id')
  updatePayer(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdatePayerDto,
  ) {
    return this.setup.updatePayer(caller, id, dto);
  }

  @Permissions('billing:read')
  @Get('payers/:id/rates')
  listRates(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.setup.listRates(caller, id);
  }

  /** Adds a rate period. Periods for the same code and modifiers may not overlap (409 says which one to end). */
  @Permissions('billing:update')
  @Audit({ action: 'CREATE_PAYER_RATE', resourceType: 'payers' })
  @Post('payers/:id/rates')
  createRate(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Body() dto: PayerRateDto,
  ) {
    return this.setup.createRate(caller, id, dto);
  }

  /** Ends a rate (rates are history — never edited). */
  @Permissions('billing:update')
  @Audit({ action: 'END_PAYER_RATE', resourceType: 'payer_rates' })
  @Patch('payer-rates/:id')
  endRate(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Body() dto: EndPayerRateDto,
  ) {
    return this.setup.endRate(caller, id, dto);
  }

  /**
   * Pre-billing QA: completed visits with every check (EVV verified, note final, authorization, rate, IDs…), units,
   * rate and amount, plus a summary of what blocks the rest (D-051).
   */
  @Permissions('billing:read')
  @Audit({ action: 'VIEW_BILLING_READINESS', resourceType: 'billing' })
  @Get('ready-to-bill')
  readyToBill(@CurrentUser() caller: AuthUser, @Query() query: ReadinessQueryDto) {
    return this.readiness.list(caller, query);
  }

  @Permissions('authorizations:read')
  @Get('service-codes')
  listServiceCodes(@CurrentUser() caller: AuthUser, @Query() query: ListActiveQueryDto) {
    return this.setup.listServiceCodes(caller, query);
  }

  @Permissions('billing:update')
  @Audit({ action: 'CREATE_SERVICE_CODE', resourceType: 'service_codes' })
  @Post('service-codes')
  createServiceCode(@CurrentUser() caller: AuthUser, @Body() dto: ServiceCodeDto) {
    return this.setup.createServiceCode(caller, dto);
  }

  @Permissions('billing:update')
  @Audit({ action: 'UPDATE_SERVICE_CODE', resourceType: 'service_codes' })
  @Patch('service-codes/:id')
  updateServiceCode(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateServiceCodeDto,
  ) {
    return this.setup.updateServiceCode(caller, id, dto);
  }
}

/** A patient's service authorizations (DESIGN.md §6.2). Usage is computed from the linked visits. */
@ApiTags('patients')
@Controller('patients/:patientId/authorizations')
export class AuthorizationsController {
  constructor(private readonly authorizations: AuthorizationsService) {}

  @Permissions('authorizations:read')
  @Audit({ resourceType: 'patients', idParam: 'patientId' })
  @Get()
  list(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.authorizations.list(caller, patientId);
  }

  @Permissions('authorizations:manage')
  @Audit({ action: 'CREATE_AUTHORIZATION', resourceType: 'patients', idParam: 'patientId' })
  @Post()
  create(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Body() dto: AuthorizationDto,
  ) {
    return this.authorizations.create(caller, patientId, dto);
  }

  @Permissions('authorizations:manage')
  @Audit({ action: 'UPDATE_AUTHORIZATION', resourceType: 'authorizations' })
  @Patch(':id')
  update(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateAuthorizationDto,
  ) {
    return this.authorizations.update(caller, patientId, id, dto);
  }
}
