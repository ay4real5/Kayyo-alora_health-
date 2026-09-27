import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { INVALID_LOGIN } from '../src/modules/auth/auth.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/modules/auth/token.service.js';
import { setupApp } from '../src/setup-app.js';

// Runs against the real database (Neon locally via .env, Postgres in CI). Skipped without DATABASE_URL.
const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';

/** Rate-limit store that never blocks, so these tests can log in many times from one IP. */
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

async function createApp(throttle: boolean): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!throttle) builder = builder.overrideProvider(ThrottlerStorage).useValue(noThrottle);
  const app = setupApp((await builder.compile()).createNestApplication({ logger: false }));
  await app.init();
  return app;
}

describe.skipIf(!hasDb)('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let agencyId: string;
  const http = () => request(app.getHttpServer());

  /** Creates a user with a fresh random email; returns its email and id. */
  async function createUser(overrides: Record<string, unknown> = {}) {
    const email = `user-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await passwords.hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Test',
        lastName: 'User',
        ...overrides,
      },
    });
    return { email, id: user.id };
  }

  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });

  beforeAll(async () => {
    app = await createApp(false);
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    agencyId = (await prisma.agency.create({ data: { name: `Auth Test ${randomUUID()}` } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } }); // refresh tokens cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  describe('login', () => {
    it('returns a token pair and records the login', async () => {
      const { email, id } = await createUser();
      const res = await login(email).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        accessTokenExpiresIn: 900,
        mustChangePassword: false,
      });
      expect(typeof res.body.data.accessToken).toBe('string');
      expect(typeof res.body.data.refreshToken).toBe('string');
      expect(await prisma.auditLog.count({ where: { userId: id, action: 'LOGIN_SUCCESS' } })).toBe(1);

      // Only a hash of the refresh token is stored.
      const stored = await prisma.refreshToken.findFirstOrThrow({ where: { userId: id } });
      expect(stored.tokenHash).not.toBe(res.body.data.refreshToken);
    });

    it('treats the email case-insensitively', async () => {
      const { email } = await createUser();
      await login(`  ${email.toUpperCase()} `).expect(200);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const { email } = await createUser();
      const wrong = await login(email, 'Wrong-Password-1!').expect(401);
      const unknown = await login(`nobody-${randomUUID()}@example.test`).expect(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body.error.message).toBe(INVALID_LOGIN);
    });

    it('locks the account after 5 failures, even for the right password', async () => {
      const { email, id } = await createUser();
      for (let i = 0; i < 5; i++) await login(email, 'Wrong-Password-1!').expect(401);

      await login(email).expect(401);
      const user = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.auditLog.count({ where: { userId: id, action: 'ACCOUNT_LOCKED' } })).toBe(1);

      // After the lock expires, the right password works and the counter resets.
      await prisma.user.update({ where: { id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      await login(email).expect(200);
    });

    it('refuses inactive users with the generic message', async () => {
      const { email } = await createUser({ isActive: false });
      const res = await login(email).expect(401);
      expect(res.body.error.message).toBe(INVALID_LOGIN);
    });

    it('flags an old or never-set password', async () => {
      const { email } = await createUser({ passwordChangedAt: null });
      expect((await login(email).expect(200)).body.data.mustChangePassword).toBe(true);
    });

    it('validates the request body', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: 'not-an-email' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('access tokens', () => {
    it('protects routes by default and serves /auth/me with a valid token', async () => {
      await http().get('/api/v1/auth/me').expect(401);

      const { email, id } = await createUser();
      const { accessToken } = (await login(email)).body.data;
      const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(me.body.data).toMatchObject({ id, agencyId, email, roles: [], permissions: [] });
      expect(me.body.data).not.toHaveProperty('passwordHash');
    });

    it('rejects tokens signed with another secret, tampered, or expired', async () => {
      const claims = { sub: randomUUID(), agencyId };
      const opts = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' as const };
      const foreign = new JwtService({ secret: 'some-other-secret-that-is-long-enough!!' }).sign(claims, {
        ...opts,
        expiresIn: 60,
      });
      const expired = app.get(JwtService).sign(claims, { ...opts, expiresIn: -10 });

      const { email } = await createUser();
      const valid: string = (await login(email)).body.data.accessToken;
      const tampered = `${valid.slice(0, -2)}xx`;

      for (const token of [foreign, expired, tampered, 'garbage']) {
        await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      }
    });

    it('leaves public routes open', async () => {
      await http().get('/api/v1/health').expect(200);
    });
  });

  describe('refresh tokens', () => {
    it('rotates: the new pair works, the old refresh token is spent', async () => {
      const { email } = await createUser();
      const first = (await login(email)).body.data;

      const second = (await http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200))
        .body.data;
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.refreshTokenExpiresAt).toBe(first.refreshTokenExpiresAt); // absolute expiry is kept
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${second.accessToken}`).expect(200);
    });

    it('detects reuse of a spent token and signs the user out everywhere', async () => {
      const { email, id } = await createUser();
      const first = (await login(email)).body.data;
      const otherDevice = (await login(email)).body.data;
      const second = (await http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken })).body.data;

      await http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);

      // Every session of that user is now dead.
      await http().post('/api/v1/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
      await http().post('/api/v1/auth/refresh').send({ refreshToken: otherDevice.refreshToken }).expect(401);
      expect(
        await prisma.auditLog.count({ where: { userId: id, action: 'REFRESH_TOKEN_REUSE_DETECTED' } }),
      ).toBe(1);
    });

    it('expires a session left idle past the timeout', async () => {
      const { email, id } = await createUser();
      const { refreshToken } = (await login(email)).body.data;
      await prisma.refreshToken.updateMany({
        where: { userId: id },
        data: { createdAt: new Date(Date.now() - 31 * 60_000) },
      });
      await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('rejects unknown tokens', async () => {
      await http().post('/api/v1/auth/refresh').send({ refreshToken: 'nope' }).expect(401);
    });
  });

  describe('browser cookie mode (X-Auth-Transport: cookie)', () => {
    const COOKIE_MODE = { 'X-Auth-Transport': 'cookie' };
    const refreshCookie = (res: request.Response) =>
      ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('alora_rt='));

    it('keeps the refresh token in an httpOnly cookie, never in the body', async () => {
      const { email } = await createUser();
      const res = await http().post('/api/v1/auth/login').set(COOKIE_MODE).send({ email, password: PASSWORD }).expect(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data).not.toHaveProperty('refreshToken');

      const cookie = refreshCookie(res)!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('refreshes from the cookie alone, rotating it; logout clears it', async () => {
      const { email } = await createUser();
      const login = await http().post('/api/v1/auth/login').set(COOKIE_MODE).send({ email, password: PASSWORD });
      const first = refreshCookie(login)!.split(';')[0]!;

      const refreshed = await http().post('/api/v1/auth/refresh').set(COOKIE_MODE).set('Cookie', first).send({}).expect(200);
      expect(refreshed.body.data.accessToken).toBeDefined();
      const second = refreshCookie(refreshed)!.split(';')[0]!;
      expect(second).not.toBe(first);

      // The old cookie is spent (reuse → everything revoked, as with body tokens).
      await http().post('/api/v1/auth/refresh').set(COOKIE_MODE).set('Cookie', first).send({}).expect(401);
    });

    it('ignores the cookie unless the custom header is sent (CSRF protection)', async () => {
      const { email } = await createUser();
      const login = await http().post('/api/v1/auth/login').set(COOKIE_MODE).send({ email, password: PASSWORD });
      const cookie = refreshCookie(login)!.split(';')[0]!;

      await http().post('/api/v1/auth/refresh').set('Cookie', cookie).send({}).expect(401);
      const out = await http().post('/api/v1/auth/logout').set(COOKIE_MODE).set('Cookie', cookie).send({}).expect(204);
      expect(refreshCookie(out)).toMatch(/alora_rt=;/); // cleared
      await http().post('/api/v1/auth/refresh').set(COOKIE_MODE).set('Cookie', cookie).send({}).expect(401);
    });
  });

  describe('logout', () => {
    it('ends only that session and is idempotent', async () => {
      const { email } = await createUser();
      const { refreshToken } = (await login(email)).body.data;
      const otherDevice = (await login(email)).body.data;

      await http().post('/api/v1/auth/logout').send({ refreshToken }).expect(204);
      await http().post('/api/v1/auth/logout').send({ refreshToken }).expect(204);
      await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);

      // Retrying a logged-out token is not theft: the user's other sessions keep working.
      await http().post('/api/v1/auth/refresh').send({ refreshToken: otherDevice.refreshToken }).expect(200);
    });
  });

  describe('change password', () => {
    it('enforces the policy, checks the current password, and signs out other sessions', async () => {
      const { email } = await createUser();
      const session = (await login(email)).body.data;
      const otherDevice = (await login(email)).body.data;
      const auth = { Authorization: `Bearer ${session.accessToken}` };
      const change = (body: object) => http().post('/api/v1/auth/change-password').set(auth).send(body);

      const weak = await change({ currentPassword: PASSWORD, newPassword: 'weak' }).expect(400);
      expect(weak.body.error.details[0]).toMatch(/at least 12 characters/);
      await change({ currentPassword: 'Wrong-Password-1!', newPassword: 'Brand-New-Pass-2!' }).expect(403);
      await change({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);

      const fresh = (await change({ currentPassword: PASSWORD, newPassword: 'Brand-New-Pass-2!' }).expect(200)).body
        .data;
      expect(typeof fresh.refreshToken).toBe('string');

      await http().post('/api/v1/auth/refresh').send({ refreshToken: otherDevice.refreshToken }).expect(401);
      await login(email).expect(401);
      await login(email, 'Brand-New-Pass-2!').expect(200);
    });
  });
});

describe.skipIf(!hasDb)('Auth rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows 30 login attempts per minute per IP, then answers 429', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `nobody-${randomUUID()}@example.test`, password: 'x' });
    for (let i = 0; i < 30; i++) await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('does not rate-limit session renewal beyond the global limit (every page load uses it)', async () => {
    for (let i = 0; i < 40; i++) {
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: 'unknown' }).expect(401);
    }
  });
});
