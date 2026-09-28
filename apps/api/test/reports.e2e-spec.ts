import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { ReportsService } from '../src/modules/reports/reports.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let supervisor: Auth;
  let billing: Auth;
  let office: Auth;
  const http = () => request(app.getHttpServer());
  const today = utcTodayString();
  const d1 = addDays(today, -5);
  const d2 = addDays(today, -4);
  const q = `from=${addDays(today, -6)}&to=${today}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Reports Test ${randomUUID()}`, timezone: 'UTC' } })).id;
    supervisor = await seedUser('supervisor');
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');
    const payer = await prisma.payer.create({ data: { agencyId, name: 'Report Medicaid', payerType: 'medicaid' } });
    const patient = (first: string, status = 'active', extra = {}) =>
      prisma.patient.create({
        data: { agencyId, firstName: first, lastName: 'Report', dateOfBirth: new Date('1940-01-01T00:00:00Z'), status, payerPrimaryId: payer.id, ...extra },
      });
    const p1 = await patient('Ann', 'active', { admissionDate: toDate(d1)! });
    await patient('Bob');
    await patient('Cy', 'discharged', { dischargeDate: toDate(d2)! });

    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const aide = await prisma.user.create({
      data: {
        agencyId, email: `rep-aide-${randomUUID()}@example.test`, passwordHash: 'x', firstName: 'Ada', lastName: 'Aide',
        userRoles: { create: { roleId: role.id } }, staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    const staffId = aide.staffProfile!.id;
    const visit = async (date: string, status: string, evv: string | null, extra = {}) => {
      const v = await prisma.visit.create({
        data: { agencyId, patientId: p1.id, staffId, visitType: 'home_health_aide', status, scheduledDate: toDate(date)!, scheduledStart: toTime('09:00'), scheduledEnd: toTime('11:00'), ...extra },
      });
      if (evv) {
        await prisma.evvRecord.create({
          data: {
            visitId: v.id, agencyId, staffId, patientId: p1.id, serviceType: 'home_health_aide', serviceDate: toDate(date)!, clockInMethod: 'gps',
            clockInTime: new Date(`${date}T09:00:00Z`), clockOutTime: new Date(`${date}T11:00:00Z`), status: evv,
          },
        });
      }
    };
    await visit(d1, 'completed', 'verified');
    await visit(d1, 'completed', 'exception');
    await visit(d2, 'completed', null);
    await visit(d2, 'missed', null, { missedReason: 'Client in hospital' });
    await visit(d2, 'cancelled', null, { cancelReason: 'Family request' });
    await visit(addDays(today, 3), 'scheduled', null); // outside the range

    // Money: a $100 claim billed and denied, a $40 remittance posted.
    await prisma.claim.create({
      data: {
        agencyId, patientId: p1.id, payerId: payer.id, claimNumber: `R${Date.now()}`.slice(0, 12), claimType: '837P', status: 'denied',
        billingPeriodStart: toDate(d1)!, billingPeriodEnd: toDate(d1)!, totalCharges: 100, submittedAt: new Date(`${d1}T12:00:00Z`),
        deniedAt: new Date(), denialReasonCode: '197', createdById: aide.id,
      },
    });
    await prisma.payment.create({ data: { agencyId, payerId: payer.id, paymentAmount: 40, status: 'posted', postedAt: new Date() } });
    await app.get(ReportsService).refreshViews();
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { agencyId } });
    await prisma.claim.deleteMany({ where: { agencyId } });
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.payer.deleteMany({ where: { agencyId } });
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.get(ReportsService).refreshViews(); // drop this agency's rows from the view
    await app.close();
  });

  async function seedUser(roleName: string): Promise<Auth> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `rep-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: { agencyId, email, passwordHash: await app.get(PasswordService).hash(PASSWORD), passwordChangedAt: new Date(), firstName: 'Rae', lastName: roleName, userRoles: { create: { roleId: role.id } } },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  it('census: active patients by payer, admissions and discharges in the range', async () => {
    await http().get(`/api/v1/reports/census?${q}`).set(office).expect(403);
    const r = (await http().get(`/api/v1/reports/census?${q}`).set(supervisor).expect(200)).body.data;
    expect(r).toMatchObject({ active: 2, byStatus: { active: 2, discharged: 1 }, admissions: 1, discharges: 1, activeByPayer: [{ payer: 'Report Medicaid', patients: 2 }] });
  });

  it('visit utilization from the materialized view, day by day with no gaps', async () => {
    const r = (await http().get(`/api/v1/reports/visit-utilization?${q}`).set(supervisor).expect(200)).body.data;
    expect(r.totals).toEqual({ scheduled: 5, completed: 3, missed: 1, cancelled: 1, open: 0, completionRate: 75 });
    expect(r.daily).toHaveLength(7);
    expect(r.daily.find((d: { date: string }) => d.date === d2)).toMatchObject({ scheduled: 3, completed: 1, missed: 1, cancelled: 1 });
    const csv = (await http().get(`/api/v1/reports/visit-utilization?${q}&format=csv`).set(supervisor).expect(200)).body.data;
    expect(csv.content.split('\r\n')[0]).toBe('Date,Scheduled,Completed,Missed,Cancelled,Not yet done');
  });

  it('EVV compliance, staff productivity and missed visits', async () => {
    const evv = (await http().get(`/api/v1/reports/evv-compliance?${q}`).set(supervisor).expect(200)).body.data;
    expect(evv).toMatchObject({ completedVisits: 3, verified: 1, awaitingReview: 1, missing: 1, rejected: 0, verifiedRate: 33.3, clockInMethods: { gps: 2 } });
    const prod = (await http().get(`/api/v1/reports/staff-productivity?${q}`).set(supervisor).expect(200)).body.data;
    expect(prod.rows).toEqual([{ staffId: expect.any(String), name: 'Aide, Ada', discipline: 'HHA', completedVisits: 3, missedVisits: 1, hours: 4, averageVisitMinutes: 80 }]);
    const missed = (await http().get(`/api/v1/reports/missed-visits?${q}&format=csv`).set(supervisor).expect(200)).body.data;
    const lines = missed.content.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines.slice(1).join('\n')).toContain('missed,Client in hospital');
  });

  it('financial summary: billed, collected, denials by reason, outstanding', async () => {
    await http().get(`/api/v1/reports/financial-summary?${q}`).set(supervisor).expect(403); // no billing access
    const r = (await http().get(`/api/v1/reports/financial-summary?${q}`).set(billing).expect(200)).body.data;
    expect(r).toMatchObject({ billed: 100, claimsBilled: 1, collected: 40, denied: { claims: 1, amount: 100, rate: 100, byReason: [{ reason: '197', claims: 1, amount: 100 }] }, outstanding: 100 });
    await http().get(`/api/v1/reports/financial-summary?from=${today}&to=${addDays(today, -1)}`).set(billing).expect(400);
  });
});
