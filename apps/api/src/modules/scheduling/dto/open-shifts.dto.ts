import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { trimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

export class CreateOpenShiftDto {
  /** A scheduled visit. If it has a caregiver, they are taken off it (e.g. they called out) and told. */
  @IsUUID()
  visitId!: string;

  /** Shown to caregivers — no patient details (they see only area and time before claiming). */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** After this moment nobody can claim it (ISO 8601). */
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}

export class ListOpenShiftsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['open', 'filled', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;
}

export class AssignOpenShiftDto {
  @IsUUID()
  staffId!: string;

  /** Book despite blocking conflicts (needs visits:approve; audited). */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class CreateShiftSwapDto {
  /** One of your own scheduled visits. */
  @IsUUID()
  visitId!: string;

  /** A colleague who'll take it; leave out to hand it back to the pool (it becomes an open shift when approved). */
  @IsOptional()
  @IsUUID()
  targetStaffId?: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class ListShiftSwapsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'denied', 'cancelled'])
  status?: string;
}

export class DecideShiftSwapDto {
  @IsIn(['approved', 'denied'])
  status!: 'approved' | 'denied';

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** When approving onto a colleague with blocking conflicts (needs visits:approve; audited). */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}
