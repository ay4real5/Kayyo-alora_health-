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
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Institutional claims, 837I (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let medicaidId: string;
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), -5);

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
        data: {
          name: `837I Test ${randomUUID()}`,
          timezone: 'UTC',
          npi: '1234567893',
          taxId: '99-0000001',
          addressLine1: '100 Demo Plaza',
          city: 'Richmond',
          state: 'VA',
          zip: '23219-1234',
          phone: '555-010-0100',
        },
      })
    ).id;
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'billing_staff' } });
    const email = `i837-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Ina',
        lastName: 'Billing',
        userRoles: { create: { roleId: role.id } },
      },
    });
    billing = { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };

    const medicare = await prisma.payer.create({
      data: { agencyId, name: 'Demo Medicare', payerType: 'medicare', payerIdCode: 'DEMOMCR', ediSubmitterId: 'DEMOSUB01', ediReceiverId: 'DEMOCLEAR' },
    });
    const medicaid = await prisma.payer.create({
      data: { agencyId, name: 'Demo Medicaid', payerType: 'medicaid', payerIdCode: 'DEMOMCD', ediSubmitterId: 'DEMOSUB01', ediReceiverId: 'DEMOCLEAR' },
    });
    medicaidId = medicaid.id;
    const code = await prisma.serviceCode.create({
      data: { agencyId, code: 'G0156', codeType: 'hcpcs', unitType: 'unit_15min', revenueCode: '0571', defaultRate: 7.5 },
    });
    for (const payer of [medicare, medicaid]) {
      await prisma.payerRate.create({ data: { payerId: payer.id, serviceCodeId: code.id, rate: 7.5, effectiveDate: toDate(addDays(day, -60))! } });
    }
    const physician = await prisma.physician.create({ data: { agencyId, firstName: 'Dana', lastName: 'Doctor', npi: '1245319599' } });
    const role2 = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `i837-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Ann',
        lastName: 'Aide',
        userRoles: { create: { roleId: role2.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    const patient = async (payerPrimaryId: string, mrn: string) => {
      const p = await prisma.patient.create({
        data: {
          agencyId,
          mrn,
          firstName: 'Sam',
          lastName: 'Sample',
          dateOfBirth: new Date('1938-04-02T00:00:00Z'),
          gender: 'male',
          status: 'active',
          admissionDate: toDate(addDays(day, -30))!,
          payerPrimaryId,
          medicareBeneficiaryId: '1EG4TE5MK73',
          medicaidId: 'VA123456',
          primaryPhysicianId: physician.id,
          addressLine1: '12 Oak St',
          city: 'Richmond',
          state: 'VA',
          zip: '23220',
          diagnoses: { create: { icd10Code: 'I50.9', description: 'Heart failure', isPrimary: true, sequenceOrder: 1 } },
        },
      });
      const v = await prisma.visit.create({
        data: {
          agencyId,
          patientId: p.id,
          staffId: aide.staffProfile!.id,
          visitType: 'home_health_aide',
          serviceCode: 'G0156',
          status: 'completed',
          scheduledDate: toDate(day)!,
          scheduledStart: toTime('09:00'),
          scheduledEnd: toTime('10:00'),
          actualStart: new Date(`${day}T09:00:00Z`),
          actualEnd: new Date(`${day}T10:00:00Z`),
        },
      });
      await prisma.evvRecord.create({
        data: { visitId: v.id, agencyId, staffId: aide.staffProfile!.id, patientId: p.id, serviceType: 'home_health_aide', serviceDate: toDate(day)!, clockInMethod: 'gps', status: 'verified' },
      });
      await prisma.visitNote.create({
        data: { visitId: v.id, staffId: aide.staffProfile!.id, authorId: aide.id, noteType: 'aide_activity', narrative: 'ok', status: 'submitted' },
      });
      return v.id;
    };
    medicareVisit = await patient(medicare.id, 'I837-0001');
    medicaidVisit = await patient(medicaid.id, 'I837-0002');
  });

  let medicareVisit: string;
  let medicaidVisit: string;

  afterAll(async () => {
    await prisma.claim.deleteMany({ where: { agencyId } });
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.physician.deleteMany({ where: { agencyId } });
    await prisma.payer.deleteMany({ where: { agencyId } });
    await prisma.serviceCode.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  const claims = '/api/v1/billing/claims';

  it('Medicare home health claims are 837I; the preview says what is missing until HIPPS and CBSA are set', async () => {
    const res = await http().post(claims).set(billing).send({ visitIds: [medicareVisit] }).expect(201);
    const claim = res.body.data.created[0];
    expect(claim).toMatchObject({ claimType: '837I', institutional: { typeOfBill: '0329', patientStatus: '30', hippsCode: null } });

    const missing = await http().get(`${claims}/${claim.id}/837`).set(billing).expect(422);
    expect(missing.body.error.details).toEqual([
      `Claim ${claim.claimNumber}: Medicare home health claims need the 5-character HIPPS code`,
      `Claim ${claim.claimNumber}: Medicare home health claims need value code 61 (CBSA code)`,
    ]);
    await http().patch(`${claims}/${claim.id}/institutional`).set(billing).send({ hippsCode: 'BAD' }).expect(400);
    const set = await http().patch(`${claims}/${claim.id}/institutional`).set(billing).send({ hippsCode: '1fc21', cbsaCode: '40060' }).expect(200);
    expect(set.body.data.institutional).toMatchObject({ hippsCode: '1FC21', cbsaCode: '40060' });

    const file = (await http().get(`${claims}/${claim.id}/837`).set(billing).expect(200)).body.data;
    expect(file.fileName).toBe(`837I-${claim.claimNumber}-preview.edi`);
    expect(file.content).toContain('SV2*0023*HP:1FC21*0*UN*1~');
    expect(file.content).toContain('SV2*0571*HC:G0156*30*UN*4~');
    expect(file.content).toContain('HI*BE:61:::40060~');
    expect(file.content).toContain('NM1*71*1*DOCTOR*DANA****XX*1245319599~');
    expect(file.content).toContain('REF*EA*I837-0001~');
  });

  it('a payer can be set to institutional; professional claims have no institutional fields', async () => {
    await http().patch(`/api/v1/billing/payers/${medicaidId}`).set(billing).send({ claimFormat: 'XX' }).expect(400);
    await http().patch(`/api/v1/billing/payers/${medicaidId}`).set(billing).send({ claimFormat: '837I' }).expect(200);
    const claim = (await http().post(claims).set(billing).send({ visitIds: [medicaidVisit] }).expect(201)).body.data.created[0];
    expect(claim.claimType).toBe('837I');
    // Medicaid UB-04 claims don't need HIPPS or CBSA.
    const file = (await http().get(`${claims}/${claim.id}/837`).set(billing).expect(200)).body.data;
    expect(file.content).toContain('SBR*P*18*******MC~');
    expect(file.content).not.toContain('HP:');

    await http().post(`${claims}/${claim.id}/void`).set(billing).send({ reason: 'test' }).expect(200);
    await http().patch(`/api/v1/billing/payers/${medicaidId}`).set(billing).send({ claimFormat: '837P' }).expect(200);
    const prof = (await http().post(claims).set(billing).send({ visitIds: [medicaidVisit] }).expect(201)).body.data.created[0];
    expect(prof).toMatchObject({ claimType: '837P', institutional: null });
    await http().patch(`${claims}/${prof.id}/institutional`).set(billing).send({ typeOfBill: '0329' }).expect(409);
    const cleared = await http().patch(`/api/v1/billing/payers/${medicaidId}`).set(billing).send({ claimFormat: null }).expect(200);
    expect(cleared.body.data.claimFormat).toBeNull(); // back to the default for the payer type
  });
});
