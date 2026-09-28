import { Transform, Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { trimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

export const INVOICE_STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'void'] as const;
export const PAYMENT_METHODS = ['check', 'cash', 'card', 'ach', 'other'] as const;

/** Invoice every private-pay patient (or one) for their billable visits in the range (D-059). */
export class CreateInvoicesDto {
  @IsDateOnly()
  from!: string;

  @IsDateOnly()
  to!: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;
}

export class RecordInvoicePaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsDateOnly()
  paidOn!: string;

  @IsIn(PAYMENT_METHODS)
  method!: (typeof PAYMENT_METHODS)[number];

  /** Check number, card last four, transfer reference. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class VoidInvoiceDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
