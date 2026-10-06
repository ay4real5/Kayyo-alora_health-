import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VISIT_NOTE_TYPES } from '@alora/shared';
import { trimmed } from '../../../common/validators/fields.js';

const TEXT_MAX = 20_000;

class NoteContentDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TEXT_MAX)
  subjective?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TEXT_MAX)
  objective?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TEXT_MAX)
  assessment?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TEXT_MAX)
  plan?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TEXT_MAX)
  narrative?: string;

  /** Structured answers from a discipline-specific form (shape owned by the client form; stored as-is). */
  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;
}

export class CreateVisitNoteDto extends NoteContentDto {
  @IsIn(VISIT_NOTE_TYPES)
  noteType!: (typeof VISIT_NOTE_TYPES)[number];

  /** For an addendum: the signed or submitted note (same visit) it amends. */
  @IsOptional()
  @IsUUID()
  amendsNoteId?: string;
}

export class UpdateVisitNoteDto extends NoteContentDto {}

export class CreateVitalsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(40)
  @Max(300)
  bloodPressureSystolic?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(200)
  bloodPressureDiastolic?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(250)
  heartRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(80)
  respiratoryRate?: number;

  /** Checked against the unit: 85–115 °F or 29–46 °C. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  temperature?: number;

  @IsOptional()
  @IsIn(['F', 'C'])
  temperatureUnit?: 'F' | 'C';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(50)
  @Max(100)
  oxygenSaturation?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1500)
  weight?: number;

  @IsOptional()
  @IsIn(['lbs', 'kg'])
  weightUnit?: 'lbs' | 'kg';

  /** 0 (none) – 10 (worst). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  painLevel?: number;

  /** mg/dL. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(1000)
  bloodGlucose?: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** When they were taken (ISO 8601). Defaults to now; may be up to 72 hours old (offline sync), not in the future. */
  @IsOptional()
  @IsISO8601({ strict: true })
  recordedAt?: string;
}

export class EnteredInErrorDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

class NewTaskDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  taskName!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class AddTasksDto {
  @ValidateNested({ each: true })
  @Type(() => NewTaskDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  tasks!: NewTaskDto[];
}

/**
 * `completed: true` — done. `completed: false` with `notDoneReason` — not done, and why (e.g. "Patient declined").
 * `completed: false` without a reason — back to open (undo).
 */
export class UpdateTaskDto {
  @IsBoolean()
  completed!: boolean;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  notDoneReason?: string;
}

/** Dictated or typed text to organize into a note draft (D-096). Nothing is saved. */
export class OrganizeNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  text!: string;
}

/** File the incident report a note flag suggests (D-096). */
export class ReportFlagDto {
  @IsOptional()
  @IsIn(['low', 'moderate', 'high', 'critical'])
  severity?: 'low' | 'moderate' | 'high' | 'critical';

  /** Defaults to the flag's reason. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

/** A short update for the family about this visit, shown in the portal (D-096). */
export class CareUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  summary!: string;

  @IsOptional()
  @IsIn(['good', 'okay', 'low'])
  mood?: 'good' | 'okay' | 'low';
}

