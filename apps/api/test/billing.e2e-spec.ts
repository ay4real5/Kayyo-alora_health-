import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { BillingSetupService } from '../src/modules/billing/billing-setup.service.js';
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
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Billing setup and authorizations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let office: Auth;
  let hha: Auth;
  const http = () => request(app.getHttpServer());
  const today = utcTodayString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (
      await prisma.agency.create({
        data: { name: `Billing Test ${randomUUID()}`, timezone: 'UTC' },
      })
    ).id;
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');
    hha = await seedUser('home_health_aide');
  });

  afterAll(async () => {
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } }); // authorizations cascade
    await prisma.payer.deleteMany({ where: { agencyId } }); // rates cascade
    await prisma.serviceCode.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string): Promise<Auth> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `bill-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Bea',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  async function seedPatient(payerPrimaryId?: string) {
    return (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Paul',
          lastName: `Payer-${randomUUID().slice(0, 6)}`,
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          admissionDate: new Date('2025-01-01T00:00:00Z'),
          payerPrimaryId: payerPrimaryId ?? null,
        },
      })
    ).id;
  }

  const createPayer = (body: Record<string, unknown>) =>
    http().post('/api/v1/billing/payers').set(billing).send(body);

  describe('payers and service codes', () => {
    it('billing sets them up; office can read them to pick; aides cannot see them', async () => {
      await createPayer({ name: '', payerType: 'medicaid' }).expect(400);
      await createPayer({ name: 'X', payerType: 'bitcoin' }).expect(400);
      const payer = (
        await createPayer({
          name: 'Test Medicaid',
          payerType: 'medicaid',
          state: 'va',
          requiresAuthorization: true,
        }).expect(201)
      ).body.data;
      expect(payer).toMatchObject({
        state: 'VA',
        requiresAuthorization: true,
        timelyFilingDays: 365,
        isActive: true,
      });

      await http()
        .post('/api/v1/billing/payers')
        .set(office)
        .send({ name: 'No', payerType: 'other' })
        .expect(403);
      const list = await http().get('/api/v1/billing/payers').set(office).expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toContain(payer.id);
      await http().get('/api/v1/billing/payers').set(hha).expect(403);

      await http()
        .patch(`/api/v1/billing/payers/${payer.id}`)
        .set(billing)
        .send({ timelyFilingDays: 90 })
        .expect(200);

      const code = await http()
        .post('/api/v1/billing/service-codes')
        .set(billing)
        .send({
          code: 't1019',
          codeType: 'hcpcs',
          unitType: 'unit_15min',
          defaultRate: 5.25,
          description: 'Personal care',
        })
        .expect(201);
      expect(code.body.data).toMatchObject({ code: 'T1019', defaultRate: 5.25 });
      await http()
        .post('/api/v1/billing/service-codes')
        .set(billing)
        .send({ code: 'T1019', codeType: 'hcpcs', unitType: 'hour' })
        .expect(409);
      await http()
        .post('/api/v1/billing/service-codes')
        .set(billing)
        .send({ code: 'T-10', codeType: 'hcpcs', unitType: 'hour' })
        .expect(400);
    });
  });

  describe('rates', () => {
    it('never overlap; ended, not edited; the rate on a date is unambiguous', async () => {
      const payer = (await createPayer({ name: 'Rate Payer', payerType: 'commercial' }).expect(201))
        .body.data;
      const code = (
        await http()
          .post('/api/v1/billing/service-codes')
          .set(billing)
          .send({ code: 'G0156', codeType: 'hcpcs', unitType: 'unit_15min' })
          .expect(201)
      ).body.data;
      const rates = `/api/v1/billing/payers/${payer.id}/rates`;
      const first = (
        await http()
          .post(rates)
          .set(billing)
          .send({ serviceCodeId: code.id, rate: 7.5, effectiveDate: '2026-01-01' })
          .expect(201)
      ).body.data;

      const clash = await http()
        .post(rates)
        .set(billing)
        .send({ serviceCodeId: code.id, rate: 8, effectiveDate: '2026-07-01' })
        .expect(409);
      expect(clash.body.error.message).toMatch(/still open/);
      // A different modifier is a different rate line.
      await http()
        .post(rates)
        .set(billing)
        .send({ serviceCodeId: code.id, rate: 9, effectiveDate: '2026-07-01', modifier1: 'u1' })
        .expect(201);

      await http()
        .patch(`/api/v1/billing/payer-rates/${first.id}`)
        .set(billing)
        .send({ endDate: '2026-06-30' })
        .expect(200);
      await http()
        .patch(`/api/v1/billing/payer-rates/${first.id}`)
        .set(billing)
        .send({ endDate: '2026-12-31' })
        .expect(400); // no extending
      await http()
        .post(rates)
        .set(billing)
        .send({ serviceCodeId: code.id, rate: 8, effectiveDate: '2026-07-01' })
        .expect(201);
      await http()
        .post(rates)
        .set(billing)
        .send({
          serviceCodeId: code.id,
          rate: 1,
          effectiveDate: '2026-03-01',
          endDate: '2026-03-31',
        })
        .expect(409);

      const setup = app.get(BillingSetupService);
      expect(await setup.rateOn(payer.id, code.id, '2026-03-15')).toBe(7.5);
      expect(await setup.rateOn(payer.id, code.id, '2026-08-15')).toBe(8);
      expect(await setup.rateOn(payer.id, code.id, '2026-08-15', 'U1')).toBe(9);
      expect(await setup.rateOn(payer.id, code.id, '2025-12-31')).toBeNull();

      await http().get(rates).set(office).expect(403); // money is billing's
      expect((await http().get(rates).set(billing).expect(200)).body.data).toHaveLength(3);
    });
  });

  describe('authorizations', () => {
    it('links booked visits, counts usage from them, and warns when missing or used up', async () => {
      const payer = (
        await createPayer({
          name: 'Auth Payer',
          payerType: 'medicaid',
          requiresAuthorization: true,
        }).expect(201)
      ).body.data;
      await http()
        .post('/api/v1/billing/service-codes')
        .set(billing)
        .send({ code: 'S5125', codeType: 'hcpcs', unitType: 'unit_15min' })
        .expect(201);
      const patientId = await seedPatient(payer.id);
      const day = addDays(today, 10);
      const book = (start: string, end: string, date = day) =>
        http()
          .post('/api/v1/schedule/visits')
          .set(office)
          .send({
            patientId,
            visitType: 'home_health_aide',
            serviceCode: 'S5125',
            scheduledDate: date,
            scheduledStart: start,
            scheduledEnd: end,
          });

      // No authorization yet: booked, with a warning.
      const unauthorized = (await book('08:00', '09:00').expect(201)).body.data;
      expect(unauthorized.warnings.map((w: { code: string }) => w.code)).toContain(
        'authorization_missing',
      );

      const auths = `/api/v1/patients/${patientId}/authorizations`;
      await http()
        .post(auths)
        .set(office)
        .send({ payerId: payer.id, startDate: today, endDate: addDays(today, 30) })
        .expect(400); // no limit
      await http()
        .post(auths)
        .set(office)
        .send({
          payerId: payer.id,
          serviceCode: 'NOPE1',
          startDate: today,
          endDate: today,
          authorizedVisits: 2,
        })
        .expect(400);
      await http()
        .post(auths)
        .set(hha)
        .send({ payerId: payer.id, startDate: today, endDate: today, authorizedVisits: 2 })
        .expect(403);
      const auth = (
        await http()
          .post(auths)
          .set(office)
          .send({
            payerId: payer.id,
            authorizationNumber: 'A-1',
            serviceCode: 's5125',
            startDate: today,
            endDate: addDays(today, 30),
            authorizedVisits: 2,
            authorizedHours: 3,
          })
          .expect(201)
      ).body.data;
      expect(auth).toMatchObject({
        serviceCode: 'S5125',
        state: 'active',
        used: { visits: 0 },
        planned: { visits: 0 },
        remaining: { visits: 2, hours: 3 },
      });

      const first = (await book('10:00', '11:00').expect(201)).body.data;
      expect(first.warnings).toEqual([]);
      expect(
        (await prisma.visit.findUniqueOrThrow({ where: { id: first.id } })).authorizationId,
      ).toBe(auth.id);
      const second = (await book('12:00', '13:30').expect(201)).body.data;
      expect(second.warnings).toEqual([]);
      // Third visit exceeds both limits: still booked, flagged.
      const third = (await book('14:00', '15:00').expect(201)).body.data;
      expect(third.warnings.map((w: { code: string }) => w.code)).toContain(
        'authorization_exhausted',
      );

      const listed = (await http().get(auths).set(billing).expect(200)).body.data[0];
      expect(listed).toMatchObject({
        planned: { visits: 3, hours: 3.5 },
        remaining: { visits: -1, hours: -0.5 },
        state: 'exhausted',
      });

      // Completed visits count as used, with actual times.
      await prisma.visit.update({
        where: { id: first.id },
        data: {
          status: 'completed',
          actualStart: new Date(`${day}T10:00:00Z`),
          actualEnd: new Date(`${day}T10:30:00Z`),
        },
      });
      const after = (await http().get(auths).set(billing).expect(200)).body.data[0];
      expect(after).toMatchObject({
        used: { visits: 1, hours: 0.5 },
        planned: { visits: 2, hours: 2.5 },
      });

      // Cancelling the authorization releases booked visits.
      await http()
        .patch(`${auths}/${auth.id}`)
        .set(office)
        .send({ status: 'cancelled' })
        .expect(200);
      expect(
        (await prisma.visit.findUniqueOrThrow({ where: { id: second.id } })).authorizationId,
      ).toBeNull();
      expect(
        (await prisma.visit.findUniqueOrThrow({ where: { id: first.id } })).authorizationId,
      ).toBe(auth.id); // history kept
      expect(unauthorized.id).toBeTruthy();
    });

    it('reports expired, upcoming and expiring-soon states', async () => {
      const payer = (await createPayer({ name: 'State Payer', payerType: 'medicaid' }).expect(201))
        .body.data;
      const patientId = await seedPatient();
      const auths = `/api/v1/patients/${patientId}/authorizations`;
      const make = (startDate: string, endDate: string) =>
        http()
          .post(auths)
          .set(office)
          .send({ payerId: payer.id, startDate, endDate, authorizedVisits: 5 })
          .expect(201);
      await make(addDays(today, -60), addDays(today, -1));
      await make(addDays(today, 5), addDays(today, 60));
      await make(addDays(today, -5), addDays(today, 7));
      const states = (await http().get(auths).set(office).expect(200)).body.data.map(
        (a: { state: string; expiringSoon: boolean }) => [a.state, a.expiringSoon],
      );
      expect(states).toEqual([
        ['upcoming', false],
        ['active', true],
        ['expired', false],
      ]);
    });
  });
});
