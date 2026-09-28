import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { trimmed, upperTrimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

export const CLAIM_STATUSES = [
  'draft',
  'ready',
  'submitted',
  'acknowledged',
  'rejected',
  'paid',
  'partially_paid',
  'denied',
  /** An appeal is pending with the payer (D-063). */
  'appealed',
  /** Superseded by a corrected claim (frequency 7). */
  'replaced',
  'void',
] as const;

/** Either specific visits, or every ready, unbilled completed visit in a date range (optionally one payer). */
export class CreateClaimsDto {
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  visitIds?: string[];

  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsUUID()
  payerId?: string;
}

export class ListClaimsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(CLAIM_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  payerId?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;
}

export class VoidClaimDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class Upload835Dto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  /** The 835 file's text (up to 5 MB). */
  @IsString()
  @IsNotEmpty()
  content!: string;
}

/** Institutional claim fields (D-061). Empty string clears HIPPS/CBSA. */
export class InstitutionalClaimDto {
  /** e.g. 0329 home health final claim, 0322 interim, 0327 replacement. */
  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(/^0\d{2}[0-9A-Z]$/, { message: 'typeOfBill must look like 0329' })
  typeOfBill?: string;

  /** UB-04 patient discharge status: 30 still a patient, 01 home, 02 hospital, 20 expired, … */
  @IsOptional()
  @Matches(/^\d{2}$/, { message: 'patientStatus is two digits, e.g. 30' })
  patientStatus?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(/^([0-9A-Z]{5})?$/, { message: 'hippsCode is 5 letters or digits' })
  hippsCode?: string;

  @IsOptional()
  @Matches(/^(\d{5})?$/, { message: 'cbsaCode is 5 digits' })
  cbsaCode?: string;
}

export class FileAppealDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  reason!: string;

  /** Default: today. */
  @IsOptional()
  @IsDateOnly()
  filedOn?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export const APPEAL_OUTCOMES = ['won', 'lost', 'withdrawn'] as const;

export class DecideAppealDto {
  @IsIn(APPEAL_OUTCOMES)
  outcome!: (typeof APPEAL_OUTCOMES)[number];

  @IsOptional()
  @IsDateOnly()
  decidedOn?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class RebillClaimDto {
  /** What was corrected (kept on the new claim's notes). */
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class AgingQueryDto {
  /** Age balances as of this date (default today). */
  @IsOptional()
  @IsDateOnly()
  asOf?: string;
}
