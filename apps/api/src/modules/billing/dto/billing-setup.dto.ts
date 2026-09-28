import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  trimmed,
  upperTrimmed,
  US_STATE,
  US_ZIP,
  PHONE,
} from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

export const PAYER_TYPES = [
  'medicare',
  'medicaid',
  'medicaid_mco',
  'commercial',
  'va',
  'private_pay',
  'other',
] as const;
export const CODE_TYPES = ['hcpcs', 'cpt', 'revenue'] as const;
export const UNIT_TYPES = ['visit', 'hour', 'unit_15min', 'day'] as const;

export class PayerDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsIn(PAYER_TYPES)
  payerType!: (typeof PAYER_TYPES)[number];

  /** The payer's ID for electronic claims (clearinghouse payer ID). */
  @IsOptional()
  @Transform(upperTrimmed)
  @IsString()
  @MaxLength(50)
  payerIdCode?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(US_STATE)
  state?: string;

  @IsOptional()
  @Matches(US_ZIP)
  zip?: string;

  @IsOptional()
  @Matches(PHONE)
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  timelyFilingDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresAuthorization?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayerDto implements Partial<PayerDto> {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(PAYER_TYPES)
  payerType?: (typeof PAYER_TYPES)[number];

  @IsOptional()
  @Transform(upperTrimmed)
  @IsString()
  @MaxLength(50)
  payerIdCode?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(US_STATE)
  state?: string;

  @IsOptional()
  @Matches(US_ZIP)
  zip?: string;

  @IsOptional()
  @Matches(PHONE)
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  timelyFilingDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresAuthorization?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListActiveQueryDto extends PaginationQueryDto {
  /** Default: active only. */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;
}

export class ServiceCodeDto {
  @Transform(upperTrimmed)
  @Matches(/^[A-Z0-9]{3,10}$/, {
    message: 'code must be 3–10 letters or digits (e.g. G0156, T1019)',
  })
  code!: string;

  @IsIn(CODE_TYPES)
  codeType!: (typeof CODE_TYPES)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  defaultRate?: number;

  @IsIn(UNIT_TYPES)
  unitType!: (typeof UNIT_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  requiresAuth?: boolean;
}

export class UpdateServiceCodeDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  defaultRate?: number;

  @IsOptional()
  @IsIn(UNIT_TYPES)
  unitType?: (typeof UNIT_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  requiresAuth?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const MODIFIER = /^[A-Z0-9]{2}$/;

export class PayerRateDto {
  @IsUUID()
  serviceCodeId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  rate!: number;

  @IsDateOnly()
  effectiveDate!: string;

  @IsOptional()
  @IsDateOnly()
  endDate?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(MODIFIER, { message: 'modifier1 must be 2 letters or digits' })
  modifier1?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(MODIFIER, { message: 'modifier2 must be 2 letters or digits' })
  modifier2?: string;
}

export class EndPayerRateDto {
  /** Last day the rate applies (a new rate can start the next day). */
  @IsDateOnly()
  endDate!: string;
}

export class AuthorizationDto {
  @IsUUID()
  payerId!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  authorizationNumber?: string;

  /** The service code it covers; leave out for "any service from this payer". */
  @IsOptional()
  @Transform(upperTrimmed)
  @IsString()
  @MaxLength(20)
  serviceCode?: string;

  @IsDateOnly()
  startDate!: string;

  @IsDateOnly()
  endDate!: string;

  /** Visits allowed; with authorizedHours, either or both. */
  @ValidateIf(
    (o: AuthorizationDto) => o.authorizedHours === undefined || o.authorizedVisits !== undefined,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  authorizedVisits?: number;

  @ValidateIf(
    (o: AuthorizationDto) => o.authorizedVisits === undefined || o.authorizedHours !== undefined,
  )
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(100_000)
  authorizedHours?: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateAuthorizationDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  authorizationNumber?: string;

  @IsOptional()
  @IsDateOnly()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  authorizedVisits?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(100_000)
  authorizedHours?: number;

  /** Cancelled authorizations are kept for history but no longer cover visits. */
  @IsOptional()
  @IsIn(['active', 'cancelled'])
  status?: 'active' | 'cancelled';

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
