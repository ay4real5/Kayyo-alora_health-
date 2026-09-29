import { randomUUID } from 'node:crypto';
import { zonedTimeToUtc } from '@alora/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { localDateTime } from '../src/modules/billing/edi/evv-virginia.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const TZ = 'America/New_York';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

/** Virginia Medicaid EVV on claims (P4-04, D-069). FAKE data only. */
describe.skipIf(!hasDb)('Virginia EVV on claims (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let aideStaffId: string;
  let medicaidId: string;
  let mcoId: string;
  let personalCareVisit: string;
  let homeHealthVisit: string;
  let overnightVisit: string;
  let visitFor: (payerPrimaryId: string, mrn: string, serviceCode: string, start?: Date, end?: Date) => Promise<string>;
  let aideUserId: string;
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), -5);
  // 09:00–13:00 Eastern (EDT or EST, whichever applies on that day).
  const clockIn = new Date(`${day}T13:00:00Z`);
  const clockOut = new Date(`${day}T17:00:00Z`);
  const times = `${localDateTime(clockIn, TZ).hhmm}-${localDateTime(clockOut, TZ).hhmm}`;

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
          name: `VA EVV Test ${randomUUID()}`,
          timezone: TZ,
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
    const email = `vaevv-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Val',
        lastName: 'Billing',
        userRoles: { create: { roleId: role.id } },
      },
    });
    billing = { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };

    const envelope = { payerIdCode: 'DEMOMCD', ediSubmitterId: 'DEMOSUB01', ediReceiverId: 'DEMOCLEAR' };
    medicaidId = (await prisma.payer.create({ data: { agencyId, name: 'Demo VA Medicaid', payerType: 'medicaid', ...envelope } })).id;
    mcoId = (
      await prisma.payer.create({
        data: { agencyId, name: 'Demo VA MCO', payerType: 'medicaid_mco', claimFormat: '837I', ...envelope },
      })
    ).id;
    const personalCare = await prisma.serviceCode.create({
      data: { agencyId, code: 'T1019', codeType: 'hcpcs', unitType: 'hour', defaultRate: 20 },
    });
    const nursing = await prisma.serviceCode.create({
      data: { agencyId, code: 'G0299', codeType: 'hcpcs', unitType: 'visit', revenueCode: '0551', defaultRate: 90 },
    });
    const from = toDate(addDays(day, -60))!;
    await prisma.payerRate.create({ data: { payerId: medicaidId, serviceCodeId: personalCare.id, rate: 20, effectiveDate: from } });
    await prisma.payerRate.create({ data: { payerId: mcoId, serviceCodeId: nursing.id, rate: 90, effectiveDate: from } });
    const physician = await prisma.physician.create({ data: { agencyId, firstName: 'Dana', lastName: 'Doctor', npi: '1245319599' } });
    const aideRole = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `vaevv-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Avery',
        lastName: 'Aide',
        userRoles: { create: { roleId: aideRole.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } }, // no employee ID yet
      },
      include: { staffProfile: true },
    });
    aideStaffId = aide.staffProfile!.id;
    aideUserId = aide.id;

    visitFor = async (payerPrimaryId: string, mrn: string, serviceCode: string, start = clockIn, end = clockOut) => {
      const p = await prisma.patient.create({
        data: {
          agencyId,
          mrn,
          firstName: 'Sam',
          lastName: 'Sample',
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          gender: 'female',
          status: 'active',
          admissionDate: toDate(addDays(day, -30))!,
          payerPrimaryId,
          medicaidId: '999000111222',
          primaryPhysicianId: physician.id,
          addressLine1: '12 Oak St',
          city: 'Richmond',
          state: 'VA',
          zip: '23220',
          diagnoses: { create: { icd10Code: 'R26.81', description: 'Unsteady gait', isPrimary: true, sequenceOrder: 1 } },
        },
      });
      const v = await prisma.visit.create({
        data: {
          agencyId,
          patientId: p.id,
          staffId: aideStaffId,
          visitType: 'personal_care',
          serviceCode,
          status: 'completed',
          scheduledDate: toDate(day)!,
          scheduledStart: toTime('09:00'),
          scheduledEnd: toTime('13:00'),
          actualStart: start,
          actualEnd: end,
        },
      });
      await prisma.evvRecord.create({
        data: {
          visitId: v.id,
          agencyId,
          staffId: aideStaffId,
          patientId: p.id,
          serviceType: 'personal_care',
          serviceDate: toDate(day)!,
          clockInMethod: 'gps',
          clockInTime: start,
          clockOutTime: end,
          clockInWithinGeofence: true,
          clockOutWithinGeofence: true,
          status: 'verified',
        },
      });
      await prisma.visitNote.create({
        data: { visitId: v.id, staffId: aideStaffId, authorId: aide.id, noteType: 'aide_activity', narrative: 'ok', status: 'submitted' },
      });
      return v.id;
    };
    personalCareVisit = await visitFor(medicaidId, 'VAEVV-0001', 'T1019');
    homeHealthVisit = await visitFor(mcoId, 'VAEVV-0002', 'G0299');
    // 22:00 to 06:00 Eastern the next morning — an overnight personal care shift.
    overnightVisit = await visitFor(medicaidId, 'VAEVV-0003', 'T1019', zonedTimeToUtc(day, '22:00', TZ), zonedTimeToUtc(addDays(day, 1), '06:00', TZ));
  });

  afterAll(async () => {
    await prisma.claim.deleteMany({ where: { agencyId } });
    await prisma.visitNote.deleteMany({ where: { visit: { agencyId } } });
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
  const payers = '/api/v1/billing/payers';

  it('personal care (837P): no EVV fields until the payer uses the Virginia profile; then the attendant ID is required', async () => {
    const claim = (await http().post(claims).set(billing).send({ visitIds: [personalCareVisit] }).expect(201)).body.data.created[0];
    expect(claim.claimType).toBe('837P');
    const plain = (await http().get(`${claims}/${claim.id}/837`).set(billing).expect(200)).body.data.content;
    expect(plain).toContain('SV1*HC:T1019*');
    expect(plain).not.toContain('NM1*DQ');

    await http().patch(`${payers}/${medicaidId}`).set(billing).send({ evvClaimProfile: 'tx_hhsc' }).expect(400);
    const set = await http().patch(`${payers}/${medicaidId}`).set(billing).send({ evvClaimProfile: 'va_dmas' }).expect(200);
    expect(set.body.data.evvClaimProfile).toBe('va_dmas');

    const missing = await http().get(`${claims}/${claim.id}/837`).set(billing).expect(422);
    expect(missing.body.error.details).toEqual([
      `Line 1 (T1019 on ${day}): caregiver has no employee ID (Staff → employee ID) (DMAS edit 2098)`,
    ]);

    await prisma.staffProfile.update({ where: { id: aideStaffId }, data: { employeeId: 'VA0042' } });
    const file = (await http().get(`${claims}/${claim.id}/837`).set(billing).expect(200)).body.data.content;
    expect(file).toContain(`SV1*HC:T1019:::::${times}*80*UN*4***1~`);
    expect(file).toContain(
      ['NM1*DQ*1*AIDE*AVERY~', 'REF*LU*VA0042~', 'NM1*PW*2~', 'N3*12 OAK ST~', 'N4*RICHMOND*VA*23220~', 'NM1*45*2~'].join('\n'),
    );
  });

  it('home health (837I, bill type 32x): HH EVV service location, times and attendant', async () => {
    await http().patch(`${payers}/${mcoId}`).set(billing).send({ evvClaimProfile: 'va_dmas' }).expect(200);
    const claim = (await http().post(claims).set(billing).send({ visitIds: [homeHealthVisit] }).expect(201)).body.data.created[0];
    expect(claim.claimType).toBe('837I');
    const file = (await http().get(`${claims}/${claim.id}/837`).set(billing).expect(200)).body.data.content;
    expect(file).toContain(['NM1*77*2*HH EVV Service Location~', 'N3*12 OAK ST~', 'N4*RICHMOND*VA*23220~', 'REF*LU*99999~'].join('\n'));
    expect(file).toContain(`SV2*0551*HC:G0299:::::${times}*90*UN*1~`);
    expect(file).toContain(['NM1*DN*1*AIDE*AVERY~', 'REF*G2*VA0042~'].join('\n'));

    // A clock-out away from home that nobody verified would be denied (edit 2096).
    await prisma.evvRecord.update({ where: { visitId: homeHealthVisit }, data: { status: 'completed', clockOutWithinGeofence: false } });
    const away = await http().get(`${claims}/${claim.id}/837`).set(billing).expect(422);
    expect(away.body.error.details).toEqual([
      `Line 1 (G0299 on ${day}): clock-out was away from the patient's home and hasn't been verified (DMAS edit 2096)`,
    ]);
  });

  it('an overnight shift is billed as one line per day; readiness catches missing caregiver IDs before the claim', async () => {
    await prisma.staffProfile.update({ where: { id: aideStaffId }, data: { employeeId: null } });
    const blocked = (await http().post(claims).set(billing).send({ visitIds: [overnightVisit] }).expect(201)).body.data;
    expect(blocked.created).toEqual([]);
    expect(blocked.skipped[0].reasons).toEqual([
      'EVV data for the claim: caregiver has no employee ID (Staff → employee ID) (DMAS edit 2098)',
    ]);

    await prisma.staffProfile.update({ where: { id: aideStaffId }, data: { employeeId: 'VA0042' } });
    const claim = (await http().post(claims).set(billing).send({ visitIds: [overnightVisit] }).expect(201)).body.data.created[0];
    const next = addDays(day, 1);
    expect(claim.lines.map((l: { serviceDate: string; units: number; chargeAmount: number }) => [l.serviceDate, l.units, l.chargeAmount])).toEqual([
      [day, 2, 40],
      [next, 6, 120],
    ]);
    expect(claim).toMatchObject({ billingPeriodStart: day, billingPeriodEnd: next, totalCharges: 160 });
    const file = (await http().get(`${claims}/${claim.id}/837`).set(billing).expect(200)).body.data.content;
    expect(file).toContain('SV1*HC:T1019:::::2200-2359*40*UN*2***1~');
    expect(file).toContain('SV1*HC:T1019:::::0000-0600*120*UN*6***1~');

    // Voiding frees both days; billing again works (one active line per visit and day).
    await http().post(`${claims}/${claim.id}/void`).set(billing).send({ reason: 'test' }).expect(200);
    const again = (await http().post(claims).set(billing).send({ visitIds: [overnightVisit] }).expect(201)).body.data;
    expect(again.created[0].lines).toHaveLength(2);
    const twice = (await http().post(claims).set(billing).send({ visitIds: [overnightVisit] }).expect(201)).body.data;
    expect(twice.created).toEqual([]);
  });

  it('options (off by default): whole hours per month with carry-forward, and UB for a live-in client', async () => {
    const set = await http().patch(`${payers}/${medicaidId}`).set(billing).send({ hourRounding: 'monthly' }).expect(200);
    expect(set.body.data.hourRounding).toBe('monthly');
    // Two personal care shifts the same day for one client: 90 and 45 minutes.
    const first = await visitFor(medicaidId, 'VAEVV-0004', 'T1019', zonedTimeToUtc(day, '08:00', TZ), zonedTimeToUtc(day, '09:30', TZ));
    const { patientId } = await prisma.visit.findUniqueOrThrow({ where: { id: first } });
    await prisma.patient.update({ where: { id: patientId }, data: { liveIn: true } });
    const start = zonedTimeToUtc(day, '13:00', TZ);
    const end = zonedTimeToUtc(day, '13:45', TZ);
    const second = await prisma.visit.create({
      data: {
        agencyId, patientId, staffId: aideStaffId, visitType: 'personal_care', serviceCode: 'T1019', status: 'completed',
        scheduledDate: toDate(day)!, scheduledStart: toTime('13:00'), scheduledEnd: toTime('13:45'), actualStart: start, actualEnd: end,
      },
    });
    await prisma.evvRecord.create({
      data: {
        visitId: second.id, agencyId, staffId: aideStaffId, patientId, serviceType: 'personal_care', serviceDate: toDate(day)!,
        clockInMethod: 'gps', clockInTime: start, clockOutTime: end, clockInWithinGeofence: true, clockOutWithinGeofence: true, status: 'verified',
      },
    });
    await prisma.visitNote.create({ data: { visitId: second.id, staffId: aideStaffId, authorId: aideUserId, noteType: 'aide_activity', narrative: 'ok', status: 'submitted' } });

    const claim = (await http().post(claims).set(billing).send({ visitIds: [first, second.id] }).expect(201)).body.data.created[0];
    // 90 min → 1 hour (30 carried); +45 = 135 → 2 hours in all → the second line gets 1. Quarter hours would be 1.5 + 0.75.
    expect(claim.lines.map((l: { units: number; chargeAmount: number }) => [l.units, l.chargeAmount])).toEqual([
      [1, 20],
      [1, 20],
    ]);
    const file = (await http().get(`${claims}/${claim.id}/837`).set(billing).expect(200)).body.data.content;
    expect(file).toContain('SV1*HC:T1019:UB::::0800-0930*20*UN*1***1~');
    expect(file).toContain('SV1*HC:T1019:UB:76:::1300-1345*20*UN*1***1~'); // live-in, and the second same-day line
    await http().patch(`${payers}/${medicaidId}`).set(billing).send({ hourRounding: null }).expect(200);
  });
});
