import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
};

describe.skipIf(!hasDb)('Pre-billing QA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: { Authorization: string };
  let office: { Authorization: string };
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), -3);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    const npi = String(Math.floor(1e9 + Math.random() * 9e9));
    agencyId = (
      await prisma.agency.create({
        data: { name: `QA Test ${randomUUID()}`, timezone: 'UTC', npi },
      })
    ).id;
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');
  });

  afterAll(async () => {
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.payer.deleteMany({ where: { agencyId } });
    await prisma.serviceCode.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `qa-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Quinn',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  it('prices a complete visit and explains exactly what blocks the others', async () => {
    const payer = await prisma.payer.create({
      data: { agencyId, name: 'QA Medicaid', payerType: 'medicaid', requiresAuthorization: true },
    });
    const code = await prisma.serviceCode.create({
      data: { agencyId, code: 'T1019', codeType: 'hcpcs', unitType: 'unit_15min', defaultRate: 5 },
    });
    await prisma.payerRate.create({
      data: {
        payerId: payer.id,
        serviceCodeId: code.id,
        rate: 6.25,
        effectiveDate: toDate(addDays(day, -30))!,
      },
    });
    const patient = await prisma.patient.create({
      data: {
        agencyId,
        firstName: 'Quincy',
        lastName: 'Billable',
        dateOfBirth: new Date('1940-01-01T00:00:00Z'),
        status: 'active',
        payerPrimaryId: payer.id,
        medicaidId: 'VA000111',
        diagnoses: { create: { icd10Code: 'I10', description: 'Hypertension', isPrimary: true } },
      },
    });
    const auth = await prisma.authorization.create({
      data: {
        patientId: patient.id,
        payerId: payer.id,
        serviceCode: 'T1019',
        startDate: toDate(addDays(day, -10))!,
        endDate: toDate(addDays(day, 10))!,
        authorizedVisits: 1,
      },
    });
    const role = await prisma.role.findFirstOrThrow({
      where: { agencyId: null, name: 'home_health_aide' },
    });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `qa-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Ada',
        lastName: 'Aide',
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    const staffId = aide.staffProfile!.id;

    const visit = async (
      start: string,
      end: string,
      opts: { evv?: string; note?: boolean; authorizationId?: string | null } = {},
    ) => {
      const v = await prisma.visit.create({
        data: {
          agencyId,
          patientId: patient.id,
          staffId,
          visitType: 'home_health_aide',
          serviceCode: 'T1019',
          status: 'completed',
          scheduledDate: toDate(day)!,
          scheduledStart: toTime(start),
          scheduledEnd: toTime(end),
          actualStart: new Date(`${day}T${start}:00Z`),
          actualEnd: new Date(`${day}T${end}:00Z`),
          authorizationId: opts.authorizationId === undefined ? auth.id : opts.authorizationId,
        },
      });
      if (opts.evv) {
        await prisma.evvRecord.create({
          data: {
            visitId: v.id,
            agencyId,
            staffId,
            patientId: patient.id,
            serviceType: 'home_health_aide',
            serviceDate: toDate(day)!,
            clockInMethod: 'gps',
            status: opts.evv,
          },
        });
      }
      if (opts.note) {
        await prisma.visitNote.create({
          data: {
            visitId: v.id,
            staffId,
            authorId: aide.id,
            noteType: 'aide_activity',
            narrative: 'Done',
            status: 'submitted',
          },
        });
      }
      return v.id;
    };

    const good = await visit('09:00', '10:00', { evv: 'verified', note: true });
    const noEvvNoNote = await visit('11:00', '12:00', { authorizationId: null });
    const overLimit = await visit('13:00', '13:45', { evv: 'verified', note: true }); // 2nd visit on a 1-visit authorization

    await http().get('/api/v1/billing/ready-to-bill').set(office).expect(403);
    const res = await http()
      .get(`/api/v1/billing/ready-to-bill?from=${day}&to=${day}`)
      .set(billing)
      .expect(200);
    const byId = new Map(res.body.data.visits.map((v: { visitId: string }) => [v.visitId, v]));

    expect(byId.get(good)).toMatchObject({
      ready: true,
      units: 4,
      rate: 6.25,
      amount: 25,
      minutes: 60,
      payer: { name: 'QA Medicaid' },
    });
    const blocked = byId.get(noEvvNoNote) as {
      ready: boolean;
      checks: { code: string; ok: boolean }[];
    };
    expect(blocked.ready).toBe(false);
    expect(
      blocked.checks
        .filter((c) => !c.ok)
        .map((c) => c.code)
        .sort(),
    ).toEqual(['authorization', 'evv_verified', 'note_finalised']);
    const over = byId.get(overLimit) as {
      ready: boolean;
      checks: { code: string; ok: boolean; message: string }[];
    };
    expect(over.ready).toBe(false);
    expect(over.checks.find((c) => c.code === 'authorization')?.message).toMatch(/beyond/);

    expect(res.body.data.summary).toMatchObject({
      visits: 3,
      ready: 1,
      blocked: 2,
      readyAmount: 25,
    });
    expect(res.body.data.summary.blockers).toMatchObject({
      authorization: 2,
      evv_verified: 1,
      note_finalised: 1,
    });

    const onlyReady = await http()
      .get(`/api/v1/billing/ready-to-bill?from=${day}&to=${day}&readyOnly=true`)
      .set(billing)
      .expect(200);
    expect(onlyReady.body.data.visits.map((v: { visitId: string }) => v.visitId)).toEqual([good]);
    await http()
      .get(`/api/v1/billing/ready-to-bill?from=${day}&to=${addDays(day, -1)}`)
      .set(billing)
      .expect(400);
  });
});
