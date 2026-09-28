import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ASSESSMENT_TYPES, DISCIPLINES } from '@alora/shared';
import { trimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

// ── Medications ─────────────────────────────────────────────────────────────────────────────────────

export class MedicationDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  drugName!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  ndcCode?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  dosage?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  frequency?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  route?: string;

  @IsOptional()
  @IsUUID()
  prescribingPhysicianId?: string;

  @IsOptional()
  @IsDateOnly()
  startDate?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateMedicationDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  dosage?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  frequency?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  route?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class DiscontinueMedicationDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  /** Default: today (agency time). */
  @IsOptional()
  @IsDateOnly()
  endDate?: string;
}

export class ListMedicationsQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeInactive?: boolean;
}

// ── Physician orders ────────────────────────────────────────────────────────────────────────────────

export const ORDER_TYPES = [
  'verbal',
  'plan_of_care',
  'medication',
  'visit_frequency',
  'other',
] as const;

export class PhysicianOrderDto {
  @IsIn(ORDER_TYPES)
  orderType!: (typeof ORDER_TYPES)[number];

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsUUID()
  physicianId?: string;

  /** Default: today (agency time). */
  @IsOptional()
  @IsDateOnly()
  orderedDate?: string;

  @IsOptional()
  @IsDateOnly()
  effectiveDate?: string;

  @IsOptional()
  @IsDateOnly()
  expiryDate?: string;
}

export class OrderStatusDto {
  @IsIn(['sent', 'signed', 'cancelled'])
  status!: 'sent' | 'signed' | 'cancelled';

  /** Date sent or signed (default today). */
  @IsOptional()
  @IsDateOnly()
  date?: string;
}

// ── Care plans ──────────────────────────────────────────────────────────────────────────────────────

class InterventionDto {
  @IsIn(DISCIPLINES)
  discipline!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;
}

class FrequencyDto {
  @IsIn(DISCIPLINES)
  discipline!: string;

  /** e.g. "3W8" (3 visits a week for 8 weeks), "1W4, 2PRN". */
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  frequency!: string;
}

export class CarePlanDto {
  @IsOptional()
  @IsUUID()
  physicianId?: string;

  @IsDateOnly()
  certificationPeriodStart!: string;

  @IsDateOnly()
  certificationPeriodEnd!: string;

  @IsOptional()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @ArrayMaxSize(50)
  goals?: string[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => InterventionDto)
  @ArrayMaxSize(100)
  interventions?: InterventionDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FrequencyDto)
  @ArrayMaxSize(20)
  visitFrequency?: FrequencyDto[];
}

export class UpdateCarePlanDto {
  @IsOptional()
  @IsUUID()
  physicianId?: string;

  @IsOptional()
  @IsDateOnly()
  certificationPeriodStart?: string;

  @IsOptional()
  @IsDateOnly()
  certificationPeriodEnd?: string;

  @IsOptional()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @ArrayMaxSize(50)
  goals?: string[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => InterventionDto)
  @ArrayMaxSize(100)
  interventions?: InterventionDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FrequencyDto)
  @ArrayMaxSize(20)
  visitFrequency?: FrequencyDto[];
}

export class ActivateCarePlanDto {
  /** When the physician signed the plan of care. */
  @IsDateOnly()
  physicianSignatureDate!: string;
}

// ── Assessments ─────────────────────────────────────────────────────────────────────────────────────

export class AssessmentDto {
  @IsIn(ASSESSMENT_TYPES)
  type!: (typeof ASSESSMENT_TYPES)[number];

  @IsOptional()
  @IsUUID()
  visitId?: string;

  /** The form's answers (scored for morse_fall and braden). */
  @IsObject()
  data!: Record<string, unknown>;
}

export class UpdateAssessmentDto {
  @IsObject()
  data!: Record<string, unknown>;
}

export class ApproveAssessmentDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ListAssessmentsQueryDto {
  @IsOptional()
  @IsIn(ASSESSMENT_TYPES)
  type?: string;
}
