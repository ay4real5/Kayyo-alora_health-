import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { trimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

/** A GPS reading from the caregiver's device at clock-in or clock-out. */
export class ClockDto {
  @IsUUID()
  visitId!: string;

  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  /** Reported GPS accuracy radius in meters. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  accuracyMeters?: number;

  /**
   * When it happened on the device (ISO 8601 with offset). May be up to 72 hours old — clock events captured
   * offline are synced later — but not in the future.
   */
  @IsISO8601({ strict: true })
  timestamp!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  appVersion?: string;
}

export class ListEvvQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsIn(['in_progress', 'completed', 'exception', 'verified', 'rejected'])
  status?: string;

  /** Only records needing review (exception status or pending corrections). */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  needsReview?: boolean;
}

export class VerifyEvvDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectEvvDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string;
}

export class CreateEvvExceptionDto {
  /** Which time is being corrected. */
  @IsIn(['clock_in_time', 'clock_out_time'])
  exceptionType!: 'clock_in_time' | 'clock_out_time';

  /** The corrected time (ISO 8601 with offset). */
  @IsISO8601({ strict: true })
  correctedValue!: string;

  /** Required: why the correction is needed, e.g. "Phone battery died; caregiver left at 4:05 PM per patient". */
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class DecideEvvExceptionDto {
  @IsIn(['approved', 'denied'])
  status!: 'approved' | 'denied';
}
