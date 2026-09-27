import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsStrongPassword } from '../../../common/validators/is-strong-password.js';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export class CreateUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

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

  @IsOptional()
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string;

  /**
   * Starting password, 12-128 characters with upper, lower, number and special character. The user must
   * change it at first login (mustChangePassword).
   */
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsStrongPassword()
  password!: string;

  /** Role ids: built-in roles, or this agency's custom roles. */
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string;

  /** Replaces the user's roles entirely. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  roleIds?: string[];
}

export class ListUsersQueryDto extends PaginationQueryDto {
  /** Matches first name, last name or email. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  /** Role name, e.g. registered_nurse. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;
}
