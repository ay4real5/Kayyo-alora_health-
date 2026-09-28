import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
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
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Claims (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let office: Auth;
  let patientId: string;
  let staffId: string;
  let authorId: string;
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), -4);

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
        data: { name: `Claims Test ${randomUUID()}`, timezone: 'UTC', npi },
      })
    ).id;
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');

    const payer = await prisma.payer.create({
      data: { agencyId, name: 'Claims Medicaid', payerType: 'medicaid' },
    });
    const code = await prisma.serviceCode.create({
      data: { agencyId, code: 'T1019', codeType: 'hcpcs', unitType: 'unit_15min' },
    });
    await prisma.payerRate.create({
      data: {
        payerId: payer.id,
        serviceCodeId: code.id,
        rate: 6,
        effectiveDate: toDate(addDays(day, -60))!,
      },
    });
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Clara',
          lastName: 'Claimant',
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          payerPrimaryId: payer.id,
          medicaidId: 'VA999000',
          diagnoses: {
            create: [
              { icd10Code: 'I10', description: 'Hypertension', isPrimary: false, sequenceOrder: 2 },
              {
                icd10Code: 'E119',
                description: 'Type 2 diabetes',
                isPrimary: true,
                sequenceOrder: 1,
              },
            ],
          },
        },
      })
    ).id;
    const role = await prisma.role.findFirstOrThrow({
      where: { agencyId: null, name: 'home_health_aide' },
    });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `claims-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Ann',
        lastName: 'Aide',
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    staffId = aide.staffProfile!.id;
    authorId = aide.id;
  });

  afterAll(async () => {
    await prisma.claim.deleteMany({ where: { agencyId } });
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.payer.deleteMany({ where: { agencyId } });
    await prisma.serviceCode.deleteMany({ where: { agencyId } });
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string): Promise<Auth> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `claims-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Cy',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  async function visit(date: string, start: string, end: string, billable = true) {
    const v = await prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId,
        visitType: 'home_health_aide',
        serviceCode: 'T1019',
        status: 'completed',
        scheduledDate: toDate(date)!,
        scheduledStart: toTime(start),
        scheduledEnd: toTime(end),
        actualStart: new Date(`${date}T${start}:00Z`),
        actualEnd: new Date(`${date}T${end}:00Z`),
      },
    });
    if (billable) {
      await prisma.evvRecord.create({
        data: {
          visitId: v.id,
          agencyId,
          staffId,
          patientId,
          serviceType: 'home_health_aide',
          serviceDate: toDate(date)!,
          clockInMethod: 'gps',
          status: 'verified',
        },
      });
      await prisma.visitNote.create({
        data: {
          visitId: v.id,
          staffId,
          authorId,
          noteType: 'aide_activity',
          narrative: 'ok',
          status: 'submitted',
        },
      });
    }
    return v.id;
  }

  it('bills ready visits once, as a frozen snapshot, and skips the rest with reasons', async () => {
    const a = await visit(day, '09:00', '10:00');
    const b = await visit(addDays(day, 1), '09:00', '09:30');
    const blocked = await visit(addDays(day, 1), '11:00', '12:00', false);

    await http()
      .post('/api/v1/billing/claims')
      .set(office)
      .send({ from: day, to: addDays(day, 1) })
      .expect(403);
    await http().post('/api/v1/billing/claims').set(billing).send({}).expect(400);
    const res = await http()
      .post('/api/v1/billing/claims')
      .set(billing)
      .send({ from: day, to: addDays(day, 1) })
      .expect(201);
    expect(res.body.data.created).toHaveLength(1);
    const claim = res.body.data.created[0];
    expect(claim).toMatchObject({
      status: 'ready',
      claimType: '837P',
      frequencyCode: '1',
      memberId: 'VA999000',
      diagnosisCodes: ['E119', 'I10'], // primary first
      billingPeriodStart: day,
      billingPeriodEnd: addDays(day, 1),
      totalCharges: 36, // 4 units + 2 units at $6
      qaPassed: true,
    });
    expect(claim.claimNumber).toMatch(/^\d{6}[A-Z2-9]{6}$/);
    expect(
      claim.lines.map((l: { visitId: string; units: number; chargeAmount: number }) => [
        l.visitId,
        l.units,
        l.chargeAmount,
      ]),
    ).toEqual([
      [a, 4, 24],
      [b, 2, 12],
    ]);
    expect(res.body.data.skipped).toEqual([
      { visitId: blocked, reasons: expect.arrayContaining(['No signed or submitted visit note']) },
    ]);

    // Billed visits are no longer ready, and a second run creates nothing.
    const ready = await http()
      .get(`/api/v1/billing/ready-to-bill?from=${day}&to=${addDays(day, 1)}`)
      .set(billing)
      .expect(200);
    const billedA = ready.body.data.visits.find((v: { visitId: string }) => v.visitId === a);
    expect(billedA.checks.find((c: { code: string }) => c.code === 'not_billed').message).toContain(
      claim.claimNumber,
    );
    expect(
      (
        await http()
          .post('/api/v1/billing/claims')
          .set(billing)
          .send({ from: day, to: addDays(day, 1) })
          .expect(201)
      ).body.data.created,
    ).toEqual([]);
    const again = await http()
      .post('/api/v1/billing/claims')
      .set(billing)
      .send({ visitIds: [a] })
      .expect(201);
    expect(again.body.data.skipped[0].reasons[0]).toMatch(/Already billed/);

    // Rates changing later don't change the claim (it's a snapshot).
    await prisma.payerRate.updateMany({ data: { rate: 99 } });
    expect(
      (await http().get(`/api/v1/billing/claims/${claim.id}`).set(billing).expect(200)).body.data
        .totalCharges,
    ).toBe(36);
    await prisma.payerRate.updateMany({ data: { rate: 6 } });
  });

  it('two people billing the same visit at once: exactly one claim gets it', async () => {
    const v = await visit(addDays(day, 2), '08:00', '09:00');
    const [r1, r2] = await Promise.all([
      http()
        .post('/api/v1/billing/claims')
        .set(billing)
        .send({ visitIds: [v] }),
      http()
        .post('/api/v1/billing/claims')
        .set(billing)
        .send({ visitIds: [v] }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.data.created.length + r2.body.data.created.length).toBe(1);
    expect(await prisma.claimLine.count({ where: { visitId: v, active: true } })).toBe(1);
  });

  it('QA re-check sends a claim back to draft when a visit no longer passes; void releases its visits', async () => {
    const v = await visit(addDays(day, 3), '08:00', '09:00');
    const claim = (
      await http()
        .post('/api/v1/billing/claims')
        .set(billing)
        .send({ visitIds: [v] })
        .expect(201)
    ).body.data.created[0];

    await prisma.evvRecord.updateMany({ where: { visitId: v }, data: { status: 'rejected' } });
    const checked = (
      await http().post(`/api/v1/billing/claims/${claim.id}/qa`).set(billing).expect(200)
    ).body.data;
    expect(checked).toMatchObject({ status: 'draft', qaPassed: false });
    expect(checked.qaErrors[0].messages[0]).toMatch(/rejected/);

    await http()
      .post(`/api/v1/billing/claims/${claim.id}/void`)
      .set(billing)
      .send({ reason: '' })
      .expect(400);
    const voided = (
      await http()
        .post(`/api/v1/billing/claims/${claim.id}/void`)
        .set(billing)
        .send({ reason: 'EVV rejected' })
        .expect(200)
    ).body.data;
    expect(voided).toMatchObject({ status: 'void', voidReason: 'EVV rejected' });
    expect(voided.lines[0].active).toBe(false);
    await http()
      .post(`/api/v1/billing/claims/${claim.id}/void`)
      .set(billing)
      .send({ reason: 'again' })
      .expect(409);

    // Fixed and re-billed on a new claim.
    await prisma.evvRecord.updateMany({ where: { visitId: v }, data: { status: 'verified' } });
    const rebilled = (
      await http()
        .post('/api/v1/billing/claims')
        .set(billing)
        .send({ visitIds: [v] })
        .expect(201)
    ).body.data.created[0];
    expect(rebilled.id).not.toBe(claim.id);

    const list = await http().get('/api/v1/billing/claims?status=void').set(billing).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(claim.id);
  });
});
