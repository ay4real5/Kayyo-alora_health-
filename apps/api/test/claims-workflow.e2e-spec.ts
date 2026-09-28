import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };
const remittance = readFileSync(join(__dirname, '../src/modules/billing/edi/__fixtures__/835-basic.edi'), 'utf8');

describe.skipIf(!hasDb)('Claim workflow: submit, deny, appeal, rebill, aging (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let office: Auth;
  let visitId: string;
  const http = () => request(app.getHttpServer());
  const today = utcTodayString();
  const day = addDays(today, -10);
  const claims = '/api/v1/billing/claims';

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
        data: { name: `Workflow Test ${randomUUID()}`, timezone: 'UTC', npi: '1234567893', taxId: '99-0000001', addressLine1: '1 Way', city: 'Richmond', state: 'VA', zip: '23219-1234' },
      })
    ).id;
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');
    const payer = await prisma.payer.create({
      data: { agencyId, name: 'Demo Medicaid', payerType: 'medicaid', payerIdCode: 'DEMOMCD', ediSubmitterId: 'DEMOSUB01', ediReceiverId: 'DEMOCLEAR', appealWindowDays: 45 },
    });
    const code = await prisma.serviceCode.create({ data: { agencyId, code: 'G0156', codeType: 'hcpcs', unitType: 'unit_15min' } });
    await prisma.payerRate.create({ data: { payerId: payer.id, serviceCodeId: code.id, rate: 5, effectiveDate: toDate(addDays(day, -30))! } });
    const patient = await prisma.patient.create({
      data: {
        agencyId,
        firstName: 'Wanda',
        lastName: 'Workflow',
        dateOfBirth: new Date('1940-01-01T00:00:00Z'),
        status: 'active',
        payerPrimaryId: payer.id,
        medicaidId: 'VA111',
        diagnoses: { create: { icd10Code: 'R54', description: 'Debility', isPrimary: true, sequenceOrder: 1 } },
      },
    });
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `wf-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Al',
        lastName: 'Aide',
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    const staffId = aide.staffProfile!.id;
    const v = await prisma.visit.create({
      data: {
        agencyId, patientId: patient.id, staffId, visitType: 'home_health_aide', serviceCode: 'G0156', status: 'completed',
        scheduledDate: toDate(day)!, scheduledStart: toTime('09:00'), scheduledEnd: toTime('10:00'),
        actualStart: new Date(`${day}T09:00:00Z`), actualEnd: new Date(`${day}T10:00:00Z`),
      },
    });
    visitId = v.id;
    await prisma.evvRecord.create({
      data: { visitId, agencyId, staffId, patientId: patient.id, serviceType: 'home_health_aide', serviceDate: toDate(day)!, clockInMethod: 'gps', status: 'verified' },
    });
    await prisma.visitNote.create({ data: { visitId, staffId, authorId: aide.id, noteType: 'aide_activity', narrative: 'ok', status: 'submitted' } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { agencyId } });
    await prisma.ediFile.deleteMany({ where: { agencyId } });
    await prisma.claim.updateMany({ where: { agencyId }, data: { originalClaimId: null } });
    await prisma.claim.deleteMany({ where: { agencyId } });
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

  async function seedUser(roleName: string): Promise<Auth> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `wf-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: { agencyId, email, passwordHash: await app.get(PasswordService).hash(PASSWORD), passwordChangedAt: new Date(), firstName: 'Wes', lastName: roleName, userRoles: { create: { roleId: role.id } } },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  const aging = async () => (await http().get('/api/v1/billing/reports/aging').set(billing).expect(200)).body.data;
  let claim: { id: string; claimNumber: string };

  it('a submitted claim starts aging', async () => {
    claim = (await http().post(claims).set(billing).send({ visitIds: [visitId] }).expect(201)).body.data.created[0];
    expect((await aging()).total).toBe(0); // not sent yet
    await http().post(`${claims}/${claim.id}/submit`).set(office).expect(403);
    const sent = (await http().post(`${claims}/${claim.id}/submit`).set(billing).expect(200)).body.data;
    expect(sent.status).toBe('submitted');
    expect(sent.submittedAt).toBeTruthy();
    await http().post(`${claims}/${claim.id}/submit`).set(billing).expect(409);
    const report = await aging();
    expect(report).toMatchObject({ buckets: ['0-30', '31-60', '61-90', '91-120', '120+'], total: 20 });
    expect(report.rows).toEqual([{ id: expect.any(String), name: 'Demo Medicaid', buckets: [20, 0, 0, 0, 0], total: 20 }]);
    const later = (await http().get(`/api/v1/billing/reports/aging?asOf=${addDays(today, 45)}`).set(billing).expect(200)).body.data;
    expect(later.rows[0].buckets).toEqual([0, 20, 0, 0, 0]);
  });

  it('an 835 denial sets the appeal deadline from the payer’s window', async () => {
    const content = remittance.replaceAll('260928DEF567', claim.claimNumber).replaceAll('260928ABC234', 'NOSUCHCLAIM1');
    const payment = (await http().post('/api/v1/billing/edi-files/upload-835').set(billing).send({ fileName: 'era.835', content }).expect(201)).body.data;
    await http().post(`/api/v1/billing/payments/${payment.id}/post`).set(billing).expect(200);
    const denied = (await http().get(`${claims}/${claim.id}`).set(billing).expect(200)).body.data;
    expect(denied).toMatchObject({
      status: 'denied',
      payerClaimNumber: 'PAYERCLM002',
      denial: { code: '197', appealDeadline: addDays(today, 45) },
    });
    expect((await aging()).total).toBe(20); // still owed until the denial is final
  });

  it('appeals: filed, lost, filed again at level 2, won', async () => {
    const filed = (await http().post(`${claims}/${claim.id}/appeals`).set(billing).send({ reason: 'Authorization was on file', reference: 'APL-1' }).expect(201)).body.data;
    expect(filed).toMatchObject({ status: 'appealed', appeals: [{ level: 1, status: 'filed', reference: 'APL-1' }] });
    await http().post(`${claims}/${claim.id}/appeals`).set(billing).send({ reason: 'again' }).expect(409); // one at a time
    const lost = (await http().post(`${claims}/${claim.id}/appeals/${filed.appeals[0].id}/decision`).set(billing).send({ outcome: 'lost', notes: 'Upheld' }).expect(200)).body.data;
    expect(lost.status).toBe('denied');
    await http().post(`${claims}/${claim.id}/appeals/${filed.appeals[0].id}/decision`).set(billing).send({ outcome: 'won' }).expect(409);
    const second = (await http().post(`${claims}/${claim.id}/appeals`).set(billing).send({ reason: 'Reconsideration with records' }).expect(201)).body.data;
    expect(second.appeals.map((a: { level: number }) => a.level)).toEqual([1, 2]);
    const won = (await http().post(`${claims}/${claim.id}/appeals/${second.appeals[1].id}/decision`).set(billing).send({ outcome: 'won' }).expect(200)).body.data;
    expect(won.status).toBe('submitted'); // waiting for the payment
    expect((await aging()).total).toBe(20);
  });

  it('a corrected claim replaces the original and carries the payer’s claim number', async () => {
    await http().post(`${claims}/${claim.id}/rebill`).set(office).send({ reason: 'x' }).expect(403);
    const replacement = (await http().post(`${claims}/${claim.id}/rebill`).set(billing).send({ reason: 'Corrected units' }).expect(201)).body.data;
    expect(replacement).toMatchObject({ status: 'ready', frequencyCode: '7', originalClaimId: claim.id, totalCharges: 20 });
    expect(replacement.claimNumber).not.toBe(claim.claimNumber);
    expect((await http().get(`${claims}/${claim.id}`).set(billing).expect(200)).body.data.status).toBe('replaced');
    const file = (await http().get(`${claims}/${replacement.id}/837`).set(billing).expect(200)).body.data;
    expect(file.content).toContain(`CLM*${replacement.claimNumber}*20***12:B:7*Y*A*Y*Y~`);
    expect(file.content).toContain('REF*F8*PAYERCLM002~');
    await http().post(`${claims}/${claim.id}/rebill`).set(billing).send({ reason: 'again' }).expect(409);
    expect((await aging()).total).toBe(0); // the replacement isn't sent yet; the original is closed
  });
});
