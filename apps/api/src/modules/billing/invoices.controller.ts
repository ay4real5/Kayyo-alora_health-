import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { CreateInvoicesDto, ListInvoicesQueryDto, RecordInvoicePaymentDto, VoidInvoiceDto } from './dto/invoices.dto.js';
import { InvoicesService } from './invoices.service.js';

const uuid = () => new ParseUUIDPipe();

/** Private-pay invoices (DESIGN.md §6.10, DECISIONS D-059). */
@ApiTags('billing')
@Controller('billing/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Permissions('billing:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListInvoicesQueryDto) {
    return this.invoices.list(caller, query);
  }

  /** One invoice per private-pay patient for their billable, uninvoiced visits in the range. */
  @Permissions('billing:create')
  @Audit({ action: 'CREATE_INVOICES', resourceType: 'invoices' })
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateInvoicesDto) {
    return this.invoices.create(caller, dto);
  }

  @Permissions('billing:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.invoices.get(caller, id);
  }

  @Permissions('billing:read')
  @Audit({ action: 'DOWNLOAD_INVOICE', resourceType: 'invoices' })
  @Get(':id/pdf')
  async pdf(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    const file = await this.invoices.pdf(caller, id);
    return new StreamableFile(file.content, {
      type: 'application/pdf',
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.content.length,
    });
  }

  @Permissions('billing:send')
  @Audit({ action: 'SEND_INVOICE', resourceType: 'invoices' })
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.invoices.markSent(caller, id);
  }

  @Permissions('billing:update')
  @Audit({ action: 'RECORD_INVOICE_PAYMENT', resourceType: 'invoices' })
  @Post(':id/record-payment')
  @HttpCode(HttpStatus.OK)
  recordPayment(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: RecordInvoicePaymentDto) {
    return this.invoices.recordPayment(caller, id, dto);
  }

  @Permissions('billing:void')
  @Audit({ action: 'VOID_INVOICE', resourceType: 'invoices' })
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: VoidInvoiceDto) {
    return this.invoices.void(caller, id, dto.reason);
  }
}
