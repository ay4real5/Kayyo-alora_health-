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
const noThrottle = { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
type Person = { id: string; auth: { Authorization: string }; staffId?: string };

describe.skipIf(!hasDb)('Time off (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  let supervisor: Person;
  let aide: Person;
  let nurse: Person;
  let outsider: Person;
  const http = () => request(app.getHttpServer());
  const day = (n: number) => addDays(utcTodayString(), n);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Time Off ${randomUUID()}`, timezone: 'UTC' } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Time Off Other ${randomUUID()}`, timezone: 'UTC' } })).id;
    supervisor = await seedUser(agencyId, 'supervisor', 'RN');
    aide = await seedUser(agencyId, 'home_health_aide', 'HHA');
    nurse = await seedUser(agencyId, 'registered_nurse', 'RN');
    outsider = await seedUser(otherAgencyId, 'supervisor', 'RN');
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.visit.deleteMany({ where: { agencyId: id } });
      await prisma.patient.deleteMany({ where: { agencyId: id } });
      await prisma.notification.deleteMany({ where: { agencyId: id } });
      await purgeAuditLogs(prisma, id);
      await prisma.user.deleteMany({ where: { agencyId: id } }); // staff profiles and time off cascade
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(agency: string, roleName: string, discipline: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `timeoff-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: agency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Tia',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId: agency, discipline } },
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile!.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  const ask = (who: Person, body: Record<string, unknown>) => http().post('/api/v1/time-off').set(who.auth).send(body);

  it('staff request days off; the rules are enforced', async () => {
    await ask(aide, { startDate: day(-1), endDate: day(1), type: 'vacation' }).expect(400); // starts in the past
    await ask(aide, { startDate: day(5), endDate: day(4), type: 'vacation' }).expect(400); // ends before it starts
    await ask(aide, { startDate: day(5), endDate: day(70), type: 'vacation' }).expect(400); // over 60 days
    await ask(aide, { startDate: day(5), endDate: day(6), type: 'holiday' }).expect(400); // unknown type
    const res = await ask(aide, { startDate: day(5), endDate: day(7), type: 'vacation', notes: 'Family wedding' }).expect(201);
    expect(res.body.data).toMatchObject({ status: 'pending', days: 3, type: 'vacation', staff: { id: aide.staffId } });
    await ask(aide, { startDate: day(7), endDate: day(8), type: 'personal' }).expect(409); // overlaps

    // Staff see only their own; other agencies see nothing.
    const mine = (await http().get('/api/v1/time-off').set(aide.auth).expect(200)).body.data;
    expect(mine.map((t: { id: string }) => t.id)).toEqual([res.body.data.id]);
    expect((await http().get('/api/v1/time-off').set(nurse.auth).expect(200)).body.data).toEqual([]);
    expect((await http().get('/api/v1/time-off').set(outsider.auth).expect(200)).body.data).toEqual([]);
  });

  it('supervisors see pending requests with booked visits, decide them, and the requester is told', async () => {
    const patient = await prisma.patient.create({
      data: { agencyId, firstName: 'Pat', lastName: 'TimeOff', dateOfBirth: new Date('1940-01-01T00:00:00Z'), status: 'active' },
    });
    await prisma.visit.create({
      data: {
        agencyId,
        patientId: patient.id,
        staffId: nurse.staffId!,
        visitType: 'skilled_nursing',
        scheduledDate: toDate(day(10))!,
        scheduledStart: toTime('09:00'),
        scheduledEnd: toTime('10:00'),
      },
    });
    const req = (await ask(nurse, { startDate: day(10), endDate: day(10), type: 'sick' }).expect(201)).body.data;

    await http().patch(`/api/v1/time-off/${req.id}`).set(aide.auth).send({ status: 'approved' }).expect(403); // no visits:approve
    await http().patch(`/api/v1/time-off/${req.id}`).set(outsider.auth).send({ status: 'approved' }).expect(404);
    const pending = (await http().get('/api/v1/time-off?status=pending').set(supervisor.auth).expect(200)).body.data;
    expect(pending.find((t: { id: string }) => t.id === req.id)).toMatchObject({ bookedVisits: 1 });

    const decided = (await http().patch(`/api/v1/time-off/${req.id}`).set(supervisor.auth).send({ status: 'approved' }).expect(200)).body.data;
    expect(decided).toMatchObject({ status: 'approved', decidedBy: { id: supervisor.id }, bookedVisits: 1 });
    await http().patch(`/api/v1/time-off/${req.id}`).set(supervisor.auth).send({ status: 'denied' }).expect(409); // already decided

    const note = await prisma.notification.findFirstOrThrow({ where: { userId: nurse.id, type: 'time_off_decided' } });
    expect(note.title).toBe('Time off approved');
    expect(`${note.title} ${note.body}`).not.toContain('Pat'); // dates only, never patient details
  });

  it('nobody decides their own request; requesters can withdraw until it starts', async () => {
    const own = (await ask(supervisor, { startDate: day(20), endDate: day(21), type: 'personal' }).expect(201)).body.data;
    await http().patch(`/api/v1/time-off/${own.id}`).set(supervisor.auth).send({ status: 'approved' }).expect(403);

    const req = (await ask(aide, { startDate: day(30), endDate: day(30), type: 'personal' }).expect(201)).body.data;
    await http().patch(`/api/v1/time-off/${req.id}`).set(supervisor.auth).send({ status: 'approved' }).expect(200);
    await http().post(`/api/v1/time-off/${req.id}/cancel`).set(nurse.auth).expect(404); // not theirs
    const cancelled = (await http().post(`/api/v1/time-off/${req.id}/cancel`).set(aide.auth).expect(200)).body.data;
    expect(cancelled.status).toBe('cancelled');
    await http().post(`/api/v1/time-off/${req.id}/cancel`).set(aide.auth).expect(409);
  });
});
