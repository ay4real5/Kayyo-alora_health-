import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };
const fixture = (name: string) => readFileSync(join(__dirname, '../src/modules/billing/edi/__fixtures__', name), 'utf8');

describe.skipIf(!hasDb)('Eligibility 270/271 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let office: Auth;
  let patientId: string;
  let noMemberId: string;
  let privatePatient: string;
  const http = () => request(app.getHttpServer());
  const base = '/api/v1/billing/eligibility';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (
      await prisma.agency.create({ data: { name: `Eligibility Test ${randomUUID()}`, timezone: 'UTC', npi: '1234567893', taxId: '99-0000001' } })
    ).id;
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');
    const medicaid = await prisma.payer.create({
      data: { agencyId, name: 'Demo Medicaid', payerType: 'medicaid', payerIdCode: 'DEMOMCD', ediSubmitterId: 'DEMOSUB01', ediReceiverId: 'DEMOCLEAR' },
    });
    const privatePay = await prisma.payer.create({ data: { agencyId, name: 'Private pay', payerType: 'private_pay' } });
    const patient = (firstName: string, payerPrimaryId: string, medicaidId: string | null) =>
      prisma.patient.create({
        data: { agencyId, firstName, lastName: 'Eligible', dateOfBirth: new Date('1940-01-01T00:00:00Z'), gender: 'female', status: 'active', payerPrimaryId, medicaidId },
      });
    patientId = (await patient('Ella', medicaid.id, 'VA999000')).id;
    noMemberId = (await patient('Nora', medicaid.id, null)).id;
    privatePatient = (await patient('Pia', privatePay.id, null)).id;
  });

  afterAll(async () => {
    await prisma.eligibilityCheck.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.payer.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string): Promise<Auth> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `elig-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Eli',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  let trace: string;
  let checkId: string;

  it('makes a 270 for the primary payer, ready to send', async () => {
    await http().post(base).set(office).send({ patientId }).expect(403);
    const res = await http().post(base).set(billing).send({ patientId, serviceDate: '2026-09-28' }).expect(201);
    ({ traceNumber: trace, id: checkId } = res.body.data);
    expect(res.body.data).toMatchObject({ status: 'pending', memberId: 'VA999000', serviceDate: '2026-09-28', payer: { name: 'Demo Medicaid' } });
    expect(trace).toMatch(/^ELG\d{6}[A-Z2-9]{6}$/);

    const file = await http().get(`${base}/${checkId}/270`).set(billing).expect(200);
    expect(file.headers['content-disposition']).toBe(`attachment; filename="270-${trace}.x12"`);
    expect(file.text).toContain(`TRN*1*${trace}*1990000001~`);
    expect(file.text).toContain('NM1*IL*1*ELIGIBLE*ELLA****MI*VA999000~');
    const list = (await http().get(`${base}?patientId=${patientId}`).set(billing).expect(200)).body.data;
    expect(list.map((c: { id: string }) => c.id)).toEqual([checkId]);
  });

  it('says what is missing, and refuses private pay', async () => {
    const res = await http().post(base).set(billing).send({ patientId: noMemberId }).expect(422);
    expect(res.body.error).toMatchObject({ code: 'ELIGIBILITY_INCOMPLETE', details: { problems: ["The patient's member ID for this payer is missing"] } });
    await http().post(base).set(billing).send({ patientId: privatePatient }).expect(400);
    await http().post(base).set(billing).send({ patientId: randomUUID() }).expect(404);
  });

  it('files the 271 on its request by trace number', async () => {
    const answer = fixture('271-active.edi').replaceAll('ELG260928AB12', trace);
    await http().post(`${base}/responses`).set(office).send({ content: answer }).expect(403);
    const res = await http().post(`${base}/responses`).set(billing).send({ content: answer }).expect(201);
    expect(res.body.data).toMatchObject({
      id: checkId,
      status: 'active',
      coverageActive: true,
      planName: 'VIRGINIA MEDICAID FFS',
      coverageStart: '2026-01-01',
      coverageEnd: '2026-12-31',
      copay: 3,
      coinsurancePercent: 20,
      deductible: 500,
      deductibleRemaining: 125.5,
    });
    expect(res.body.data.benefits.length).toBeGreaterThan(3);
  });

  it('records payer rejections, and refuses unknown or broken files', async () => {
    const second = (await http().post(base).set(billing).send({ patientId }).expect(201)).body.data;
    const rejected = fixture('271-rejected.edi').replaceAll('ELG260928ZZ99', second.traceNumber);
    const res = await http().post(`${base}/responses`).set(billing).send({ content: rejected }).expect(201);
    expect(res.body.data).toMatchObject({ status: 'rejected', coverageActive: null, errorMessage: 'Invalid/missing subscriber/insured ID' });
    await http().post(`${base}/responses`).set(billing).send({ content: fixture('271-rejected.edi') }).expect(404); // unknown trace
    await http().post(`${base}/responses`).set(billing).send({ content: 'not x12' }).expect(400);
  });
});
