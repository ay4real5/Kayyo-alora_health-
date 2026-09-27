import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { base32Decode, timeStep, totpAt } from '../src/modules/auth/two-factor/totp.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

/** What an authenticator app would show right now (offset = steps of clock drift). */
const codeFor = (base32Secret: string, offset = 0) => totpAt(base32Decode(base32Secret), timeStep() + offset);

describe.skipIf(!hasDb)('Two-factor authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `2FA Test ${randomUUID()}` } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });
  const verify = (twoFactorToken: string, code: string) =>
    http().post('/api/v1/auth/2fa/verify').send({ twoFactorToken, code });
  /** Test-only: forget the last used step so another code from the current window is accepted. */
  const allowCodeReuse = (id: string) => prisma.user.update({ where: { id }, data: { twoFaLastUsedStep: null } });

  /** Creates a user, logs in, and turns 2FA on. Returns what later steps need. */
  async function userWith2fa() {
    const email = `mfa-${randomUUID()}@example.test`;
    const { id } = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Mfa',
        lastName: 'User',
      },
    });
    const auth = { Authorization: `Bearer ${(await login(email)).body.data.accessToken}` };
    const { secret } = (await http().post('/api/v1/auth/2fa/setup').set(auth).expect(200)).body.data;
    await http().post('/api/v1/auth/2fa/enable').set(auth).send({ code: codeFor(secret) }).expect(204);
    await allowCodeReuse(id);
    return { id, email, secret: secret as string, auth };
  }

  it('sets up 2FA: secret stored encrypted, not active until a valid code is entered', async () => {
    const email = `setup-${randomUUID()}@example.test`;
    const { id } = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Set',
        lastName: 'Up',
      },
    });
    const auth = { Authorization: `Bearer ${(await login(email)).body.data.accessToken}` };

    const setup = (await http().post('/api/v1/auth/2fa/setup').set(auth).expect(200)).body.data;
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/Alora%20Health%3A/);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.is2faEnabled).toBe(false);
    expect(stored.twoFaSecret).not.toContain(setup.secret);

    await http().post('/api/v1/auth/2fa/enable').set(auth).send({ code: '000000' }).expect(400);
    await http().post('/api/v1/auth/2fa/enable').set(auth).send({ code: codeFor(setup.secret) }).expect(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).is2faEnabled).toBe(true);

    await http().post('/api/v1/auth/2fa/setup').set(auth).expect(409); // can't silently replace an active secret
  });

  it('logs in with password + code, and the challenge token is not an access token', async () => {
    const { email, secret, id } = await userWith2fa();

    const challenge = (await login(email).expect(200)).body.data;
    expect(challenge).toMatchObject({ requires2FA: true, expiresIn: 300 });
    expect(challenge).not.toHaveProperty('accessToken');
    await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${challenge.twoFactorToken}`).expect(401);

    const session = (await verify(challenge.twoFactorToken, codeFor(secret)).expect(200)).body.data;
    const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${session.accessToken}`).expect(200);
    expect(me.body.data).toMatchObject({ id, is2faEnabled: true });
    expect(
      await prisma.auditLog.count({ where: { userId: id, action: 'LOGIN_SUCCESS', details: { equals: { method: 'password+totp' } } } }),
    ).toBe(1);
  });

  it('refuses to accept the same code twice (replay)', async () => {
    const { email, secret } = await userWith2fa();
    const code = codeFor(secret);

    const first = (await login(email)).body.data.twoFactorToken;
    await verify(first, code).expect(200);
    const second = (await login(email)).body.data.twoFactorToken;
    await verify(second, code).expect(401);
  });

  it('locks the account after repeated wrong codes', async () => {
    const { email, secret, id } = await userWith2fa();
    const token = (await login(email)).body.data.twoFactorToken;
    for (let i = 0; i < 5; i++) await verify(token, '000000').expect(401);

    await verify(token, codeFor(secret)).expect(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects garbage challenge tokens and malformed codes', async () => {
    await verify('not-a-token', '123456').expect(401);
    const res = await verify('x', '12ab').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('disabling needs both the password and a valid code', async () => {
    const { secret, id, auth } = await userWith2fa();
    const disable = (body: object) => http().post('/api/v1/auth/2fa/disable').set(auth).send(body);

    await disable({ password: 'Wrong-Password-1!', code: codeFor(secret) }).expect(403);
    await allowCodeReuse(id);
    await disable({ password: PASSWORD, code: '000000' }).expect(403);
    await disable({ password: PASSWORD, code: codeFor(secret) }).expect(204);

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user).toMatchObject({ is2faEnabled: false, twoFaSecret: null });
  });
});
