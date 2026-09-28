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

describe.skipIf(!hasDb)('Open shifts and swaps (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  let supervisor: { id: string; auth: Auth };
  let office: { id: string; auth: Auth };
  let patientId: string;
  const http = () => request(app.getHttpServer());
  /** Far enough ahead that nothing has started. Each test uses its own day to avoid double-booking. */
  let dayOffset = 20;
  const nextDay = () => addDays(utcTodayString(), dayOffset++);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (
      await prisma.agency.create({ data: { name: `Shifts Test ${randomUUID()}`, timezone: 'UTC' } })
    ).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Shifts Other ${randomUUID()}` } }))
      .id;
    supervisor = await seedUser('supervisor');
    office = await seedUser('office_staff');
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Olive',
          lastName: `Openshift-${randomUUID().slice(0, 6)}`,
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          admissionDate: new Date('2025-01-01T00:00:00Z'),
          city: 'Springfield',
          zip: '62701',
        },
      })
    ).id;
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.visit.deleteMany({ where: { agencyId: id } }); // open shifts, swaps cascade
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
    const email = `shift-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: inAgency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Shay',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const accessToken = await loginForTests(http(), email, PASSWORD);
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  async function caregiver(role = 'home_health_aide', discipline = 'HHA') {
    const user = await seedUser(role);
    const staff = await prisma.staffProfile.create({
      data: { userId: user.id, agencyId, discipline },
    });
    return { ...user, staffId: staff.id };
  }

  async function seedVisit(
    date: string,
    staffId: string | null = null,
    start = '10:00',
    end = '11:00',
  ) {
    return (
      await prisma.visit.create({
        data: {
          agencyId,
          patientId,
          staffId,
          visitType: 'home_health_aide',
          scheduledDate: toDate(date)!,
          scheduledStart: toTime(start),
          scheduledEnd: toTime(end),
        },
      })
    ).id;
  }

  const offer = (visitId: string, extra: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/schedule/open-shifts')
      .set(office.auth)
      .send({ visitId, ...extra });
  const shiftUrl = (id: string, action = '') => `/api/v1/schedule/open-shifts/${id}${action}`;

  describe('open shifts', () => {
    it('offers, broadcasts to eligible caregivers only, and the first claim wins', { timeout: 90_000 }, async () => {
      const date = nextDay();
      const hha1 = await caregiver();
      const hha2 = await caregiver();
      const busy = await caregiver();
      await seedVisit(date, busy.staffId, '10:30', '11:30'); // overlaps: not eligible
      const rn = await caregiver('registered_nurse', 'RN'); // wrong discipline for an aide visit
      const visitId = await seedVisit(date);

      const created = await offer(visitId, { notes: 'Bring gloves' }).expect(201);
      const shift = created.body.data;
      expect(shift).toMatchObject({
        status: 'open',
        expired: false,
        area: { city: 'Springfield', zip: '62701' },
      });
      expect(shift.patient).toMatchObject({ id: patientId });
      expect(shift.visit.disciplines).toContain('HHA');
      await offer(visitId).expect(409); // one open offer per visit

      const sent = await http().post(shiftUrl(shift.id, '/broadcast')).set(office.auth).expect(200);
      expect(sent.body.data.notified).toBeGreaterThanOrEqual(2);
      const notified = await prisma.notification.findMany({
        where: { type: 'open_shift', data: { path: ['openShiftId'], equals: shift.id } },
        select: { userId: true, title: true, body: true },
      });
      const ids = notified.map((n) => n.userId);
      expect(ids).toEqual(expect.arrayContaining([hha1.id, hha2.id]));
      expect(ids).not.toContain(busy.id);
      expect(ids).not.toContain(rn.id);
      expect(notified[0]!.body).not.toContain('Olive'); // no PHI in the text

      // Caregivers see area and time, not the patient.
      const seen = await http().get('/api/v1/schedule/open-shifts').set(hha1.auth).expect(200);
      const mine = seen.body.data.find((s: { id: string }) => s.id === shift.id);
      expect(mine).toMatchObject({ patient: null, area: { city: 'Springfield' } });
      const rnSees = await http().get('/api/v1/schedule/open-shifts').set(rn.auth).expect(200);
      expect(rnSees.body.data.map((s: { id: string }) => s.id)).not.toContain(shift.id);

      await http().post(shiftUrl(shift.id, '/claim')).set(rn.auth).expect(403);
      const conflict = await http().post(shiftUrl(shift.id, '/claim')).set(busy.auth).expect(409);
      expect(conflict.body.error.code).toBe('SCHEDULE_CONFLICT');

      const claimed = await http().post(shiftUrl(shift.id, '/claim')).set(hha1.auth).expect(200);
      expect(claimed.body.data).toMatchObject({
        status: 'filled',
        filledBy: { staffId: hha1.staffId, how: 'claimed' },
      });
      await http().post(shiftUrl(shift.id, '/claim')).set(hha2.auth).expect(409);
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).staffId).toBe(
        hha1.staffId,
      );
      expect(
        await prisma.notification.count({
          where: { userId: office.id, title: 'Open shift claimed' },
        }),
      ).toBe(1);
      // The caregiver now sees the patient through the visit.
      await http().get(`/api/v1/schedule/visits/${visitId}`).set(hha1.auth).expect(200);
    });

    it('two simultaneous claims: exactly one wins', async () => {
      const a = await caregiver();
      const b = await caregiver();
      const shift = (await offer(await seedVisit(nextDay())).expect(201)).body.data;
      const results = await Promise.all([
        http().post(shiftUrl(shift.id, '/claim')).set(a.auth),
        http().post(shiftUrl(shift.id, '/claim')).set(b.auth),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('taking an assigned visit off a caregiver (call-out), assigning, expiry and cancelling', async () => {
      const date = nextDay();
      const sick = await caregiver();
      const visitId = await seedVisit(date, sick.staffId);
      const shift = (await offer(visitId).expect(201)).body.data;
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).staffId).toBeNull();
      expect(
        await prisma.notification.count({ where: { userId: sick.id, type: 'shift_unassigned' } }),
      ).toBe(1);

      const cover = await caregiver();
      await http()
        .post(shiftUrl(shift.id, '/assign'))
        .set(sick.auth)
        .send({ staffId: cover.staffId })
        .expect(403);
      const assigned = await http()
        .post(shiftUrl(shift.id, '/assign'))
        .set(office.auth)
        .send({ staffId: cover.staffId })
        .expect(200);
      expect(assigned.body.data).toMatchObject({
        status: 'filled',
        filledBy: { staffId: cover.staffId, how: 'assigned' },
        warnings: [],
      });
      await http().post(shiftUrl(shift.id, '/cancel')).set(office.auth).expect(409);

      const expiring = (
        await offer(await seedVisit(date, null, '14:00', '15:00'), {
          expiresAt: new Date(Date.now() + 1500).toISOString(),
        }).expect(201)
      ).body.data;
      await new Promise((r) => setTimeout(r, 2000));
      await http().post(shiftUrl(expiring.id, '/claim')).set(cover.auth).expect(409);
      expect(
        (await http().get(shiftUrl(expiring.id)).set(office.auth).expect(200)).body.data.expired,
      ).toBe(true);
      const withdrawn = await http()
        .post(shiftUrl(expiring.id, '/cancel'))
        .set(office.auth)
        .expect(200);
      expect(withdrawn.body.data.status).toBe('cancelled');

      await offer(await seedVisit(date, null, '16:00', '17:00'), {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }).expect(400);
      const past = await seedVisit(addDays(utcTodayString(), -1));
      await offer(past).expect(409); // already started
    });

    it('editing or cancelling the visit directly closes its offer', async () => {
      const date = nextDay();
      const visitId = await seedVisit(date);
      const shift = (await offer(visitId).expect(201)).body.data;
      const hha = await caregiver();
      await http()
        .patch(`/api/v1/schedule/visits/${visitId}`)
        .set(office.auth)
        .send({ staffId: hha.staffId })
        .expect(200);
      expect((await http().get(shiftUrl(shift.id)).set(office.auth)).body.data.status).toBe(
        'filled',
      );

      const other = await seedVisit(date, null, '15:00', '16:00');
      const second = (await offer(other).expect(201)).body.data;
      await http()
        .post(`/api/v1/schedule/visits/${other}/cancel`)
        .set(office.auth)
        .send({ reason: 'Patient in hospital' })
        .expect(200);
      expect((await http().get(shiftUrl(second.id)).set(office.auth)).body.data.status).toBe(
        'cancelled',
      );

      const outsider = await seedUser('agency_admin', otherAgencyId);
      await http().get(shiftUrl(second.id)).set(outsider.auth).expect(404);
    });
  });

  describe('shift swaps', () => {
    const swap = (who: Auth, body: Record<string, unknown>) =>
      http().post('/api/v1/schedule/shift-swaps').set(who).send(body);
    const decide = (who: Auth, id: string, body: Record<string, unknown>) =>
      http().patch(`/api/v1/schedule/shift-swaps/${id}`).set(who).send(body);

    it('to a named colleague: approval moves the visit (conflicts re-checked)', async () => {
      const date = nextDay();
      const from = await caregiver();
      const to = await caregiver();
      const visitId = await seedVisit(date, from.staffId);

      await swap(to.auth, { visitId, reason: 'x' }).expect(404); // not their visit
      await swap(from.auth, { visitId, targetStaffId: from.staffId, reason: 'x' }).expect(400);
      await swap(from.auth, { visitId, reason: '' }).expect(400);
      const created = await swap(from.auth, {
        visitId,
        targetStaffId: to.staffId,
        reason: 'Family event',
      }).expect(201);
      const req = created.body.data;
      expect(req).toMatchObject({
        status: 'pending',
        requesting: { id: from.staffId },
        target: { id: to.staffId },
      });
      await swap(from.auth, { visitId, reason: 'again' }).expect(409); // one pending per visit

      // The colleague sees it; an uninvolved caregiver doesn't.
      expect(
        (await http().get('/api/v1/schedule/shift-swaps').set(to.auth).expect(200)).body.data.map(
          (s: { id: string }) => s.id,
        ),
      ).toContain(req.id);
      const stranger = await caregiver();
      expect(
        (await http().get('/api/v1/schedule/shift-swaps').set(stranger.auth).expect(200)).body.data,
      ).toEqual([]);

      await decide(office.auth, req.id, { status: 'approved' }).expect(403); // no visits:approve
      await decide(from.auth, req.id, { status: 'approved' }).expect(403);

      // The colleague picks up a clashing visit meanwhile: approval is blocked unless overridden.
      const clash = await seedVisit(date, to.staffId, '10:15', '10:45');
      const blocked = await decide(supervisor.auth, req.id, { status: 'approved' }).expect(409);
      expect(blocked.body.error.code).toBe('SCHEDULE_CONFLICT');
      await prisma.visit.update({ where: { id: clash }, data: { status: 'cancelled' } });

      const approved = await decide(supervisor.auth, req.id, {
        status: 'approved',
        note: 'OK',
      }).expect(200);
      expect(approved.body.data).toMatchObject({
        status: 'approved',
        decisionNote: 'OK',
        decidedById: supervisor.id,
      });
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).staffId).toBe(
        to.staffId,
      );
      expect(
        await prisma.notification.count({ where: { userId: to.id, type: 'shift_assigned' } }),
      ).toBe(1);
      expect(
        await prisma.notification.count({ where: { userId: from.id, type: 'swap_decided' } }),
      ).toBe(1);
      await decide(supervisor.auth, req.id, { status: 'denied' }).expect(409);
    });

    it('back to the pool: approval turns the visit into an open shift; deny and withdraw', async () => {
      const date = nextDay();
      const from = await caregiver();
      const visitId = await seedVisit(date, from.staffId);
      const req = (await swap(from.auth, { visitId, reason: 'Car trouble' }).expect(201)).body.data;
      expect(req.target).toBeNull();
      await decide(supervisor.auth, req.id, { status: 'approved' }).expect(200);
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).staffId).toBeNull();
      expect(await prisma.openShift.count({ where: { visitId, status: 'open' } })).toBe(1);

      const second = await seedVisit(date, from.staffId, '13:00', '14:00');
      const denied = (await swap(from.auth, { visitId: second, reason: 'Tired' }).expect(201)).body
        .data;
      expect(
        (
          await decide(supervisor.auth, denied.id, { status: 'denied', note: 'No cover' }).expect(
            200,
          )
        ).body.data.status,
      ).toBe('denied');
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: second } })).staffId).toBe(
        from.staffId,
      );

      const withdrawn = (await swap(from.auth, { visitId: second, reason: 'Again' }).expect(201))
        .body.data;
      await http()
        .post(`/api/v1/schedule/shift-swaps/${withdrawn.id}/cancel`)
        .set(supervisor.auth)
        .expect(403);
      expect(
        (
          await http()
            .post(`/api/v1/schedule/shift-swaps/${withdrawn.id}/cancel`)
            .set(from.auth)
            .expect(200)
        ).body.data.status,
      ).toBe('cancelled');
    });

    it('a direct reassignment withdraws a pending request', async () => {
      const date = nextDay();
      const from = await caregiver();
      const other = await caregiver();
      const visitId = await seedVisit(date, from.staffId);
      const req = (await swap(from.auth, { visitId, reason: 'x' }).expect(201)).body.data;
      await http()
        .patch(`/api/v1/schedule/visits/${visitId}`)
        .set(office.auth)
        .send({ staffId: other.staffId })
        .expect(200);
      const after = await http()
        .get('/api/v1/schedule/shift-swaps?status=cancelled')
        .set(from.auth)
        .expect(200);
      expect(after.body.data.map((s: { id: string }) => s.id)).toContain(req.id);
    });
  });
});
