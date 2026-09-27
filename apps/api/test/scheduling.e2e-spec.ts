import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, todayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Scheduling (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  let office: Auth;
  let supervisor: Auth;
  let patientId: string;
  const http = () => request(app.getHttpServer());
  /** A date far enough ahead that nothing is "in the past", with a known weekday offset. */
  const base = addDays(todayString(), 40);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Scheduling Test ${randomUUID()}` } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Scheduling Other ${randomUUID()}` } })).id;
    office = (await seedUser('office_staff')).auth;
    supervisor = (await seedUser('supervisor')).auth;
    patientId = await seedPatient();
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.visit.deleteMany({ where: { agencyId: id } });
      await prisma.patient.deleteMany({ where: { agencyId: id } });
      await prisma.auditLog.deleteMany({ where: { agencyId: id } });
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(roleName: string, inAgency = agencyId) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `sch-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: inAgency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Sam',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const { accessToken } = (await http().post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.data;
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  async function seedPatient(inAgency = agencyId, status = 'active') {
    const p = await prisma.patient.create({
      data: {
        agencyId: inAgency,
        firstName: 'Pat',
        lastName: `Scheduled-${randomUUID().slice(0, 6)}`,
        dateOfBirth: new Date('1940-01-01T00:00:00Z'),
        status,
        admissionDate: new Date('2025-01-01T00:00:00Z'),
      },
    });
    return p.id;
  }

  async function caregiver(discipline = 'HHA') {
    const user = await seedUser('home_health_aide');
    const staff = await prisma.staffProfile.create({ data: { userId: user.id, agencyId, discipline } });
    return { ...user, staffId: staff.id };
  }

  const book = (who: Auth, body: Record<string, unknown>) => http().post('/api/v1/schedule/visits').set(who).send(body);
  const visit = (staffId: string | undefined, date: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    patientId,
    staffId,
    visitType: 'home_health_aide',
    scheduledDate: date,
    scheduledStart: start,
    scheduledEnd: end,
    ...extra,
  });

  describe('booking', () => {
    it('books a visit and returns it with no warnings when everything fits', async () => {
      const cg = await caregiver();
      const res = await book(office, visit(cg.staffId, base, '09:00', '10:00', { serviceCode: 'G0156' })).expect(201);
      expect(res.body.data).toMatchObject({
        status: 'scheduled',
        scheduledDate: base,
        scheduledStart: '09:00',
        scheduledEnd: '10:00',
        visitType: 'home_health_aide',
        staff: { id: cg.staffId, discipline: 'HHA' },
        patient: { id: patientId },
        warnings: [],
      });
      expect(await prisma.auditLog.count({ where: { action: 'SCHEDULE_VISIT', resourceId: res.body.data.id } })).toBe(1);
    });

    it('validates times, visit type and references', async () => {
      const cg = await caregiver();
      await book(office, visit(cg.staffId, base, '10:00', '10:00')).expect(400);
      await book(office, visit(cg.staffId, base, '9:00', '10:00')).expect(400);
      await book(office, visit(cg.staffId, base, '09:00', '10:00', { visitType: 'massage' })).expect(400);
      const foreignPatient = await seedPatient(otherAgencyId);
      await book(office, visit(cg.staffId, base, '09:00', '10:00', { patientId: foreignPatient })).expect(400);
    });
  });

  describe('conflicts', () => {
    it('blocks double-booking but allows back-to-back visits', async () => {
      const cg = await caregiver();
      const first = (await book(office, visit(cg.staffId, base, '09:00', '10:00')).expect(201)).body.data;

      const clash = await book(office, visit(cg.staffId, base, '09:30', '10:30')).expect(409);
      expect(clash.body.error.code).toBe('SCHEDULE_CONFLICT');
      expect(clash.body.error.details).toEqual([
        expect.objectContaining({ code: 'staff_double_booked', severity: 'blocking', visitIds: [first.id] }),
      ]);
      await book(office, visit(cg.staffId, base, '10:00', '11:00')).expect(201); // starts when the other ends
    });

    it('lets only visits:approve holders override, and audits it', async () => {
      const cg = await caregiver();
      await book(office, visit(cg.staffId, base, '13:00', '14:00')).expect(201);
      await book(office, visit(cg.staffId, base, '13:00', '14:00', { override: true })).expect(403);
      await book(supervisor, visit(cg.staffId, base, '13:00', '14:00', { override: true })).expect(201);
      expect(await prisma.auditLog.count({ where: { agencyId, action: 'OVERRIDE_SCHEDULE_CONFLICT' } })).toBeGreaterThan(0);
    });

    it('blocks approved time off and warns about pending time off', async () => {
      const cg = await caregiver();
      const day1 = addDays(base, 1);
      const day2 = addDays(base, 2);
      await prisma.staffTimeOff.createMany({
        data: [
          { staffProfileId: cg.staffId, startDate: new Date(`${day1}T00:00:00Z`), endDate: new Date(`${day1}T00:00:00Z`), type: 'vacation', status: 'approved' },
          { staffProfileId: cg.staffId, startDate: new Date(`${day2}T00:00:00Z`), endDate: new Date(`${day2}T00:00:00Z`), type: 'personal', status: 'pending' },
        ],
      });
      const blocked = await book(office, visit(cg.staffId, day1, '09:00', '10:00')).expect(409);
      expect(blocked.body.error.details[0].code).toBe('staff_time_off');
      const warned = await book(office, visit(cg.staffId, day2, '09:00', '10:00')).expect(201);
      expect(warned.body.data.warnings.map((w: { code: string }) => w.code)).toEqual(['staff_time_off_pending']);
    });

    it('blocks inactive caregivers and patients who are not active', async () => {
      const cg = await caregiver();
      await prisma.staffProfile.update({ where: { id: cg.staffId }, data: { isActive: false } });
      const inactive = await book(office, visit(cg.staffId, base, '15:00', '16:00')).expect(409);
      expect(inactive.body.error.details.map((c: { code: string }) => c.code)).toContain('staff_inactive');

      const discharged = await seedPatient(agencyId, 'discharged');
      const res = await book(office, visit(undefined, base, '15:00', '16:00', { patientId: discharged })).expect(409);
      expect(res.body.error.details[0].code).toBe('patient_not_active');
    });

    it('warns (without blocking) about availability, discipline, credentials and past dates', async () => {
      const cg = await caregiver();
      const dow = new Date(`${base}T00:00:00Z`).getUTCDay();
      await prisma.staffAvailability.create({
        data: { staffProfileId: cg.staffId, dayOfWeek: dow, startTime: new Date('1970-01-01T08:00:00Z'), endTime: new Date('1970-01-01T12:00:00Z') },
      });
      await prisma.staffCredential.create({
        data: { staffProfileId: cg.staffId, credentialType: 'cpr', credentialName: 'CPR', expiryDate: new Date(`${addDays(base, -1)}T00:00:00Z`) },
      });

      const res = await book(office, visit(cg.staffId, base, '14:00', '15:00', { visitType: 'skilled_nursing' })).expect(201);
      expect(res.body.data.warnings.map((w: { code: string }) => w.code).sort()).toEqual([
        'discipline_mismatch',
        'outside_availability',
        'staff_credentials_expired',
      ]);

      const past = await book(office, visit(undefined, addDays(todayString(), -3), '09:00', '10:00')).expect(201);
      expect(past.body.data.warnings.map((w: { code: string }) => w.code)).toEqual(['in_the_past']);
    });

    it('pre-checks without saving anything', async () => {
      const cg = await caregiver();
      await book(office, visit(cg.staffId, base, '16:00', '17:00')).expect(201);
      const before = await prisma.visit.count({ where: { agencyId } });
      const q = new URLSearchParams({
        patientId,
        staffId: cg.staffId,
        visitType: 'home_health_aide',
        scheduledDate: base,
        scheduledStart: '16:30',
        scheduledEnd: '17:30',
      });
      const res = await http().get(`/api/v1/schedule/conflicts?${q}`).set(office).expect(200);
      expect(res.body.data.map((c: { code: string }) => c.code)).toEqual(['staff_double_booked']);
      expect(await prisma.visit.count({ where: { agencyId } })).toBe(before);
    });
  });

  describe('changing and cancelling', () => {
    it('reschedules (ignoring itself), reassigns, unassigns, and re-checks conflicts', async () => {
      const a = await caregiver();
      const b = await caregiver();
      const day = addDays(base, 3);
      const v = (await book(office, visit(a.staffId, day, '09:00', '10:00')).expect(201)).body.data;
      await book(office, visit(b.staffId, day, '11:00', '12:00')).expect(201);

      // Moving within its own slot is not a clash with itself.
      await http().patch(`/api/v1/schedule/visits/${v.id}`).set(office).send({ scheduledEnd: '10:30' }).expect(200);
      // Reassigning onto b's busy time is.
      await http()
        .patch(`/api/v1/schedule/visits/${v.id}`)
        .set(office)
        .send({ staffId: b.staffId, scheduledStart: '11:30', scheduledEnd: '12:30' })
        .expect(409);
      const moved = await http().patch(`/api/v1/schedule/visits/${v.id}`).set(office).send({ staffId: b.staffId }).expect(200);
      expect(moved.body.data.staff.id).toBe(b.staffId);
      const unassigned = await http().patch(`/api/v1/schedule/visits/${v.id}`).set(office).send({ staffId: null }).expect(200);
      expect(unassigned.body.data.staff).toBeNull();

      const open = await http().get(`/api/v1/schedule/visits?unassigned=true&from=${day}&to=${day}`).set(office).expect(200);
      expect(open.body.data.map((x: { id: string }) => x.id)).toContain(v.id);
    });

    it('cancels with a reason, frees the slot, and freezes the visit', async () => {
      const cg = await caregiver();
      const day = addDays(base, 4);
      const v = (await book(office, visit(cg.staffId, day, '09:00', '10:00')).expect(201)).body.data;

      await http().post(`/api/v1/schedule/visits/${v.id}/cancel`).set(office).send({}).expect(400);
      const cancelled = await http()
        .post(`/api/v1/schedule/visits/${v.id}/cancel`)
        .set(office)
        .send({ reason: 'Patient hospitalised' })
        .expect(200);
      expect(cancelled.body.data).toMatchObject({ status: 'cancelled', cancelReason: 'Patient hospitalised' });

      await book(office, visit(cg.staffId, day, '09:00', '10:00')).expect(201); // slot is free again
      await http().patch(`/api/v1/schedule/visits/${v.id}`).set(office).send({ notes: 'x' }).expect(409);
      await http().post(`/api/v1/schedule/visits/${v.id}/cancel`).set(office).send({ reason: 'again' }).expect(409);
    });
  });

  describe('calendar and access', () => {
    it('returns every day in the range with its visits, excluding cancelled by default', async () => {
      const cg = await caregiver();
      const from = addDays(base, 10);
      const kept = (await book(office, visit(cg.staffId, addDays(from, 1), '09:00', '10:00')).expect(201)).body.data;
      const dropped = (await book(office, visit(cg.staffId, addDays(from, 1), '11:00', '12:00')).expect(201)).body.data;
      await http().post(`/api/v1/schedule/visits/${dropped.id}/cancel`).set(office).send({ reason: 'test' });

      const res = await http()
        .get(`/api/v1/schedule/calendar?from=${from}&to=${addDays(from, 6)}&staffId=${cg.staffId}`)
        .set(office)
        .expect(200);
      expect(res.body.data).toHaveLength(7);
      expect(res.body.data[1]).toMatchObject({ date: addDays(from, 1) });
      expect(res.body.data[1].visits.map((x: { id: string }) => x.id)).toEqual([kept.id]);

      await http().get(`/api/v1/schedule/calendar?from=${from}&to=${addDays(from, 70)}`).set(office).expect(400);
    });

    it('shows caregivers only their own visits; cancelled visits stop granting patient access', async () => {
      const cg = await caregiver();
      const other = await caregiver();
      const day = addDays(base, 20);
      const mine = (await book(office, visit(cg.staffId, day, '09:00', '10:00')).expect(201)).body.data;
      const theirs = (await book(office, visit(other.staffId, day, '09:00', '10:00')).expect(201)).body.data;

      const list = await http().get(`/api/v1/schedule/visits?from=${day}&to=${day}&limit=100`).set(cg.auth).expect(200);
      expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([mine.id]);
      await http().get(`/api/v1/schedule/visits/${theirs.id}`).set(cg.auth).expect(404);
      await book(cg.auth, visit(cg.staffId, day, '12:00', '13:00')).expect(403); // aides can't schedule

      // The caregiver can open the patient through the visit…
      const privatePatient = await seedPatient();
      const pv = (await book(office, visit(cg.staffId, day, '14:00', '15:00', { patientId: privatePatient })).expect(201)).body.data;
      await http().get(`/api/v1/patients/${privatePatient}`).set(cg.auth).expect(200);
      // …until that visit is cancelled.
      await http().post(`/api/v1/schedule/visits/${pv.id}/cancel`).set(office).send({ reason: 'test' }).expect(200);
      await http().get(`/api/v1/patients/${privatePatient}`).set(cg.auth).expect(404);
    });
  });
});
