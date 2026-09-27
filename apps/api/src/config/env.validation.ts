import { plainToInstance, Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum AppEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

const blankToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/**
 * Every environment variable the API reads. Validated once at startup: the app refuses to boot with a
 * bad config instead of failing later. Add new variables here (and to the root .env.example).
 */
export class EnvironmentVariables {
  @IsEnum(AppEnv)
  APP_ENV: AppEnv = AppEnv.Development;

  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  APP_PORT: number = 3001;

  @Transform(blankToUndefined)
  @IsOptional()
  @Matches(/^postgres(ql)?:\/\/.+/, { message: 'DATABASE_URL must be a postgresql:// URL' })
  DATABASE_URL?: string;

  /** Comma-separated exact origins. Wildcards are rejected (DECISIONS D-008). */
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsUrl(
    { require_protocol: true, require_tld: false, protocols: ['http', 'https'] },
    { each: true, message: 'CORS_ORIGINS entries must be exact http(s) origins, no wildcards' },
  )
  CORS_ORIGINS: string[] = [];
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true });
  const problems = validateSync(env).map(
    (error) => `${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`,
  );

  if (env.APP_ENV === AppEnv.Production && !env.DATABASE_URL) {
    problems.push('DATABASE_URL: required in production');
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return env;
}
