import { plainToInstance, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { buildPhiKeyring } from '../common/crypto/phi-keyring.js';

export enum AppEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

const blankToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);
const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

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

  /**
   * Serve interactive API docs at /api/v1/docs. Default: on everywhere except production, so the live
   * system doesn't publish a map of itself. The committed spec (docs/api/openapi.json) is always available.
   */
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : value === 'true' || value === true))
  @IsOptional()
  @IsBoolean()
  API_DOCS_ENABLED?: boolean;

  /** Signs access tokens (HS256). At least 32 characters; generate with `openssl rand -base64 48`. */
  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(60)
  ACCESS_TOKEN_TTL_MINUTES: number = 15;

  /** Absolute session lifetime: after this, the user must log in again even if active. */
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(30)
  REFRESH_TOKEN_TTL_DAYS: number = 7;

  /** A session unused for this long can no longer be refreshed (HIPAA auto-logoff, DECISIONS D-020). */
  @Transform(toNumber)
  @IsInt()
  @Min(5)
  @Max(240)
  SESSION_IDLE_TIMEOUT_MINUTES: number = 30;

  @Transform(toNumber)
  @IsInt()
  @Min(3)
  @Max(20)
  LOGIN_MAX_ATTEMPTS: number = 5;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(1440)
  LOGIN_LOCKOUT_MINUTES: number = 30;

  /**
   * 0 disables. When exceeded (or never set), sign-in works but the session is limited to /auth/me and
   * change-password until the password changes (P4-09).
   */
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(3650)
  PASSWORD_MAX_AGE_DAYS: number = 90;

  /** 32 random bytes, base64. Format and rotation: src/common/crypto/phi-crypto.ts (DECISIONS D-006). */
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  PHI_ENCRYPTION_KEY?: string;

  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(255)
  PHI_ENCRYPTION_KEY_VERSION: number = 1;

  /**
   * Background jobs (late/no-show monitor, nightly recurring-visit extension; DECISIONS D-041). On by default; the API
   * e2e tests turn them off so a job can't change test data mid-test. With several API instances, all may run them —
   * every job is idempotent.
   */
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : value === 'true' || value === true))
  @IsOptional()
  @IsBoolean()
  JOBS_ENABLED: boolean = true;

  /** Whole months of audit_logs kept before the retention job drops them (HIPAA: 6 years minimum). */
  @Transform(toNumber)
  @IsInt()
  @Min(72)
  AUDIT_RETENTION_MONTHS: number = 72;

  /**
   * Database connections per API instance (pg pool). 10 suits a remote dev database; raise it in production when the
   * database is close by and allows more connections (P4-09 load test, D-068).
   */
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(200)
  DATABASE_POOL_SIZE: number = 10;

  /**
   * Reverse proxies in front of the API (nginx, a load balancer). With 1, the client address comes from the
   * X-Forwarded-For entry the proxy adds — otherwise every request looks like it came from the proxy, and one
   * shared rate-limit bucket locks everybody out (P4-10, D-070). 0 = the API is reached directly.
   */
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 0;

  /** Turns off request rate limits — for the CI browser tests only; refused in production. */
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : value === 'true' || value === true))
  @IsOptional()
  @IsBoolean()
  RATE_LIMITS_DISABLED: boolean = false;

  /** Retired keys still needed to read old values: "1:<base64>,2:<base64>". */
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  PHI_ENCRYPTION_PREVIOUS_KEYS?: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true });
  const problems = validateSync(env).map(
    (error) => `${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`,
  );

  if (env.APP_ENV === AppEnv.Production && !env.DATABASE_URL) {
    problems.push('DATABASE_URL: required in production');
  }
  if (env.SESSION_IDLE_TIMEOUT_MINUTES <= env.ACCESS_TOKEN_TTL_MINUTES) {
    // Clients refresh when the access token expires; a shorter idle window would log active users out.
    problems.push('SESSION_IDLE_TIMEOUT_MINUTES: must be greater than ACCESS_TOKEN_TTL_MINUTES');
  }
  if (env.APP_ENV === AppEnv.Production && env.RATE_LIMITS_DISABLED) {
    problems.push('RATE_LIMITS_DISABLED: not allowed in production');
  }
  if (env.APP_ENV === AppEnv.Production && !env.PHI_ENCRYPTION_KEY) {
    problems.push('PHI_ENCRYPTION_KEY: required in production');
  }
  try {
    buildPhiKeyring(env);
  } catch (error) {
    // buildPhiKeyring's messages never include key material.
    problems.push(`PHI keys: ${(error as Error).message}`);
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return env;
}
