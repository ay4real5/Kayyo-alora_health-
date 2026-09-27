import { VISIT_PRIORITIES, VISIT_STATUSES, VISIT_TYPES } from '@alora/shared';
import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { trimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const boolQuery = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class CreateVisitDto {
  @IsUUID()
  patientId!: string;

  /** Leave out to create an unassigned visit (e.g. to post as an open shift later). */
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsIn(VISIT_TYPES)
  visitType!: (typeof VISIT_TYPES)[number];

  /** HCPCS/revenue code used for billing, e.g. G0299. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  serviceCode?: string;

  /** Agency-local date, YYYY-MM-DD. */
  @IsDateOnly()
  scheduledDate!: string;

  /** Agency-local time, HH:MM (24-hour). */
  @Matches(HH_MM, { message: 'scheduledStart must be HH:MM (24-hour)' })
  scheduledStart!: string;

  /** Agency-local time, HH:MM, after scheduledStart (visits don't cross midnight). */
  @Matches(HH_MM, { message: 'scheduledEnd must be HH:MM (24-hour)' })
  scheduledEnd!: string;

  @IsOptional()
  @IsIn(VISIT_PRIORITIES)
  priority?: (typeof VISIT_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Book despite blocking conflicts (double-booking, approved time off, inactive staff/patient).
   * Requires visits:approve; recorded in the audit trail.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class UpdateVisitDto extends PartialType(OmitType(CreateVisitDto, ['patientId', 'staffId'] as const)) {
  /** Reassign to another caregiver, or null to unassign. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  staffId?: string | null;
}

export class CancelVisitDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ListVisitsQueryDto extends PaginationQueryDto {
  /** From this date (inclusive), YYYY-MM-DD. */
  @IsOptional()
  @IsDateOnly()
  from?: string;

  /** To this date (inclusive), YYYY-MM-DD. */
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsIn(VISIT_STATUSES)
  status?: string;

  /** Only visits with no caregiver assigned. */
  @IsOptional()
  @Transform(boolQuery)
  @IsBoolean()
  unassigned?: boolean;
}

export class CalendarQueryDto {
  @IsDateOnly()
  from!: string;

  /** Inclusive; at most 62 days after `from`. */
  @IsDateOnly()
  to!: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @Transform(boolQuery)
  @IsBoolean()
  includeCancelled?: boolean;
}

export class ConflictCheckQueryDto {
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsIn(VISIT_TYPES)
  visitType!: (typeof VISIT_TYPES)[number];

  @IsDateOnly()
  scheduledDate!: string;

  @Matches(HH_MM, { message: 'scheduledStart must be HH:MM (24-hour)' })
  scheduledStart!: string;

  @Matches(HH_MM, { message: 'scheduledEnd must be HH:MM (24-hour)' })
  scheduledEnd!: string;

  /** When checking a change to an existing visit, leave that visit out of the double-booking check. */
  @IsOptional()
  @IsUUID()
  excludeVisitId?: string;
}
