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
const noThrottle = { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
type Person = { id: string; auth: { Authorization: string }; staffId?: string };

describe.skipIf(!hasDb)('Command Center (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let supervisor: Person;
  let billing: Person;
  let aide: Person;
  let patientId: string;
  const today = utcTodayString();
  const http = () => request(app.getHttpServer());
  const center = (who: Person) => http().get('/api/v1/insights/command-center').set(who.auth).expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Command Center ${randomUUID()}`, timezone: 'UTC', npi: '1234567893' } })).id;
    supervisor = await seedUser('supervisor');
    billing = await seedUser('billing_staff');
    aide = await seedUser('home_health_aide', 'HHA');

    const payer = await prisma.payer.create({ data: { agencyId, name: 'CC Medicaid', payerType: 'medicaid', requiresAuthorization: true } });
    const code = await prisma.serviceCode.create({ data: { agencyId, code: 'T1019', codeType: 'hcpcs', unitType: 'unit_15min', defaultRate: 5 } });
    await prisma.payerRate.create({ data: { payerId: payer.id, serviceCodeId: code.id, rate: 6.25, effectiveDate: toDate(addDays(today, -90))! } });
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Cora',
          lastName: 'Command',
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          payerPrimaryId: payer.id,
          medicaidId: 'VA000222',
          diagnoses: { create: { icd10Code: 'I10', description: 'Hypertension', isPrimary: true } },
        },
      })
    ).id;

    // 10 hours authorized over 31 days; 8 used in the first 21 → on pace for ~11.8 h.
    const auth = await prisma.authorization.create({
      data: { patientId, payerId: payer.id, serviceCode: 'T1019', startDate: toDate(addDays(today, -20))!, endDate: toDate(addDays(today, 10))!, authorizedHours: 10 },
    });
    // Four completed 2-hour visits: no EVV and no note, so none can be billed yet (8 units × $6.25 = $50 each).
    for (const n of [2, 4, 6, 8]) {
      await prisma.visit.create({
        data: {
          agencyId,
          patientId,
          staffId: aide.staffId!,
          authorizationId: auth.id,
          visitType: 'home_health_aide',
          serviceCode: 'T1019',
          status: 'completed',
          scheduledDate: toDate(addDays(today, -n))!,
          scheduledStart: toTime('09:00'),
          scheduledEnd: toTime('11:00'),
        },
      });
    }
    // One visit today with nobody assigned.
    await prisma.visit.create({
      data: { agencyId, patientId, visitType: 'home_health_aide', scheduledDate: toDate(today)!, scheduledStart: toTime('14:00'), scheduledEnd: toTime('15:00') },
    });
    // A credential expiring in 3 days.
    await prisma.staffCredential.create({
      data: { staffProfileId: aide.staffId!, credentialType: 'cpr', credentialName: 'CPR', expiryDate: toDate(addDays(today, 3))! },
    });
  });

  afterAll(async () => {
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } }); // authorizations cascade
    await prisma.payer.deleteMany({ where: { agencyId } });
    await prisma.serviceCode.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } }); // staff profiles and credentials cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, discipline?: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `cc-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Cam',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(discipline ? { staffProfile: { create: { agencyId, discipline } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  it('supervisors see coverage, credentials and authorizations on track to run over — not money', async () => {
    const c = (await center(supervisor)).body.data;
    expect(c.today).toBe(today);
    expect(c.coverage).toMatchObject({ unassignedToday: 1 });
    expect(c.coverage.unassigned[0]).toMatchObject({ patient: 'Cora Command', start: '14:00', link: expect.stringMatching(/^\/schedule\/visits\//) });
    expect(c.credentials).toMatchObject({ expiringIn7Days: 1, expired: 0 });
    expect(c.documentation).toMatchObject({ missingNotes: 3 }); // the last 7 days: visits 2, 4 and 6 days ago
    const risk = c.authorizations.atRisk.find((a: { patient: { id: string } }) => a.patient.id === patientId);
    expect(risk).toMatchObject({ unit: 'hours', authorized: 10, used: 8, forecast: { level: 'over' } });
    expect(risk.forecast.overBy).toBeGreaterThan(1);
    expect(c.money).toBeUndefined(); // no billing access
    const keys = c.attention.map((a: { key: string }) => a.key);
    expect(keys).toEqual(expect.arrayContaining(['unassigned_today', 'credentials_expiring', 'authorizations_over', 'notes_missing']));
    expect(keys).not.toContain('revenue_at_risk');
    expect(c.attention[0].severity).toBe('critical'); // worst first
  });

  it('billing sees the money that can’t be billed yet, in dollars, by reason', async () => {
    const c = (await center(billing)).body.data;
    expect(c.money.atRisk).toMatchObject({ visits: 4, total: 200, days: 60 });
    expect(c.money.atRisk.byReason[0]).toMatchObject({ amount: 200, visits: 4 });
    expect(c.money.visitsToday).toBe(1);
    const item = c.attention.find((a: { key: string }) => a.key === 'revenue_at_risk');
    expect(item).toMatchObject({ amount: 200, link: '/billing/ready', title: "$200 can't be billed yet" });
  });

  it('caregivers get nothing, and every view is audited', async () => {
    const c = (await center(aide)).body.data;
    expect(c).toEqual({ today, attention: [] });
    const views = await prisma.auditLog.count({ where: { agencyId, action: 'VIEW_COMMAND_CENTER' } });
    expect(views).toBeGreaterThanOrEqual(3);
  });
});
