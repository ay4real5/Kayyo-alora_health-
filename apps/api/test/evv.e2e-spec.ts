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

/** The fake patient's home (Springfield, IL). ~0.009° of latitude is ~1 km. */
const HOME = { latitude: 39.7817, longitude: -89.6501 };
const NEARBY = { latitude: 39.7818, longitude: -89.6502 }; // ~14 m
const FAR = { latitude: 39.7907, longitude: -89.6501 }; // ~1 km

describe.skipIf(!hasDb)('EVV (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let chicagoAgencyId: string;
  let otherAgencyId: string;
  let supervisor: { id: string; auth: Auth };
  let admin: { id: string; auth: Auth };
  let office: Auth;
  let patientId: string;
  const http = () => request(app.getHttpServer());
  /**
   * Visits are put on yesterday's (UTC) date, 10:00–11:00, in a UTC agency: clock events are then fixed instants
   * that are always in the past but within the 72-hour offline-sync limit.
   */
  const day = addDays(utcTodayString(), -1);
  const at = (hhmm: string, date = day) => `${date}T${hhmm}:00Z`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (
      await prisma.agency.create({ data: { name: `EVV Test ${randomUUID()}`, timezone: 'UTC' } })
    ).id;
    chicagoAgencyId = (
      await prisma.agency.create({
        data: { name: `EVV Chicago ${randomUUID()}`, timezone: 'America/Chicago' },
      })
    ).id;
    otherAgencyId = (
      await prisma.agency.create({ data: { name: `EVV Other ${randomUUID()}`, timezone: 'UTC' } })
    ).id;
    supervisor = await seedUser('supervisor');
    admin = await seedUser('agency_admin');
    office = (await seedUser('office_staff')).auth;
    patientId = await seedPatient();
  });

  afterAll(async () => {
    for (const id of [agencyId, chicagoAgencyId, otherAgencyId]) {
      await prisma.evvRecord.deleteMany({ where: { agencyId: id } });
      await prisma.visit.deleteMany({ where: { agencyId: id } });
      await prisma.patient.deleteMany({ where: { agencyId: id } });
      await prisma.notification.deleteMany({ where: { agencyId: id } });
      await prisma.auditLog.deleteMany({ where: { agencyId: id } });
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(roleName: string, inAgency = agencyId) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `evv-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: inAgency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Eve',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const accessToken = await loginForTests(http(), email, PASSWORD);
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  async function seedPatient(inAgency = agencyId, location: typeof HOME | null = HOME) {
    const p = await prisma.patient.create({
      data: {
        agencyId: inAgency,
        firstName: 'Pat',
        lastName: `Verified-${randomUUID().slice(0, 6)}`,
        dateOfBirth: new Date('1940-01-01T00:00:00Z'),
        status: 'active',
        admissionDate: new Date('2025-01-01T00:00:00Z'),
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      },
    });
    return p.id;
  }

  async function caregiver(inAgency = agencyId) {
    const user = await seedUser('home_health_aide', inAgency);
    const staff = await prisma.staffProfile.create({
      data: { userId: user.id, agencyId: inAgency, discipline: 'HHA' },
    });
    return { ...user, staffId: staff.id };
  }

  async function seedVisit(
    staffId: string,
    opts: { date?: string; start?: string; end?: string; patient?: string; agency?: string } = {},
  ) {
    const v = await prisma.visit.create({
      data: {
        agencyId: opts.agency ?? agencyId,
        patientId: opts.patient ?? patientId,
        staffId,
        visitType: 'home_health_aide',
        scheduledDate: toDate(opts.date ?? day)!,
        scheduledStart: toTime(opts.start ?? '10:00'),
        scheduledEnd: toTime(opts.end ?? '11:00'),
      },
    });
    return v.id;
  }

  const clockIn = (
    who: Auth,
    visitId: string,
    time: string,
    where = NEARBY,
    extra: Record<string, unknown> = {},
  ) =>
    http()
      .post('/api/v1/evv/clock-in')
      .set(who)
      .send({
        visitId,
        ...where,
        accuracyMeters: 8,
        timestamp: time,
        deviceId: 'test-device',
        ...extra,
      });
  const clockOut = (who: Auth, visitId: string, time: string, where = NEARBY) =>
    http()
      .post('/api/v1/evv/clock-out')
      .set(who)
      .send({ visitId, ...where, timestamp: time });

  /** A caregiver with one completed visit, clocked in/out as given. Returns the EVV record id. */
  async function completedVisit(inTime = at('10:02'), outTime = at('10:58'), where = NEARBY) {
    const cg = await caregiver();
    const visitId = await seedVisit(cg.staffId);
    const id = (await clockIn(cg.auth, visitId, inTime, where).expect(200)).body.data.id as string;
    await clockOut(cg.auth, visitId, outTime, where).expect(200);
    return { id, visitId, cg };
  }

  describe('clock in and out', () => {
    it('records a clean visit: in_progress, then completed, and moves the visit along', async () => {
      const cg = await caregiver();
      const visitId = await seedVisit(cg.staffId);

      const inRes = await clockIn(cg.auth, visitId, at('09:55')).expect(200);
      expect(inRes.body.data).toMatchObject({
        visitId,
        status: 'in_progress',
        flags: [],
        withinGeofence: true,
      });
      expect(inRes.body.data.distanceMeters).toBeLessThan(30);
      const visit = await prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
      expect(visit.status).toBe('in_progress');
      expect(visit.actualStart?.toISOString()).toBe(new Date(at('09:55')).toISOString());
      expect(
        await prisma.auditLog.count({
          where: { action: 'EVV_CLOCK_IN', resourceId: inRes.body.data.id, userId: cg.id },
        }),
      ).toBe(1);

      const outRes = await clockOut(cg.auth, visitId, at('11:03')).expect(200);
      expect(outRes.body.data).toMatchObject({
        id: inRes.body.data.id,
        status: 'completed',
        flags: [],
      });
      const done = await prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
      expect(done.status).toBe('completed');
      expect(done.actualEnd?.toISOString()).toBe(new Date(at('11:03')).toISOString());

      const record = await prisma.evvRecord.findUniqueOrThrow({ where: { visitId } });
      expect(record).toMatchObject({
        clockInMethod: 'gps',
        clockOutMethod: 'gps',
        clockInAccuracyMeters: 8,
        deviceId: 'test-device',
      });
    });

    it('flags (but never refuses) being away from the home, off-schedule, or very short', async () => {
      const cg = await caregiver();
      const visitId = await seedVisit(cg.staffId);
      const inRes = await clockIn(cg.auth, visitId, at('07:30'), FAR).expect(200);
      expect(inRes.body.data.flags).toEqual(['outside_geofence_in', 'outside_time_window_in']);
      expect(inRes.body.data.withinGeofence).toBe(false);
      expect(inRes.body.data.distanceMeters).toBeGreaterThan(900);

      const outRes = await clockOut(cg.auth, visitId, at('07:40'), FAR).expect(200);
      expect(outRes.body.data.status).toBe('exception');
      expect(outRes.body.data.flags).toEqual(
        expect.arrayContaining([
          'outside_geofence_in',
          'outside_time_window_in',
          'outside_geofence_out',
          'very_short_visit',
        ]),
      );
    });

    it('flags a late clock-out and a patient with no map location', async () => {
      const cg = await caregiver();
      const unmapped = await seedPatient(agencyId, null);
      const visitId = await seedVisit(cg.staffId, { patient: unmapped });
      const inRes = await clockIn(cg.auth, visitId, at('10:00')).expect(200);
      expect(inRes.body.data).toMatchObject({
        flags: ['no_patient_location'],
        withinGeofence: null,
        distanceMeters: null,
      });
      const outRes = await clockOut(cg.auth, visitId, at('13:30')).expect(200);
      expect(outRes.body.data.flags).toEqual(['no_patient_location', 'outside_time_window_out']);
      expect(outRes.body.data.status).toBe('exception');
    });

    it("uses the agency's timezone for the scheduled window", async () => {
      const cg = await caregiver(chicagoAgencyId);
      const chicagoPatient = await seedPatient(chicagoAgencyId);
      const visitId = await seedVisit(cg.staffId, {
        agency: chicagoAgencyId,
        patient: chicagoPatient,
      });
      // 10:00 in Chicago is 15:00Z (CDT) or 16:00Z (CST): 15:30Z is on time; in a UTC agency it would be 4½h late.
      const res = await clockIn(cg.auth, visitId, at('15:30')).expect(200);
      expect(res.body.data.flags).toEqual([]);
    });

    it("refuses someone else's visit, repeats, and implausible times", async () => {
      const cg = await caregiver();
      const other = await caregiver();
      const visitId = await seedVisit(cg.staffId);

      await clockIn(other.auth, visitId, at('10:00')).expect(404);
      await clockIn(supervisor.auth, visitId, at('10:00')).expect(404); // not assigned to them
      await clockIn(cg.auth, visitId, new Date(Date.now() + 60 * 60_000).toISOString()).expect(400); // future
      await clockIn(cg.auth, visitId, new Date(Date.now() - 80 * 3_600_000).toISOString()).expect(
        400,
      ); // > 72h old
      await clockIn(cg.auth, visitId, new Date().toISOString()).expect(400); // > 12h from the visit
      await clockIn(cg.auth, visitId, at('10:00'), { latitude: 91, longitude: 0 }).expect(400);
      await clockOut(cg.auth, visitId, at('11:00')).expect(409); // not clocked in

      await clockIn(cg.auth, visitId, at('10:00')).expect(200);
      await clockIn(cg.auth, visitId, at('10:01')).expect(409);
      await clockOut(cg.auth, visitId, at('09:59')).expect(400); // before clock-in

      // One visit at a time.
      const second = await seedVisit(cg.staffId, { start: '11:00', end: '12:00' });
      await clockIn(cg.auth, second, at('11:00')).expect(409);
      await clockOut(cg.auth, visitId, at('11:00')).expect(200);
      await clockOut(cg.auth, visitId, at('11:01')).expect(409); // already out
      await clockIn(cg.auth, second, at('11:02')).expect(200);

      // A cancelled visit can't be clocked into.
      const cancelled = await seedVisit(cg.staffId, { start: '14:00', end: '15:00' });
      await prisma.visit.update({ where: { id: cancelled }, data: { status: 'cancelled' } });
      await clockIn(cg.auth, cancelled, at('14:00')).expect(409);
    });
  });

  describe('review', () => {
    it('lists and shows records to evv:read roles only, within the agency', async () => {
      const { id, cg } = await completedVisit(at('10:00'), at('10:05'), FAR); // exception
      const list = await http()
        .get(`/api/v1/evv/records?needsReview=true&from=${day}&to=${day}`)
        .set(office)
        .expect(200);
      expect(list.body.data.map((r: { id: string }) => r.id)).toContain(id);
      expect(
        list.body.data.every(
          (r: { status: string }) => r.status === 'exception' || r.status === 'completed',
        ),
      ).toBe(true);

      const one = await http().get(`/api/v1/evv/records/${id}`).set(supervisor.auth).expect(200);
      expect(one.body.data).toMatchObject({
        id,
        status: 'exception',
        serviceDate: day,
        visit: { scheduledStart: '10:00', scheduledEnd: '11:00' },
        staff: { id: cg.staffId },
        clockIn: { method: 'gps', withinGeofence: false, latitude: FAR.latitude },
        clockOut: { method: 'gps' },
        exceptions: [],
      });

      await http().get('/api/v1/evv/records').set(cg.auth).expect(403); // caregivers don't have evv:read
      const outsider = await seedUser('agency_admin', otherAgencyId);
      await http().get(`/api/v1/evv/records/${id}`).set(outsider.auth).expect(404);
    });

    it('verifies or rejects finished records once, never while clocked in', async () => {
      const cg = await caregiver();
      const visitId = await seedVisit(cg.staffId);
      const id = (await clockIn(cg.auth, visitId, at('10:00')).expect(200)).body.data.id;
      await http()
        .post(`/api/v1/evv/records/${id}/verify`)
        .set(supervisor.auth)
        .send({})
        .expect(409);
      await clockOut(cg.auth, visitId, at('11:00')).expect(200);

      await http().post(`/api/v1/evv/records/${id}/verify`).set(office).send({}).expect(403); // no evv:approve
      const res = await http()
        .post(`/api/v1/evv/records/${id}/verify`)
        .set(supervisor.auth)
        .send({ note: 'Looks right' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'verified',
        verifiedById: supervisor.id,
        verificationNote: 'Looks right',
      });
      await http()
        .post(`/api/v1/evv/records/${id}/verify`)
        .set(supervisor.auth)
        .send({})
        .expect(409);
      expect(
        await prisma.auditLog.count({
          where: { action: 'VERIFY_EVV', resourceId: id, userId: supervisor.id },
        }),
      ).toBe(3); // refused attempts are audited too

      const other = await completedVisit(at('10:00'), at('10:05'), FAR);
      await http()
        .post(`/api/v1/evv/records/${other.id}/reject`)
        .set(supervisor.auth)
        .send({ note: ' ' })
        .expect(400);
      const rejected = await http()
        .post(`/api/v1/evv/records/${other.id}/reject`)
        .set(supervisor.auth)
        .send({ note: 'Caregiver was not at the home' })
        .expect(200);
      expect(rejected.body.data.status).toBe('rejected');
      await http()
        .post(`/api/v1/evv/records/${other.id}/exception`)
        .set(supervisor.auth)
        .send({ exceptionType: 'clock_in_time', correctedValue: at('10:01'), reason: 'Too late' })
        .expect(409);
    });
  });

  describe('corrections', () => {
    it('needs a second person to approve, then applies the time and flags it', async () => {
      const cg = await caregiver();
      const visitId = await seedVisit(cg.staffId);
      const id = (await clockIn(cg.auth, visitId, at('10:00')).expect(200)).body.data.id;
      // Forgot to clock out: the office files the time the patient confirmed.
      const file = (body: Record<string, unknown>) =>
        http().post(`/api/v1/evv/records/${id}/exception`).set(supervisor.auth).send(body);
      await file({
        exceptionType: 'clock_out_time',
        correctedValue: at('09:00'),
        reason: 'x',
      }).expect(400); // before in
      await file({
        exceptionType: 'clock_out_time',
        correctedValue: at('11:05'),
        reason: '',
      }).expect(400);
      await file({ exceptionType: 'lunch', correctedValue: at('11:05'), reason: 'x' }).expect(400);
      const filed = await file({
        exceptionType: 'clock_out_time',
        correctedValue: at('11:05'),
        reason: 'Phone died; patient confirmed the caregiver left at 11:05',
      }).expect(201);
      const exception = filed.body.data.exceptions[0];
      expect(exception).toMatchObject({
        status: 'pending',
        originalValue: null,
        requestedById: supervisor.id,
      });
      await file({
        exceptionType: 'clock_out_time',
        correctedValue: at('11:06'),
        reason: 'again',
      }).expect(409);

      const decide = (who: Auth, status: string) =>
        http().patch(`/api/v1/evv/exceptions/${exception.id}`).set(who).send({ status });
      await decide(supervisor.auth, 'approved').expect(403); // own request
      await decide(office, 'approved').expect(403); // no evv:approve
      await decide(admin.auth, 'maybe').expect(400);
      const approved = await decide(admin.auth, 'approved').expect(200);
      expect(approved.body.data).toMatchObject({
        status: 'exception',
        flags: ['manual_correction'],
        clockOut: { method: 'manual', time: new Date(at('11:05')).toISOString() },
        exceptions: [{ status: 'approved', decidedById: admin.id }],
      });
      const visit = await prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
      expect(visit.status).toBe('completed');
      expect(visit.actualEnd?.toISOString()).toBe(new Date(at('11:05')).toISOString());
      await decide(admin.auth, 'denied').expect(409); // already decided

      const note = await prisma.notification.findFirst({
        where: { userId: supervisor.id, type: 'evv_correction_decided' },
      });
      expect(note?.title).toBe('EVV correction approved');
      await http().post(`/api/v1/evv/records/${id}/verify`).set(admin.auth).send({}).expect(200);
    });

    it('a denied correction changes nothing, and pending ones block verification', async () => {
      const { id } = await completedVisit(at('10:00'), at('11:00'));
      const filed = await http()
        .post(`/api/v1/evv/records/${id}/exception`)
        .set(supervisor.auth)
        .send({
          exceptionType: 'clock_in_time',
          correctedValue: at('09:50'),
          reason: 'Arrived earlier',
        })
        .expect(201);
      const exception = filed.body.data.exceptions[0];
      expect(exception.originalValue).toBe(new Date(at('10:00')).toISOString());
      await http().post(`/api/v1/evv/records/${id}/verify`).set(admin.auth).send({}).expect(409);

      const denied = await http()
        .patch(`/api/v1/evv/exceptions/${exception.id}`)
        .set(admin.auth)
        .send({ status: 'denied' })
        .expect(200);
      expect(denied.body.data).toMatchObject({
        status: 'completed',
        flags: [],
        clockIn: { time: new Date(at('10:00')).toISOString() },
      });
      await http().post(`/api/v1/evv/records/${id}/verify`).set(admin.auth).send({}).expect(200);
    });

    it("can't decide another agency's correction", async () => {
      const { id } = await completedVisit();
      const filed = await http()
        .post(`/api/v1/evv/records/${id}/exception`)
        .set(supervisor.auth)
        .send({ exceptionType: 'clock_in_time', correctedValue: at('10:00'), reason: 'Adjust' })
        .expect(201);
      const outsider = await seedUser('agency_admin', otherAgencyId);
      await http()
        .patch(`/api/v1/evv/exceptions/${filed.body.data.exceptions[0].id}`)
        .set(outsider.auth)
        .send({ status: 'approved' })
        .expect(404);
    });
  });
});
