import { DISCIPLINES, EMPLOYMENT_TYPES, TIME_OFF_TYPES } from '@alora/shared';
import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';
import { trimmed, upperTrimmed, US_STATE, US_ZIP } from '../../../common/validators/fields.js';

const SSN = /^(?!000|666|9\d\d)\d{3}-?(?!00)\d{2}-?(?!0000)\d{4}$/;
const MONEY = { maxDecimalPlaces: 2 } as const;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStaffDto {
  /** The user account this profile belongs to (same agency, not already staff). */
  @IsUUID()
  userId!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  employeeId?: string;

  @IsIn(DISCIPLINES)
  discipline!: (typeof DISCIPLINES)[number];

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];

  @IsOptional()
  @IsDateOnly()
  hireDate?: string;

  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  @Max(1000)
  hourlyRate?: number;

  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  @Max(5000)
  perVisitRate?: number;

  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  @Max(1500)
  overtimeRate?: number;

  /** Dollars per mile, e.g. 0.67. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(5)
  mileageRate?: number;

  /** Stored encrypted; only the last 4 digits are ever returned, and only to payroll. */
  @IsOptional()
  @Matches(SSN, { message: 'ssn must be a valid Social Security number' })
  ssn?: string;

  @IsOptional()
  @IsIn(['single', 'married', 'married_separately', 'head_of_household'])
  taxFilingStatus?: string;

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
  @Matches(US_STATE, { message: 'state must be a two-letter state code' })
  state?: string;

  @IsOptional()
  @Matches(US_ZIP, { message: 'zip must be 12345 or 12345-6789' })
  zip?: string;

  /** ZIP codes this person will travel to. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^\d{5}$/, { each: true, message: 'serviceAreaZipCodes must be 5-digit ZIP codes' })
  serviceAreaZipCodes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxPatients?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  languages?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdateStaffDto extends PartialType(OmitType(CreateStaffDto, ['userId'] as const)) {}

export class TerminateStaffDto {
  /** Defaults to today. */
  @IsOptional()
  @IsDateOnly()
  terminationDate?: string;
}

export class ListStaffQueryDto extends PaginationQueryDto {
  /** Matches first name, last name, email or employee id. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(DISCIPLINES)
  discipline?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  /** Staff who serve this ZIP code. */
  @IsOptional()
  @Matches(/^\d{5}$/)
  zip?: string;
}

export class CreateCredentialDto {
  /** e.g. license, certification, cpr, tb_test, background_check, drivers_license, training */
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  credentialType!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  credentialName!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  credentialNumber?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  issuingAuthority?: string;

  @IsOptional()
  @IsDateOnly()
  issueDate?: string;

  @IsOptional()
  @IsDateOnly()
  expiryDate?: string;

  /** Warn this many days before expiry (default 30). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  alertDaysBefore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCredentialDto extends PartialType(CreateCredentialDto) {
  /** true records the caller as having verified the credential against the original. */
  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}

export class ExpiringCredentialsQueryDto {
  /** Include credentials expiring within this many days (and already expired ones). Default 30. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  withinDays: number = 30;
}

export class AvailabilitySlotDto {
  /** 0 = Sunday … 6 = Saturday */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  /** HH:MM, 24-hour */
  @Matches(HH_MM, { message: 'startTime must be HH:MM (24-hour)' })
  startTime!: string;

  /** HH:MM, 24-hour, after startTime */
  @Matches(HH_MM, { message: 'endTime must be HH:MM (24-hour)' })
  endTime!: string;
}

export class SetAvailabilityDto {
  /** Replaces the whole weekly schedule. An empty list means "no set availability". */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  slots!: AvailabilitySlotDto[];
}

export class CreateTimeOffDto {
  @IsDateOnly()
  startDate!: string;

  @IsDateOnly()
  endDate!: string;

  @IsIn(TIME_OFF_TYPES)
  type!: (typeof TIME_OFF_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class DecideTimeOffDto {
  /** approved/denied by an approver; cancelled by the requester (pending requests only). */
  @IsIn(['approved', 'denied', 'cancelled'])
  status!: 'approved' | 'denied' | 'cancelled';
}
