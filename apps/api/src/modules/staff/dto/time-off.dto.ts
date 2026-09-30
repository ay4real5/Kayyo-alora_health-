import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';
import { trimmed } from '../../../common/validators/fields.js';

export const TIME_OFF_TYPES = ['vacation', 'sick', 'personal', 'other'] as const;
export const TIME_OFF_STATUSES = ['pending', 'approved', 'denied', 'cancelled'] as const;
/** Longest single request; longer leave is arranged with the office. */
export const MAX_TIME_OFF_DAYS = 60;

export class RequestTimeOffDto {
  @IsDateOnly()
  startDate!: string;

  @IsDateOnly()
  endDate!: string;

  @IsIn(TIME_OFF_TYPES)
  type!: (typeof TIME_OFF_TYPES)[number];

  /** For the office; keep it short and don't include patient details. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class DecideTimeOffDto {
  @IsIn(['approved', 'denied'])
  status!: 'approved' | 'denied';
}

export class ListTimeOffQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TIME_OFF_STATUSES)
  status?: (typeof TIME_OFF_STATUSES)[number];

  /** Approvers only: one staff member's requests. */
  @IsOptional()
  @IsUUID()
  staffId?: string;
}
