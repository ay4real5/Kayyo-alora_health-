import { checkPassword } from '@alora/shared';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** Applies the shared password policy (12+ chars, upper, lower, number, special). */
function IsStrongPassword(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isStrongPassword',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && checkPassword(value).valid,
        defaultMessage: (args) =>
          `${args?.property ?? 'password'} ${checkPassword(String(args?.value ?? '')).problems.join(', ')}`,
      },
    });
  };
}

export class LoginDto {
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

  @IsStrongPassword()
  newPassword!: string;
}
