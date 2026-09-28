import { isValidNpi } from '@alora/shared';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** 10-digit NPI with a valid check digit (typos are caught here, not at claim time). */
export function IsNpi(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isNpi',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidNpi(value),
        defaultMessage: () =>
          `${String(propertyName)} must be a valid 10-digit National Provider Identifier`,
      },
    });
  };
}
