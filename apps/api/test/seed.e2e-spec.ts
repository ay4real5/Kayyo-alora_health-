import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PhiContext, PhiCryptoService } from '../src/common/crypto/phi-crypto.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RbacSyncService } from '../src/modules/rbac/rbac-sync.service.js';
import { DEFAULT_DEMO_PASSWORD, DEMO_AGENCY_ID, runDemoSeed } from '../src/seed/demo-seed.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

describe.skipIf(!hasDb)('Demo seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    ({
      Authorization: `Bearer ${(await http().post('/api/v1/auth/login').send({ email, password: DEFAULT_DEMO_PASSWORD }).expect(200)).body.data.accessToken}`,
    });

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
      encryptSsn: (ssn, kind) => crypto.encrypt(ssn, kind === 'patient' ? PhiContext.PatientSsn : PhiContext.StaffSsn),
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

    await login('billing.staff@demo.alora.test');
  });
});
