import { RECURRENCE_FREQUENCIES, VISIT_TYPES } from '@alora/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
import { trimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateRecurringDto {
  @IsUUID()
  patientId!: string;

  /** Leave out for an unassigned series. */
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsIn(VISIT_TYPES)
  visitType!: (typeof VISIT_TYPES)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  serviceCode?: string;

  /** weekly, or biweekly (every other week, counted from the week of startDate). */
  @IsIn(RECURRENCE_FREQUENCIES)
  frequency!: (typeof RECURRENCE_FREQUENCIES)[number];

  /** 0 = Sunday … 6 = Saturday */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @Matches(HH_MM, { message: 'startTime must be HH:MM (24-hour)' })
  startTime!: string;

  @Matches(HH_MM, { message: 'endTime must be HH:MM (24-hour)' })
  endTime!: string;

  @IsDateOnly()
  startDate!: string;

  /** Last possible date (inclusive). Give this or maxOccurrences, or neither for an open-ended series. */
  @IsOptional()
  @IsDateOnly()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxOccurrences?: number;
}

/** Changing a rule rebuilds its future scheduled occurrences; past, in-progress and cancelled ones are kept. */
export class UpdateRecurringDto {
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  staffId?: string | null;

  @IsOptional()
  @IsIn(VISIT_TYPES)
  visitType?: (typeof VISIT_TYPES)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  serviceCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be HH:MM (24-hour)' })
  startTime?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be HH:MM (24-hour)' })
  endTime?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsDateOnly()
  endDate?: string | null;
}

export class GenerateRecurringDto {
  /** Create occurrences up to this date (default: 4 weeks from today, max 1 year). */
  @IsOptional()
  @IsDateOnly()
  until?: string;
}

export class ListRecurringQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;
}
