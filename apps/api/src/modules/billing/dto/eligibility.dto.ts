import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

export class CreateEligibilityCheckDto {
  @IsUUID()
  patientId!: string;

  /** The date coverage is asked about (default: today in the agency's timezone). */
  @IsOptional()
  @IsDateOnly()
  serviceDate?: string;
}

export class ListEligibilityQueryDto {
  @IsUUID()
  patientId!: string;
}

/** A 271 file's text, as uploaded (D-060). */
export class EligibilityResponseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1_000_000)
  content!: string;
}
