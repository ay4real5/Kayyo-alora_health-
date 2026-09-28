import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { todayInTimeZone } from '@alora/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Recurring visits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let office: Auth;
  const http = () => request(app.getHttpServer());
  // The agency uses the default timezone (America/New_York); the series starts tomorrow there.
  const start = addDays(todayInTimeZone('America/New_York'), 1);
  const startDow = new Date(`${start}T00:00:00Z`).getUTCDay();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Recurring Test ${randomUUID()}` } })).id;
    office = (await seedUser('office_staff')).auth;
  });

  afterAll(async () => {
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.recurrenceRule.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `rec-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Rae',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const { accessToken } = (await http().post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.data;
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  async function setup(patientStatus = 'active') {
    const patient = await prisma.patient.create({
      data: {
        agencyId,
        firstName: 'Rex',
        lastName: `Recurring-${randomUUID().slice(0, 6)}`,
        dateOfBirth: new Date('1945-05-05T00:00:00Z'),
        status: patientStatus,
      },
    });
    const user = await seedUser('home_health_aide');
    const staff = await prisma.staffProfile.create({ data: { userId: user.id, agencyId, discipline: 'HHA' } });
    return { patientId: patient.id, staffId: staff.id, caregiverAuth: user.auth };
  }

  const series = (patientId: string, staffId: string, extra: Record<string, unknown> = {}) => ({
    patientId,
    staffId,
    visitType: 'home_health_aide',
    frequency: 'weekly',
    daysOfWeek: [startDow],
    startTime: '09:00',
    endTime: '10:00',
    startDate: start,
    ...extra,
  });
  const create = (body: object) => http().post('/api/v1/schedule/recurring').set(office).send(body);

  it('creates a weekly series and books the next four weeks', async () => {
    const { patientId, staffId } = await setup();
    const res = await create(series(patientId, staffId)).expect(201);
    const rule = res.body.data;

    expect(rule).toMatchObject({ frequency: 'weekly', daysOfWeek: [startDow], startTime: '09:00', isActive: true });
    expect(rule.generation.created.map((c: { scheduledDate: string }) => c.scheduledDate)).toEqual([
      start,
      addDays(start, 7),
      addDays(start, 14),
      addDays(start, 21),
    ]);
    expect(rule.generation.skipped).toEqual([]);
    const visits = await prisma.visit.findMany({ where: { recurrenceRuleId: rule.id } });
    expect(visits).toHaveLength(4);
    expect(visits.every((v) => v.isRecurring && v.staffId === staffId)).toBe(true);
  });

  it('skips and reports dates with blocking conflicts, books the rest, and generation is repeatable', async () => {
    const { patientId, staffId } = await setup();
    // The caregiver is already busy on the second occurrence.
    const busy = await http()
      .post('/api/v1/schedule/visits')
      .set(office)
      .send({ patientId, staffId, visitType: 'home_health_aide', scheduledDate: addDays(start, 7), scheduledStart: '09:30', scheduledEnd: '10:30' })
      .expect(201);

    const rule = (await create(series(patientId, staffId)).expect(201)).body.data;
    expect(rule.generation.created).toHaveLength(3);
    expect(rule.generation.skipped).toEqual([
      { date: addDays(start, 7), conflicts: [expect.objectContaining({ code: 'staff_double_booked', visitIds: [busy.body.data.id] })] },
    ]);

    const again = await http().post(`/api/v1/schedule/recurring/${rule.id}/generate`).set(office).send({}).expect(200);
    expect(again.body.data.created).toEqual([]); // nothing duplicated
    expect(await prisma.visit.count({ where: { recurrenceRuleId: rule.id } })).toBe(3);
  });

  it('respects maxOccurrences', async () => {
    const { patientId, staffId } = await setup();
    const rule = (await create(series(patientId, staffId, { maxOccurrences: 2 })).expect(201)).body.data;
    expect(rule.generation.created).toHaveLength(2);
  });

  it('changing the pattern rebuilds future scheduled occurrences but keeps an individually cancelled one', async () => {
    const { patientId, staffId } = await setup();
    const rule = (await create(series(patientId, staffId)).expect(201)).body.data;
    const [first, second] = rule.generation.created as { id: string; scheduledDate: string }[];
    await http().post(`/api/v1/schedule/visits/${second!.id}/cancel`).set(office).send({ reason: 'Family visiting' }).expect(200);

    const updated = (
      await http().patch(`/api/v1/schedule/recurring/${rule.id}`).set(office).send({ startTime: '14:00', endTime: '15:00' }).expect(200)
    ).body.data;
    expect(updated.startTime).toBe('14:00');
    expect(updated.generation.created.map((c: { scheduledDate: string }) => c.scheduledDate)).toEqual([
      first!.scheduledDate,
      addDays(start, 14),
      addDays(start, 21),
    ]);

    const cancelled = await prisma.visit.findUniqueOrThrow({ where: { id: second!.id } });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Family visiting' });
    expect(await prisma.visit.count({ where: { id: first!.id } })).toBe(0); // old 09:00 occurrence replaced
    const times = await prisma.visit.findMany({ where: { recurrenceRuleId: rule.id, status: 'scheduled' } });
    expect(times.every((v) => v.scheduledStart.toISOString().slice(11, 16) === '14:00')).toBe(true);
  });

  it('ending a series cancels its future visits and stops generation', async () => {
    const { patientId, staffId } = await setup();
    const rule = (await create(series(patientId, staffId)).expect(201)).body.data;
    const ended = await http().delete(`/api/v1/schedule/recurring/${rule.id}`).set(office).expect(200);
    expect(ended.body.data.cancelledVisits).toBe(4);
    expect(await prisma.visit.count({ where: { recurrenceRuleId: rule.id, status: 'cancelled' } })).toBe(4);

    await http().post(`/api/v1/schedule/recurring/${rule.id}/generate`).set(office).send({}).expect(409);
    await http().patch(`/api/v1/schedule/recurring/${rule.id}`).set(office).send({ startTime: '08:00' }).expect(409);
    await http().delete(`/api/v1/schedule/recurring/${rule.id}`).set(office).expect(409);
  });

  it('validates the pattern and refuses inactive patients', async () => {
    const { patientId, staffId } = await setup();
    await create(series(patientId, staffId, { endTime: '09:00' })).expect(400);
    await create(series(patientId, staffId, { daysOfWeek: [] })).expect(400);
    await create(series(patientId, staffId, { daysOfWeek: [1, 1] })).expect(400);
    await create(series(patientId, staffId, { daysOfWeek: [7] })).expect(400);
    await create(series(patientId, staffId, { frequency: 'daily' })).expect(400);
    await create(series(patientId, staffId, { endDate: addDays(start, -1) })).expect(400);

    const discharged = await setup('discharged');
    await create(series(discharged.patientId, discharged.staffId)).expect(409);
  });

  it('shows caregivers only their own series', async () => {
    const mine = await setup();
    const theirs = await setup();
    const myRule = (await create(series(mine.patientId, mine.staffId, { maxOccurrences: 1 })).expect(201)).body.data;
    const theirRule = (await create(series(theirs.patientId, theirs.staffId, { maxOccurrences: 1 })).expect(201)).body.data;

    const list = await http().get('/api/v1/schedule/recurring?limit=100').set(mine.caregiverAuth).expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([myRule.id]);
    await http().get(`/api/v1/schedule/recurring/${theirRule.id}`).set(mine.caregiverAuth).expect(404);
    await http().post('/api/v1/schedule/recurring').set(mine.caregiverAuth).send(series(mine.patientId, mine.staffId)).expect(403);
  });
});
