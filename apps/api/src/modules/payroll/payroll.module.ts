import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { AdjustPayStubDto, CreatePayPeriodDto, DecideMileageDto, ListMileageQueryDto, LogMileageDto } from './dto/payroll.dto.js';
import { PayrollService } from './payroll.service.js';

const uuid = () => new ParseUUIDPipe();

/** Payroll (DESIGN.md §6.8, DECISIONS D-064). */
@ApiTags('payroll')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Permissions('payroll:read')
  @Get('pay-periods')
  listPeriods(@CurrentUser() caller: AuthUser, @Query() query: PaginationQueryDto) {
    return this.payroll.listPeriods(caller, query);
  }

  @Permissions('payroll:create')
  @Audit({ action: 'CREATE_PAY_PERIOD', resourceType: 'pay_periods' })
  @Post('pay-periods')
  createPeriod(@CurrentUser() caller: AuthUser, @Body() dto: CreatePayPeriodDto) {
    return this.payroll.createPeriod(caller, dto);
  }

  @Permissions('payroll:read')
  @Get('pay-periods/:id')
  getPeriod(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.payroll.getPeriod(caller, id);
  }

  @Permissions('payroll:create')
  @Audit({ action: 'CALCULATE_PAYROLL', resourceType: 'pay_periods' })
  @Post('pay-periods/:id/calculate')
  @HttpCode(HttpStatus.OK)
  calculate(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.payroll.calculate(caller, id);
  }

  @Permissions('payroll:approve')
  @Audit({ action: 'APPROVE_PAYROLL', resourceType: 'pay_periods' })
  @Post('pay-periods/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.payroll.approve(caller, id);
  }

  /** CSV for the payroll provider. */
  @Permissions('payroll:export')
  @Audit({ action: 'EXPORT_PAYROLL', resourceType: 'pay_periods' })
  @Post('pay-periods/:id/export')
  @HttpCode(HttpStatus.OK)
  export(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.payroll.exportCsv(caller, id);
  }

  /** The caller's own approved stubs ("My pay"). */
  @Audit({ action: 'VIEW_OWN_PAY_STUBS', resourceType: 'pay_stubs' })
  @Get('my-stubs')
  myStubs(@CurrentUser() caller: AuthUser) {
    return this.payroll.myStubs(caller);
  }

  /** payroll:read, or the staff member's own stub once approved. */
  @Audit({ action: 'VIEW_PAY_STUB', resourceType: 'pay_stubs' })
  @Get('pay-stubs/:id')
  getStub(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.payroll.getStub(caller, id);
  }

  @Permissions('payroll:update')
  @Audit({ action: 'ADJUST_PAY_STUB', resourceType: 'pay_stubs' })
  @Patch('pay-stubs/:id')
  adjustStub(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: AdjustPayStubDto) {
    return this.payroll.adjustStub(caller, id, dto);
  }

  /** Staff log their own mileage; payroll staff can log for others. */
  @Audit({ action: 'LOG_MILEAGE', resourceType: 'mileage_logs' })
  @Post('mileage')
  logMileage(@CurrentUser() caller: AuthUser, @Body() dto: LogMileageDto) {
    return this.payroll.logMileage(caller, dto);
  }

  @Audit({ action: 'VIEW_MILEAGE', resourceType: 'mileage_logs' })
  @Get('mileage')
  listMileage(@CurrentUser() caller: AuthUser, @Query() query: ListMileageQueryDto) {
    return this.payroll.listMileage(caller, query);
  }

  @Permissions('payroll:approve')
  @Audit({ action: 'DECIDE_MILEAGE', resourceType: 'mileage_logs' })
  @Patch('mileage/:id')
  decideMileage(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: DecideMileageDto) {
    return this.payroll.decideMileage(caller, id, dto);
  }
}

@Module({
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
