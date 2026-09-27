import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/is-strong-password.js';

export class LoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  // No policy check here: login must accept whatever the stored password is.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  /** 12-128 characters with an uppercase letter, a lowercase letter, a number and a special character. */
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsStrongPassword()
  newPassword!: string;
}

export class TwoFactorCodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from your authenticator app' })
  code!: string;
}

/** Send `code` (from the authenticator app) or `recoveryCode` (a one-time backup code) — exactly one. */
export class TwoFactorLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  twoFactorToken!: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from your authenticator app' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  recoveryCode?: string;
}

export class RegenerateRecoveryCodesDto extends TwoFactorCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
