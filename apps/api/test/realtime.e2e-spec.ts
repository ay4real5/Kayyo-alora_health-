import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { VisitMonitorService } from '../src/modules/jobs/visit-monitor.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { RecurringService } from '../src/modules/scheduling/recurring.service.js';
import { setupApp } from '../src/setup-app.js';

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
const HOME = { latitude: 39.7817, longitude: -89.6501 };

describe.skipIf(!hasDb)('Real-time and background jobs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let agencyId: string;
  let patientId: string;
  let supervisor: { id: string; token: string };
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const today = utcTodayString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.listen(0, '127.0.0.1'); // sockets need a real port
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    agencyId = (
      await prisma.agency.create({
        data: { name: `Realtime Test ${randomUUID()}`, timezone: 'UTC' },
      })
    ).id;
    supervisor = await seedUser('supervisor');
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Rae',
          lastName: `Live-${randomUUID().slice(0, 6)}`,
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          admissionDate: new Date('2025-01-01T00:00:00Z'),
          ...HOME,
        },
      })
    ).id;
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.recurrenceRule.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `rt-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Rio',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const { accessToken } = (
      await http().post('/api/v1/auth/login').send({ email, password: PASSWORD })
    ).body.data;
    return { id: user.id, token: accessToken as string };
  }

  async function caregiver() {
    const user = await seedUser('home_health_aide');
    const staff = await prisma.staffProfile.create({
      data: { userId: user.id, agencyId, discipline: 'HHA' },
    });
    return { ...user, staffId: staff.id };
  }

  async function seedVisit(staffId: string | null, start: string, end: string, date = today) {
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

  /** Connects and resolves once the server has accepted (or rejected) the socket. */
  function connect(
    namespace: string,
    token?: string,
  ): Promise<{ socket: Socket; refused?: string }> {
    const socket = io(`${baseUrl}${namespace}`, {
      path: '/api/v1/socket.io',
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolve) => {
      // Authentication happens before the connection is accepted; room joins right after — give them a moment.
      socket.on('connect', () => setTimeout(() => resolve({ socket }), 200));
      socket.on('connect_error', (e: Error) => resolve({ socket, refused: e.message }));
    });
  }

  const next = <T>(socket: Socket, event: string, timeoutMs = 5000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${event} within ${timeoutMs}ms`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  describe('sockets', () => {
    it('refuses connections without a valid token, and the live monitor without evv:read', async () => {
      expect((await connect('/notifications')).refused).toBe('unauthorized');
      expect((await connect('/notifications', 'not-a-jwt')).refused).toBe('unauthorized');
      const hha = await caregiver();
      expect((await connect('/live-monitor', hha.token)).refused).toBe('forbidden');
      expect((await connect('/live-monitor', supervisor.token)).refused).toBeUndefined();
    });

    it('delivers a new notification only to its recipient', async () => {
      const a = await caregiver();
      const b = await caregiver();
      const sa = (await connect('/notifications', a.token)).socket;
      const sb = (await connect('/notifications', b.token)).socket;
      let bGotOne = false;
      sb.on('notification:new', () => (bGotOne = true));
      const received = next<{ title: string; type: string; isRead: boolean }>(
        sa,
        'notification:new',
      );
      await app
        .get(NotificationsService)
        .notify({ agencyId, userIds: [a.id], type: 'system', title: 'Hello' });
      expect(await received).toMatchObject({ title: 'Hello', type: 'system', isRead: false });
      await new Promise((r) => setTimeout(r, 300));
      expect(bGotOne).toBe(false);
    });

    it('pushes clock-in (and a geofence violation) to the agency live monitor', async () => {
      const cg = await caregiver();
      const now = new Date();
      const hhmm = (d: Date) => d.toISOString().slice(11, 16);
      // A visit around now, on the visit's UTC date (the agency is UTC).
      const start = new Date(now.getTime() - 5 * 60_000);
      const end = new Date(
        Math.min(
          now.getTime() + 55 * 60_000,
          Date.parse(`${start.toISOString().slice(0, 10)}T23:59:00Z`),
        ),
      );
      const visitId = await seedVisit(
        cg.staffId,
        hhmm(start),
        hhmm(end),
        start.toISOString().slice(0, 10),
      );

      const monitor = (await connect('/live-monitor', supervisor.token)).socket;
      const clockIn = next<Record<string, unknown>>(monitor, 'visit:clock-in');
      const violation = next<Record<string, unknown>>(monitor, 'visit:geofence-violation');
      await http()
        .post('/api/v1/evv/clock-in')
        .set({ Authorization: `Bearer ${cg.token}` })
        .send({
          visitId,
          latitude: HOME.latitude + 0.01,
          longitude: HOME.longitude,
          timestamp: now.toISOString(),
        })
        .expect(200);
      expect(await clockIn).toMatchObject({
        visitId,
        status: 'in_progress',
        withinGeofence: false,
        staffName: 'Rio home_health_aide',
      });
      expect(await violation).toMatchObject({ visitId, stage: 'clock-in' });

      const live = await http()
        .get('/api/v1/evv/live')
        .set({ Authorization: `Bearer ${supervisor.token}` })
        .expect(200);
      expect(live.body.data.active.map((a: { visitId: string }) => a.visitId)).toContain(visitId);
      expect(
        live.body.data.active.find((a: { visitId: string }) => a.visitId === visitId),
      ).toMatchObject({
        home: HOME,
        withinGeofence: false,
      });
      await http()
        .get('/api/v1/evv/live')
        .set({ Authorization: `Bearer ${cg.token}` })
        .expect(403);
    });
  });

  describe('visit monitor job', () => {
    it('late at 15 min, no-show at 30 min (supervisors told), missed 2 h after the end — each once', async () => {
      const lateCg = await caregiver();
      const noShowCg = await caregiver();
      const onTimeCg = await caregiver();
      // A fixed "now" of 12:00 UTC today; the agency is UTC.
      const now = new Date(`${today}T12:00:00Z`);
      const late = await seedVisit(lateCg.staffId, '11:40', '12:40');
      const noShow = await seedVisit(noShowCg.staffId, '11:25', '12:25');
      const notYet = await seedVisit(onTimeCg.staffId, '11:50', '12:50');
      const missed = await seedVisit(lateCg.staffId, '08:00', '09:00');
      const unassignedMissed = await seedVisit(null, '07:00', '08:00');
      const offer = await prisma.openShift.create({
        data: { agencyId, visitId: unassignedMissed, createdById: supervisor.id },
      });

      const monitor = (await connect('/live-monitor', supervisor.token)).socket;
      const events: string[] = [];
      monitor.onAny((event: string, payload: { visitId: string }) =>
        events.push(`${event}:${payload.visitId}`),
      );

      const jobs = app.get(VisitMonitorService);
      const first = await jobs.run(now, [agencyId]);
      expect(first.late).toEqual([late]);
      expect(first.noShow).toEqual([noShow]);
      expect(first.missed.sort()).toEqual([missed, unassignedMissed].sort());
      expect(first.late).not.toContain(notYet);

      const visits = await prisma.visit.findMany({
        where: { id: { in: [missed, unassignedMissed, noShow] } },
      });
      const byId = new Map(visits.map((v) => [v.id, v]));
      expect(byId.get(missed)).toMatchObject({ status: 'missed', missedReason: 'No clock-in' });
      expect(byId.get(unassignedMissed)).toMatchObject({
        status: 'missed',
        missedReason: 'No caregiver assigned',
      });
      expect(byId.get(noShow)!.noShowAlertedAt).toBeTruthy();
      expect((await prisma.openShift.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe(
        'cancelled',
      );

      expect(
        await prisma.notification.count({ where: { userId: lateCg.id, type: 'late_arrival' } }),
      ).toBe(1);
      expect(
        await prisma.notification.count({ where: { userId: noShowCg.id, type: 'missed_visit' } }),
      ).toBe(1);
      expect(
        await prisma.notification.count({ where: { userId: supervisor.id, type: 'missed_visit' } }),
      ).toBe(1);

      // Running again (or on another instance) changes nothing.
      expect(await jobs.run(now, [agencyId])).toEqual({ late: [], noShow: [], missed: [] });
      // Later, the late visit becomes a no-show — alerted once more, as a no-show.
      const later = await jobs.run(new Date(now.getTime() + 20 * 60_000), [agencyId]);
      expect(later.noShow).toContain(late);

      await new Promise((r) => setTimeout(r, 300));
      expect(events).toEqual(
        expect.arrayContaining([
          `visit:late:${late}`,
          `visit:noshow:${noShow}`,
          `visit:missed:${missed}`,
        ]),
      );
    });

    it('the nightly extension books active recurring series ahead, idempotently', async () => {
      const cg = await caregiver();
      const rule = await prisma.recurrenceRule.create({
        data: {
          agencyId,
          patientId,
          staffId: cg.staffId,
          visitType: 'home_health_aide',
          frequency: 'weekly',
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: toTime('06:00'),
          endTime: toTime('06:30'),
          startDate: toDate(addDays(today, 1))!,
        },
      });
      const recurring = app.get(RecurringService);
      const first = await recurring.extendAllActive([agencyId]);
      expect(first.created).toBeGreaterThanOrEqual(20);
      expect(await prisma.visit.count({ where: { recurrenceRuleId: rule.id } })).toBe(
        first.created,
      );
      const again = await recurring.extendAllActive([agencyId]);
      expect(again.created).toBe(0);
    });
  });
});
