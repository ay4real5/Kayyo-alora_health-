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
export const CLAIM_FORMATS = ['837P', '837I'] as const;
export const EVV_CLAIM_PROFILES = ['va_dmas'] as const;
export const HOUR_ROUNDINGS = ['monthly'] as const;

export class PayerDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsIn(PAYER_TYPES)
  payerType!: (typeof PAYER_TYPES)[number];

  /** 837P (professional) or 837I (institutional / UB-04). Empty: 837I for Medicare, 837P otherwise (D-061). */
  @IsOptional()
  @IsIn(CLAIM_FORMATS)
  claimFormat?: (typeof CLAIM_FORMATS)[number];

  /** State EVV fields on claims: va_dmas = Virginia Medicaid (DMAS) and its MCOs (D-069). Empty = none. */
  @IsOptional()
  @IsIn(EVV_CLAIM_PROFILES)
  evvClaimProfile?: (typeof EVV_CLAIM_PROFILES)[number] | null;

  /** Hourly services: empty = quarter hours per visit; monthly = whole hours per month, minutes carried (D-077). */
  @IsOptional()
  @IsIn(HOUR_ROUNDINGS)
  hourRounding?: (typeof HOUR_ROUNDINGS)[number] | null;

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

  /** Interchange IDs agreed with the clearinghouse (ISA06/ISA08) for electronic claims. */
  @IsOptional()
  @Transform(upperTrimmed)
  @IsString()
  @MaxLength(15)
  ediSubmitterId?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @IsString()
  @MaxLength(15)
  ediReceiverId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  timelyFilingDays?: number;

  /** Days after a denial to appeal (D-063). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  appealWindowDays?: number;

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

  /** 837P (professional) or 837I (institutional / UB-04). Empty: 837I for Medicare, 837P otherwise (D-061). */
  @IsOptional()
  @IsIn(CLAIM_FORMATS)
  claimFormat?: (typeof CLAIM_FORMATS)[number];

  /** State EVV fields on claims: va_dmas = Virginia Medicaid (DMAS) and its MCOs (D-069). Empty = none. */
  @IsOptional()
  @IsIn(EVV_CLAIM_PROFILES)
  evvClaimProfile?: (typeof EVV_CLAIM_PROFILES)[number] | null;

  /** Hourly services: empty = quarter hours per visit; monthly = whole hours per month, minutes carried (D-077). */
  @IsOptional()
  @IsIn(HOUR_ROUNDINGS)
  hourRounding?: (typeof HOUR_ROUNDINGS)[number] | null;

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

  /** Interchange IDs agreed with the clearinghouse (ISA06/ISA08) for electronic claims. */
  @IsOptional()
  @Transform(upperTrimmed)
  @IsString()
  @MaxLength(15)
  ediSubmitterId?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @IsString()
  @MaxLength(15)
  ediReceiverId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  timelyFilingDays?: number;

  /** Days after a denial to appeal (D-063). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  appealWindowDays?: number;

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

  /** UB-04 revenue code for institutional claims, e.g. 0571 (aide), 0551 (nursing), 0421 (PT). */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'revenueCode must be 4 digits, e.g. 0571' })
  revenueCode?: string;

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

  /** UB-04 revenue code for institutional claims, e.g. 0571 (aide), 0551 (nursing), 0421 (PT). */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'revenueCode must be 4 digits, e.g. 0571' })
  revenueCode?: string;

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

export class ReadinessQueryDto extends PaginationQueryDto {
  /** Service dates from (default: 30 days before `to`). */
  @IsOptional()
  @IsDateOnly()
  from?: string;

  /** Service dates to (default: today). */
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsUUID()
  payerId?: string;

  /** true = only ready visits, false = only blocked ones; leave out for both. */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  readyOnly?: boolean;
}
