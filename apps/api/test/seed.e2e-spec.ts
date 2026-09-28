import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PhiContext, PhiCryptoService } from '../src/common/crypto/phi-crypto.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RbacSyncService } from '../src/modules/rbac/rbac-sync.service.js';
import { base32Decode, timeStep, totpAt } from '../src/modules/auth/two-factor/totp.js';
import { messageContentContext } from '../src/modules/messaging/message-content.js';
import { DEFAULT_DEMO_PASSWORD, DEMO_AGENCY_ID, DEMO_TOTP_SECRET, runDemoSeed } from '../src/seed/demo-seed.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

describe.skipIf(!hasDb)('Demo seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  /** Demo admins have 2FA on with the demo key (D-045): answer the code prompt like an authenticator app would. */
  const login = async (email: string) => {
    let data = (await http().post('/api/v1/auth/login').send({ email, password: DEFAULT_DEMO_PASSWORD }).expect(200)).body.data;
    if (data.requires2FA) {
      const code = totpAt(base32Decode(DEMO_TOTP_SECRET), timeStep());
      data = (await http().post('/api/v1/auth/2fa/verify').send({ twoFactorToken: data.twoFactorToken, code }).expect(200)).body.data;
    }
    expect(data.mustEnable2fa).toBe(false);
    return { Authorization: `Bearer ${data.accessToken}` };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    const crypto = app.get(PhiCryptoService);
    // Re-running over an existing demo agency also proves the seed is idempotent.
    await runDemoSeed(prisma, {
      syncRoles: () => app.get(RbacSyncService).sync(),
      encryptTwoFaSecret: (base32) =>
        Buffer.from(crypto.encrypt(base32, PhiContext.UserTwoFaSecret)).toString('base64'),
      encryptSsn: (ssn, kind) => crypto.encrypt(ssn, kind === 'patient' ? PhiContext.PatientSsn : PhiContext.StaffSsn),
      encryptMessage: (text, id) => crypto.encryptBytes(Buffer.from(text, 'utf8'), messageContentContext(id)),
    });
  }, 300_000);

  afterAll(async () => {
    await app.close(); // the demo agency is left in place on purpose — it's for development
  });

  it('refuses to run in production', async () => {
    await expect(runDemoSeed(prisma, { appEnv: 'production', syncRoles: async () => {} })).rejects.toThrow(/production/);
  });

  it('creates exactly one demo agency with the expected data', async () => {
    expect(await prisma.agency.count({ where: { id: DEMO_AGENCY_ID } })).toBe(1);
    expect(await prisma.patient.count({ where: { agencyId: DEMO_AGENCY_ID } })).toBe(30);
    expect(await prisma.staffProfile.count({ where: { agencyId: DEMO_AGENCY_ID } })).toBe(15);
    expect(await prisma.recurrenceRule.count({ where: { agencyId: DEMO_AGENCY_ID } })).toBe(4);
    expect(await prisma.visit.count({ where: { agencyId: DEMO_AGENCY_ID } })).toBeGreaterThan(40);
  });

  it('never double-books a caregiver', async () => {
    const overlaps = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM visits a JOIN visits b
        ON a.staff_id = b.staff_id AND a.scheduled_date = b.scheduled_date AND a.id < b.id
       AND a.scheduled_start < b.scheduled_end AND b.scheduled_start < a.scheduled_end
     WHERE a.agency_id = ${DEMO_AGENCY_ID}::uuid`;
    expect(Number(overlaps[0]!.n)).toBe(0);
  });

  it('lets each demo login in, with the right view of the data', async () => {
    const admin = await login('agency.admin@demo.alora.test');
    const patients = await http().get('/api/v1/patients?limit=100').set(admin).expect(200);
    expect(patients.body.meta.total).toBe(30);

    const expiring = await http().get('/api/v1/staff/expiring-credentials').set(admin).expect(200);
    expect(expiring.body.data.some((c: { state: string }) => c.state === 'expired')).toBe(true);

    // A field nurse sees only patients they have visits with.
    const rn = await login('rn@demo.alora.test');
    const rnPatients = await http().get('/api/v1/patients?limit=100').set(rn).expect(200);
    expect(rnPatients.body.meta.total).toBeLessThan(30);

    // Demo messages decrypt through the API; the office has unread replies.
    const conversations = (await http().get('/api/v1/messages/conversations').set(rn).expect(200)).body.data;
    expect(conversations).toHaveLength(2);
    const office = await login('office.staff@demo.alora.test');
    const unread = await http().get('/api/v1/messages/unread-count').set(office).expect(200);
    expect(unread.body.data.unread).toBe(4); // the RN's reply + the 3 care-team messages
    expect(conversations.map((c: { lastMessage: { content: string } }) => c.lastMessage.content)).toContain(
      'Thanks, I will check vitals at my visit on Thursday.',
    );

    await login('billing.staff@demo.alora.test');
    // Admins have 2FA on; nobody else is forced.
    expect(await prisma.user.count({ where: { agencyId: DEMO_AGENCY_ID, is2faEnabled: true } })).toBe(2);
  });
});
