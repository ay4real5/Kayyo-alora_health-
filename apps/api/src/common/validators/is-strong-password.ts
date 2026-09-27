import { checkPassword } from '@alora/shared';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Applies the shared password policy (12-128 chars, upper, lower, number, special). */
export function IsStrongPassword(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isStrongPassword',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && checkPassword(value).valid,
        defaultMessage: (args) => {
          const value = typeof args?.value === 'string' ? args.value : '';
          return `${args?.property ?? 'password'} ${checkPassword(value).problems.join(', ')}`;
        },
      },
    });
  };
}
