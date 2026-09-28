import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const NEW_PASSWORD = 'Gallop-Meadow-8!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

/** A session on a temporary/expired password may only read /auth/me and change the password (P4-09, D-058). */
describe.skipIf(!hasDb)('Forced password change (e2e)', () => {
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
    agencyId = (await prisma.agency.create({ data: { name: `Pwd Change Test ${randomUUID()}` } })).id;
  });

  afterAll(async () => {
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  const createUser = async (roleName: string, passwordChangedAt: Date | null) => {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `pwc-${randomUUID()}@example.test`;
    const { id } = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt,
        firstName: 'Pax',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { id, email };
  };

  const login = async (email: string) =>
    (await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)).body.data as {
      accessToken: string;
      refreshToken: string;
      mustChangePassword: boolean;
      mustEnable2fa: boolean;
    };

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const expectRestricted = async (token: string) => {
    const blocked = await http().get('/api/v1/patients').set(bearer(token)).expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  };

  it('a never-set password restricts the session until it is changed', async () => {
    const { email } = await createUser('registered_nurse', null);

    const session = await login(email);
    expect(session.mustChangePassword).toBe(true);

    await expectRestricted(session.accessToken);

    // /auth/me still works and reports the state for client reloads.
    const me = (await http().get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(200)).body.data;
    expect(me.mustChangePassword).toBe(true);

    // Refreshing keeps the restriction.
    const refreshed = (
      await http().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(200)
    ).body.data;
    expect(refreshed.mustChangePassword).toBe(true);
    await expectRestricted(refreshed.accessToken);

    // Changing the password lifts it: the fresh session goes anywhere the role can.
    const changed = (
      await http()
        .post('/api/v1/auth/change-password')
        .set(bearer(refreshed.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200)
    ).body.data;
    expect(changed.mustChangePassword).toBe(false);
    await http().get('/api/v1/patients').set(bearer(changed.accessToken)).expect(200);
    const meAfter = (await http().get('/api/v1/auth/me').set(bearer(changed.accessToken)).expect(200)).body.data;
    expect(meAfter.mustChangePassword).toBe(false);
  });

  it('a password older than the max age is restricted the same way', async () => {
    const { email } = await createUser('registered_nurse', new Date(Date.now() - 100 * 24 * 60 * 60_000));
    const session = await login(email);
    expect(session.mustChangePassword).toBe(true);
    await expectRestricted(session.accessToken);
  });

  it('an admin who needs both changes the password first, then gets the 2FA-setup restriction', async () => {
    const { email } = await createUser('agency_admin', null);
    const session = await login(email);
    expect(session.mustChangePassword).toBe(true);
    expect(session.mustEnable2fa).toBe(true);

    // 2FA setup itself is off limits until the password is changed.
    const blocked = await http().post('/api/v1/auth/2fa/setup').set(bearer(session.accessToken)).send({}).expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = (
      await http()
        .post('/api/v1/auth/change-password')
        .set(bearer(session.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200)
    ).body.data;
    expect(changed.mustChangePassword).toBe(false);
    expect(changed.mustEnable2fa).toBe(true);

    const restricted = await http().get('/api/v1/patients').set(bearer(changed.accessToken)).expect(403);
    expect(restricted.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    await http().post('/api/v1/auth/2fa/setup').set(bearer(changed.accessToken)).send({}).expect(200);
  });
});
