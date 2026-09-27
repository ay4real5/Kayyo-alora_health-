import { AppEnv, validateEnv } from './env.validation.js';

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

  it('requires DATABASE_URL in production', () => {
    expect(() => validateEnv({ APP_ENV: 'production' })).toThrow(/required in production/);
    expect(
      validateEnv({ APP_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/x' }).APP_ENV,
    ).toBe(AppEnv.Production);
  });
});
