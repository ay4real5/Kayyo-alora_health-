import { ALLERGY_SEVERITIES, GENDERS, PATIENT_STATUSES } from '@alora/shared';
import { PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';
import { PHONE, trimmed, upperTrimmed, US_STATE, US_ZIP } from '../../../common/validators/fields.js';


/** SSN: 9 digits (dashes optional); rejects numbers the SSA never issues (000, 666, 9xx area; 00 group; 0000 serial). */
const SSN = /^(?!000|666|9\d\d)\d{3}-?(?!00)\d{2}-?(?!0000)\d{4}$/;

export class CreatePatientDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  /** YYYY-MM-DD */
  @IsDateOnly({ notInFuture: true })
  dateOfBirth!: string;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  /** Stored encrypted; the API only ever returns the last 4 digits. */
  @IsOptional()
  @Matches(SSN, { message: 'ssn must be a valid Social Security number' })
  ssn?: string;

  /** Medical record number, unique within the agency. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  mrn?: string;

  @IsOptional()
  @Matches(PHONE, { message: 'phoneHome must be a valid phone number' })
  phoneHome?: string;

  /** A live-in caregiver lives in the home (Virginia personal care claims get the UB modifier, D-077). */
  @IsOptional()
  @IsBoolean()
  liveIn?: boolean;

  @IsOptional()
  @Matches(PHONE, { message: 'phoneCell must be a valid phone number' })
  phoneCell?: string;

  @IsOptional()
  @Transform(trimmed)
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be an email address' })
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  city?: string;

  /** Two-letter US state code. */
  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(US_STATE, { message: 'state must be a two-letter state code' })
  state?: string;

  @IsOptional()
  @Matches(US_ZIP, { message: 'zip must be 12345 or 12345-6789' })
  zip?: string;

  /** Home location for the EVV geofence (WGS84). Set both or neither; address geocoding comes later. */
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  /** EVV geofence around the home, in meters. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(2000)
  geoFenceRadiusMeters?: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @IsOptional()
  @Matches(PHONE, { message: 'emergencyContactPhone must be a valid phone number' })
  emergencyContactPhone?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  emergencyContactRelation?: string;

  @IsOptional()
  @IsUUID()
  primaryPhysicianId?: string;

  /** Medicare Beneficiary Identifier (11 characters). */
  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(/^[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d[AC-HJKMNP-RT-Y]{2}\d{2}$/, {
    message: 'medicareBeneficiaryId must be a valid 11-character MBI',
  })
  medicareBeneficiaryId?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  medicaidId?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  insuranceMemberId?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  insuranceGroupNumber?: string;

  /** Defaults to today. */
  @IsOptional()
  @IsDateOnly({ notInFuture: true })
  admissionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

/** Everything except the admission date can be corrected later; status changes go through actions. */
export class UpdatePatientDto extends PartialType(OmitType(CreatePatientDto, ['admissionDate'] as const)) {}

export class DischargePatientDto {
  /** Defaults to today. */
  @IsOptional()
  @IsDateOnly({ notInFuture: true })
  dischargeDate?: string;
}

export class ReadmitPatientDto {
  /** Defaults to today. */
  @IsOptional()
  @IsDateOnly({ notInFuture: true })
  admissionDate?: string;
}

export class ListPatientsQueryDto extends PaginationQueryDto {
  /** Matches first name, last name or MRN. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(PATIENT_STATUSES)
  status?: (typeof PATIENT_STATUSES)[number];
}

export class CreateDiagnosisDto {
  /** ICD-10-CM, e.g. E11.9 (dot optional). */
  @IsString()
  @MaxLength(10)
  icd10Code!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Making this primary un-marks the previous primary diagnosis. */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsDateOnly({ notInFuture: true })
  onsetDate?: string;
}

export class CreateAllergyDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  allergen!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  reaction?: string;

  @IsOptional()
  @IsIn(ALLERGY_SEVERITIES)
  severity?: (typeof ALLERGY_SEVERITIES)[number];
}
