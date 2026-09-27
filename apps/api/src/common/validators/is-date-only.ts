import { registerDecorator, type ValidationOptions } from 'class-validator';

/** A real calendar date written YYYY-MM-DD, optionally not in the future. */
export function IsDateOnly(options: { notInFuture?: boolean } = {}, validation?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: propertyName as string,
      options: validation,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
          const date = new Date(`${value}T00:00:00Z`);
          if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
          if (date.getUTCFullYear() < 1900) return false;
          return !options.notInFuture || date.getTime() <= Date.now();
        },
        defaultMessage: (args) =>
          `${args?.property} must be a valid date (YYYY-MM-DD)${options.notInFuture ? ' not in the future' : ''}`,
      },
    });
  };
}
