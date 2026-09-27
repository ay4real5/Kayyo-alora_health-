import { randomBytes } from 'node:crypto';
import { AppEnv, validateEnv as rawValidateEnv } from './env.validation.js';

const newKey = () => randomBytes(32).toString('base64');
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
/** Every test starts from the one always-required variable. */
const validateEnv = (raw: Record<string, unknown>) => rawValidateEnv({ JWT_SECRET, ...raw });

describe('validateEnv', () => {
  it('applies defaults when nothing is set', () => {
    const env = validateEnv({});
    expect(env.APP_ENV).toBe(AppEnv.Development);
    expect(env.APP_PORT).toBe(3001);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('parses port and comma-separated CORS origins', () => {
    const env = validateEnv({
      APP_PORT: '4000',
      CORS_ORIGINS: 'http://localhost:3000, https://portal.example.com',
    });
    expect(env.APP_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://portal.example.com']);
  });

  it('rejects wildcard CORS origins', () => {
    expect(() => validateEnv({ CORS_ORIGINS: 'https://*.base44.app' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects an invalid port and a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ APP_PORT: 'abc' })).toThrow(/APP_PORT/);
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('requires DATABASE_URL and PHI_ENCRYPTION_KEY in production', () => {
    expect(() => validateEnv({ APP_ENV: 'production' })).toThrow(/DATABASE_URL: required/);
    expect(() => validateEnv({ APP_ENV: 'production' })).toThrow(/PHI_ENCRYPTION_KEY: required/);
    const env = validateEnv({
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db:5432/x',
      PHI_ENCRYPTION_KEY: newKey(),
    });
    expect(env.APP_ENV).toBe(AppEnv.Production);
  });

  it('rejects a malformed PHI key without echoing it', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => validateEnv({ PHI_ENCRYPTION_KEY: shortKey })).toThrow(/32 bytes/);
    expect(() => validateEnv({ PHI_ENCRYPTION_KEY: shortKey })).not.toThrow(shortKey);
  });

  it('validates key rotation settings', () => {
    expect(() =>
      validateEnv({
        PHI_ENCRYPTION_KEY: newKey(),
        PHI_ENCRYPTION_KEY_VERSION: '2',
        PHI_ENCRYPTION_PREVIOUS_KEYS: `2:${newKey()}`,
      }),
    ).toThrow(/defined twice/);
    expect(() => validateEnv({ PHI_ENCRYPTION_PREVIOUS_KEYS: `1:${newKey()}` })).toThrow(
      /but PHI_ENCRYPTION_KEY is not/,
    );
    const env = validateEnv({
      PHI_ENCRYPTION_KEY: newKey(),
      PHI_ENCRYPTION_KEY_VERSION: '3',
      PHI_ENCRYPTION_PREVIOUS_KEYS: `1:${newKey()}, 2:${newKey()}`,
    });
    expect(env.PHI_ENCRYPTION_KEY_VERSION).toBe(3);
  });

  it('requires a strong JWT_SECRET', () => {
    expect(() => rawValidateEnv({})).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ JWT_SECRET: 'too-short' })).toThrow(/at least 32 characters/);
  });

  it('applies auth defaults and keeps the idle timeout longer than the access token', () => {
    const env = validateEnv({});
    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
    expect(env.SESSION_IDLE_TIMEOUT_MINUTES).toBe(30);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(() =>
      validateEnv({ ACCESS_TOKEN_TTL_MINUTES: '15', SESSION_IDLE_TIMEOUT_MINUTES: '15' }),
    ).toThrow(/must be greater than ACCESS_TOKEN_TTL_MINUTES/);
  });
});
