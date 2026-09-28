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

/** A small FAKE 835 paying the given claims. */
function era(
  claims: {
    number: string;
    status: string;
    charge: number;
    paid: number;
    patient: number;
    lines: string[];
    cas?: string;
  }[],
  trace = randomUUID().slice(0, 12),
) {
  const paid = claims.reduce((s, c) => s + c.paid, 0);
  const body = [
    `ST*835*0001~`,
    `BPR*I*${paid}*C*ACH*CCP*01*999999999*DA*123456*1234567890**01*999988880*DA*98765*20260930~`,
    `TRN*1*${trace}*1234567890~`,
    `N1*PR*TEST MEDICAID~`,
    `REF*2U*PAYTEST~`,
    `N1*PE*TEST AGENCY*XX*1234567893~`,
    `LX*1~`,
    ...claims.flatMap((c) => [
      `CLP*${c.number}*${c.status}*${c.charge}*${c.paid}*${c.patient}*MC*PCN-${c.number}~`,
      ...(c.cas ? [c.cas] : []),
      ...c.lines,
    ]),
  ];
  return [
    'ISA*00*          *00*          *ZZ*CLEAR          *ZZ*SUB            *260930*1200*^*00501*000000555*0*T*:~',
    'GS*HP*CLEAR*SUB*20260930*1200*555*X*005010X221A1~',
    ...body,
    `SE*${body.length + 1}*0001~`,
    'GE*1*555~',
    'IEA*1*000000555~',
  ].join('\n');
}

