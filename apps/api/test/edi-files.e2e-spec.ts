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
import { COMPONENT, pad, REPETITION, segment } from '../src/modules/billing/edi/x12.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

/** A FAKE acknowledgment interchange from the clearinghouse. */
const interchange = (functional: string, version: string, icn: string, body: string[]) =>
  [
    segment('ISA', '00', pad('', 10), '00', pad('', 10), 'ZZ', pad('DEMOCLEAR', 15), 'ZZ', pad('DEMOSUB01', 15), '260929', '0815', REPETITION, '00501', icn, '0', 'P', COMPONENT),
    segment('GS', functional, 'DEMOCLEAR', 'DEMOSUB01', '20260929', '0815', String(Number(icn)), 'X', version),
    ...body,
    segment('GE', '1', String(Number(icn))),
    segment('IEA', '1', icn),
  ].join('\n');
const ack999 = (group: string, verdict: 'A' | 'R', icn: string) =>
  interchange('FA', '005010X231A1', icn, [
    segment('ST', '999', '0001', '005010X231A1'),
    segment('AK1', 'HC', group, '005010X222A1'),
    segment('AK2', '837', '0001', '005010X222A1'),
    ...(verdict === 'R' ? [segment('IK3', 'NM1', '12', '2010BA', '8')] : []),
    segment('IK5', verdict),
    segment('AK9', verdict, '1', '1', verdict === 'A' ? '1' : '0'),
    segment('SE', '6', '0001'),
  ]);
const ack277 = (claims: { number: string; stc: string; ref?: string }[], icn: string) =>
  interchange('HN', '005010X214', icn, [
    segment('ST', '277', '0001', '005010X214'),
    segment('BHT', '0085', '08', 'B1', '20260929', '0815', 'TH'),
    segment('HL', '1', '', '20', '1'),
    segment('HL', '2', '1', '21', '1'),
    segment('HL', '3', '2', '19', '1'),
    ...claims.flatMap((c, i) => [
      segment('HL', String(4 + i), '3', 'PT'),
      segment('TRN', '2', c.number),
      segment('STC', c.stc, '20260929', c.stc.startsWith('A7') ? 'U' : 'WQ', '20'),
      ...(c.ref ? [segment('REF', '1K', c.ref)] : []),
    ]),
    segment('SE', '9', '0001'),
  ]);

