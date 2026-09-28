import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { PHONE, trimmed, upperTrimmed, US_STATE, US_ZIP } from '../../../common/validators/fields.js';
import { IsNpi } from '../../../common/validators/is-npi.js';

export class CreatePhysicianDto {
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

  /** National Provider Identifier, unique within the agency. */
  @IsOptional()
  @Transform(trimmed)
  @IsNpi()
  npi?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  practiceName?: string;

  @IsOptional()
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string;

  /** Orders and care plans are faxed to physicians for signature (DESIGN.md §6.9). */
  @IsOptional()
  @Matches(PHONE, { message: 'fax must be a valid fax number' })
  fax?: string;

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
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(US_STATE, { message: 'state must be a two-letter state code' })
  state?: string;

  @IsOptional()
  @Matches(US_ZIP, { message: 'zip must be 12345 or 12345-6789' })
  zip?: string;
}

export class UpdatePhysicianDto extends PartialType(CreatePhysicianDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListPhysiciansQueryDto extends PaginationQueryDto {
  /** Matches name, practice name or exact NPI. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;
}