describe.skipIf(!hasDb)('835 payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let office: Auth;
  let patientId: string;
  let staffId: string;
  let authorId: string;
  let payerId: string;
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), -6);

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
        data: { name: `ERA Test ${randomUUID()}`, timezone: 'UTC', npi },
      })
    ).id;
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');
    payerId = (
      await prisma.payer.create({
        data: { agencyId, name: 'ERA Medicaid', payerType: 'medicaid', payerIdCode: 'PAYTEST' },
      })
    ).id;
    const code = await prisma.serviceCode.create({
      data: { agencyId, code: 'T1019', codeType: 'hcpcs', unitType: 'unit_15min' },
    });
    await prisma.payerRate.create({
      data: { payerId, serviceCodeId: code.id, rate: 6, effectiveDate: toDate(addDays(day, -60))! },
    });
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Ray',
          lastName: 'Remit',
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          payerPrimaryId: payerId,
          medicaidId: 'VA555',
          diagnoses: { create: { icd10Code: 'I10', description: 'Hypertension', isPrimary: true } },
        },
      })
    ).id;
    const role = await prisma.role.findFirstOrThrow({
      where: { agencyId: null, name: 'home_health_aide' },
    });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `era-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Ed',
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
    await prisma.payment.deleteMany({ where: { agencyId } });
    await prisma.ediFile.deleteMany({ where: { agencyId } });
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
    const email = `era-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Era',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  /** A billed 1-hour visit on `date` → its claim. */
  async function billedClaim(date: string) {
    const v = await prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId,
        visitType: 'home_health_aide',
        serviceCode: 'T1019',
        status: 'completed',
        scheduledDate: toDate(date)!,
        scheduledStart: toTime('09:00'),
        scheduledEnd: toTime('10:00'),
        actualStart: new Date(`${date}T09:00:00Z`),
        actualEnd: new Date(`${date}T10:00:00Z`),
      },
    });
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
    const res = await http()
      .post('/api/v1/billing/claims')
      .set(billing)
      .send({ visitIds: [v.id] })
      .expect(201);
    return res.body.data.created[0] as { id: string; claimNumber: string; totalCharges: number };
  }

  it('loads an 835, matches claims, posts once: paid, partially paid, denied', async () => {
    const full = await billedClaim(day);
    const partial = await billedClaim(addDays(day, 1));
    const denied = await billedClaim(addDays(day, 2));
    const svc = (date: string, paid: number, cas: string) => [
      `SVC*HC:T1019*24*${paid}**4~`,
      `DTM*472*${date.replaceAll('-', '')}~`,
      cas,
    ];
    const text = era([
      {
        number: full.claimNumber,
        status: '1',
        charge: 24,
        paid: 20,
        patient: 0,
        lines: svc(day, 20, 'CAS*CO*45*4~'),
      },
      {
        number: partial.claimNumber,
        status: '1',
        charge: 24,
        paid: 10,
        patient: 0,
        lines: svc(addDays(day, 1), 10, 'CAS*CO*45*4~'),
      },
      {
        number: denied.claimNumber,
        status: '4',
        charge: 24,
        paid: 0,
        patient: 0,
        cas: 'CAS*CO*197*24~',
        lines: [],
      },
      { number: 'NOTOURS00001', status: '1', charge: 10, paid: 10, patient: 0, lines: [] },
    ]);

    await http()
      .post('/api/v1/billing/edi-files/upload-835')
      .set(office)
      .send({ fileName: 'era.835', content: text })
      .expect(403);
    await http()
      .post('/api/v1/billing/edi-files/upload-835')
      .set(billing)
      .send({ fileName: 'x', content: 'not x12' })
      .expect(400);
    const uploaded = (
      await http()
        .post('/api/v1/billing/edi-files/upload-835')
        .set(billing)
        .send({ fileName: 'era.835', content: text })
        .expect(201)
    ).body.data;
    expect(uploaded).toMatchObject({
      status: 'received',
      paymentAmount: 40,
      paymentMethod: 'ACH',
      payer: { id: payerId },
      unmatched: ['NOTOURS00001'],
    });
    expect(uploaded.details).toHaveLength(4);
    await http()
      .post('/api/v1/billing/edi-files/upload-835')
      .set(billing)
      .send({ fileName: 'again.835', content: text })
      .expect(409);

    // Nothing applied until posted.
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: full.id } })).status).toBe('ready');
    await http().post(`/api/v1/billing/payments/${uploaded.id}/post`).set(office).expect(403);
    const posted = (
      await http().post(`/api/v1/billing/payments/${uploaded.id}/post`).set(billing).expect(200)
    ).body.data;
    expect(posted.status).toBe('posted');
    await http().post(`/api/v1/billing/payments/${uploaded.id}/post`).set(billing).expect(409);

    const claim = async (id: string) =>
      (await http().get(`/api/v1/billing/claims/${id}`).set(billing).expect(200)).body.data;
    expect(await claim(full.id)).toMatchObject({ status: 'paid', totalPaid: 20 }); // 24 = 20 paid + 4 contractual
    expect((await claim(full.id)).lines[0]).toMatchObject({ chargeAmount: 24 });
    const fullLine = await prisma.claimLine.findFirstOrThrow({ where: { claimId: full.id } });
    expect([Number(fullLine.paidAmount), Number(fullLine.adjustmentAmount)]).toEqual([20, 4]);
    expect(await claim(partial.id)).toMatchObject({ status: 'partially_paid', totalPaid: 10 }); // 10 still owed
    const deniedClaim = await prisma.claim.findUniqueOrThrow({ where: { id: denied.id } });
    expect(deniedClaim).toMatchObject({
      status: 'denied',
      denialReasonCode: '197',
      payerClaimNumber: `PCN-${denied.claimNumber}`,
    });

    const list = await http().get('/api/v1/billing/payments').set(billing).expect(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(uploaded.id);
  });

  it('accepts remittance files larger than the default 100 kB body limit', async () => {
    const big =
      era([{ number: 'NOTOURS00002', status: '1', charge: 1, paid: 1, patient: 0, lines: [] }]) +
      '\n' +
      ' '.repeat(300_000);
    await http()
      .post('/api/v1/billing/edi-files/upload-835')
      .set(billing)
      .send({ fileName: 'big.835', content: big })
      .expect(201);
  });
});