describe.skipIf(!hasDb)('Claim files and acknowledgments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: { Authorization: string };
  let claimIds: string[];
  let claimNumbers: string[];
  let otherPayerClaimId: string;
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), -4);
  const files = '/api/v1/billing/edi-files';

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
          name: `EDI Files Test ${randomUUID()}`,
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
    const role = async (name: string) => (await prisma.role.findFirstOrThrow({ where: { agencyId: null, name } })).id;
    const email = `edifiles-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Eddy',
        lastName: 'Files',
        userRoles: { create: { roleId: await role('billing_staff') } },
      },
    });
    billing = { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };

    const envelope = { payerIdCode: 'DEMOMCD', ediSubmitterId: 'DEMOSUB01', ediReceiverId: 'DEMOCLEAR' };
    const medicaid = await prisma.payer.create({ data: { agencyId, name: 'Demo Medicaid', payerType: 'medicaid', ...envelope } });
    const other = await prisma.payer.create({ data: { agencyId, name: 'Demo Commercial', payerType: 'commercial', ...envelope, payerIdCode: 'DEMOCOM' } });
    const code = await prisma.serviceCode.create({ data: { agencyId, code: 'T1019', codeType: 'hcpcs', unitType: 'visit', defaultRate: 20 } });
    for (const p of [medicaid, other]) {
      await prisma.payerRate.create({ data: { payerId: p.id, serviceCodeId: code.id, rate: 20, effectiveDate: toDate(addDays(day, -60))! } });
    }
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `edifiles-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Ann',
        lastName: 'Aide',
        userRoles: { create: { roleId: await role('home_health_aide') } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    const visitFor = async (payerPrimaryId: string, mrn: string) => {
      const p = await prisma.patient.create({
        data: {
          agencyId,
          mrn,
          firstName: 'Sam',
          lastName: `Sample ${mrn}`,
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          payerPrimaryId,
          medicaidId: `9990001${mrn.slice(-5)}`,
          insuranceMemberId: `M${mrn.slice(-5)}`,
          diagnoses: { create: { icd10Code: 'R26.81', description: 'Unsteady gait', isPrimary: true, sequenceOrder: 1 } },
        },
      });
      const v = await prisma.visit.create({
        data: {
          agencyId,
          patientId: p.id,
          staffId: aide.staffProfile!.id,
          visitType: 'personal_care',
          serviceCode: 'T1019',
          status: 'completed',
          scheduledDate: toDate(day)!,
          scheduledStart: toTime('09:00'),
          scheduledEnd: toTime('10:00'),
          actualStart: new Date(`${day}T09:00:00Z`),
          actualEnd: new Date(`${day}T10:00:00Z`),
        },
      });
      await prisma.evvRecord.create({
        data: { visitId: v.id, agencyId, staffId: aide.staffProfile!.id, patientId: p.id, serviceType: 'personal_care', serviceDate: toDate(day)!, clockInMethod: 'gps', status: 'verified' },
      });
      await prisma.visitNote.create({
        data: { visitId: v.id, staffId: aide.staffProfile!.id, authorId: aide.id, noteType: 'aide_activity', narrative: 'ok', status: 'submitted' },
      });
      return v.id;
    };
    const visits = [await visitFor(medicaid.id, 'EDIF-00001'), await visitFor(medicaid.id, 'EDIF-00002')];
    const created = (await http().post('/api/v1/billing/claims').set(billing).send({ visitIds: visits }).expect(201)).body.data.created;
    claimIds = created.map((c: { id: string }) => c.id);
    claimNumbers = created.map((c: { claimNumber: string }) => c.claimNumber);
    const otherVisit = await visitFor(other.id, 'EDIF-00003');
    otherPayerClaimId = (await http().post('/api/v1/billing/claims').set(billing).send({ visitIds: [otherVisit] }).expect(201)).body.data.created[0].id;
  });

  afterAll(async () => {
    await prisma.claim.deleteMany({ where: { agencyId } });
    await prisma.ediFile.deleteMany({ where: { agencyId } });
    await prisma.visitNote.deleteMany({ where: { visit: { agencyId } } });
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

  it('one file per payer, with the next control number; the same claims can’t go in a second unsent file', async () => {
    await http().post(`${files}/837`).set(billing).send({ claimIds: [...claimIds, otherPayerClaimId] }).expect(409);
    const file = (await http().post(`${files}/837`).set(billing).send({ claimIds }).expect(201)).body.data;
    expect(file).toMatchObject({ fileType: '837P', direction: 'outbound', controlNumber: '000000001', status: 'generated', recordCount: 2 });
    expect(file.fileName).toBe('837P-000000001.edi');
    const { content } = (await http().get(`${files}/${file.id}/download`).set(billing).expect(200)).body.data;
    expect(content.split('\n')[0].slice(90, 99)).toBe('000000001'); // ISA13
    expect(content.split('\n')[0].charAt(102)).toBe('P'); // production
    for (const n of claimNumbers) expect(content).toContain(`CLM*${n}*`);
    await http().post(`${files}/837`).set(billing).send({ claimIds: [claimIds[0]] }).expect(409);

    await http().post(`${files}/${file.id}/sent`).set(billing).expect(200);
    const claims = await prisma.claim.findMany({ where: { id: { in: claimIds } } });
    expect(claims.every((c) => c.status === 'submitted' && c.ediFileId === file.id)).toBe(true);
    await http().post(`${files}/${file.id}/sent`).set(billing).expect(409);
  });

  it('999 accepts the file; the 277CA acknowledges one claim and rejects the other with its reason', async () => {
    const r999 = (await http().post(`${files}/upload-ack`).set(billing).send({ fileName: 'ack.999', content: ack999('1', 'A', '000000501') }).expect(201)).body.data;
    expect(r999).toMatchObject({ kind: '999', rejected: [] });
    expect([...r999.accepted].sort()).toEqual([...claimNumbers].sort()); // file order is by claim number, which is random
    await http().post(`${files}/upload-ack`).set(billing).send({ fileName: 'ack.999', content: ack999('1', 'A', '000000501') }).expect(409); // same file twice

    const content = ack277([{ number: claimNumbers[0]!, stc: 'A2:20:PR', ref: 'PAYER-1' }, { number: claimNumbers[1]!, stc: 'A7:562:85' }, { number: 'NOT-OURS', stc: 'A2:20' }], '000000502');
    const r277 = (await http().post(`${files}/upload-ack`).set(billing).send({ fileName: 'ack.277', content }).expect(201)).body.data;
    expect(r277).toMatchObject({ kind: '277CA', accepted: [claimNumbers[0]], unmatched: ['NOT-OURS'] });
    expect(r277.rejected).toEqual([
      { claimNumber: claimNumbers[1], reason: 'Rejected by the payer (277CA): A7 Rejected — invalid information, status code 562 (billing provider)' },
    ]);
    const [a, b] = await Promise.all(claimIds.map((id) => http().get(`/api/v1/billing/claims/${id}`).set(billing).expect(200)));
    expect(a!.body.data).toMatchObject({ status: 'acknowledged', payerClaimNumber: 'PAYER-1', rejection: null });
    expect(b!.body.data).toMatchObject({ status: 'rejected', rejection: { reason: expect.stringContaining('status code 562') } });
    await http().post(`${files}/upload-ack`).set(billing).send({ fileName: 'x.835', content: ack999('1', 'A', '000000503').replace('ST*999', 'ST*835') }).expect(400);
  });

  it('a rejected claim is re-checked, goes in a new file, and a rejected 999 rejects it again', async () => {
    const rejected = claimIds[1]!;
    const qa = (await http().post(`/api/v1/billing/claims/${rejected}/qa`).set(billing).expect(200)).body.data;
    expect(qa.status).toBe('ready');
    const file = (await http().post(`${files}/837`).set(billing).send({ claimIds: [rejected], test: true }).expect(201)).body.data;
    expect(file).toMatchObject({ controlNumber: '000000002', fileName: '837P-000000002-TEST.edi' });
    await http().post(`${files}/${file.id}/sent`).set(billing).expect(200);
    const r = (await http().post(`${files}/upload-ack`).set(billing).send({ fileName: 'ack2.999', content: ack999('2', 'R', '000000504') }).expect(201)).body.data;
    expect(r.rejected).toEqual([{ claimNumber: claimNumbers[1], reason: 'File rejected by the clearinghouse (999: Rejected) — NM1 at segment 12 (loop 2010BA): syntax error 8' }]);
    const listed = (await http().get(files).set(billing).expect(200)).body.data;
    expect(listed.find((f: { id: string }) => f.id === file.id)).toMatchObject({ status: 'rejected' });
  });
});
