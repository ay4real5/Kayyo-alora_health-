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

const HOME = { lat: 40.0, lng: -75.0 };
const FAR = { lat: 40.43, lng: -75.0 }; // ~30 miles north

describe.skipIf(!hasDb)('Workforce intelligence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let admin: Person;
  let supervisor: Person;
  let office: Person;
  let steady: Person;
  let rushed: Person;
  let patientId: string;
  const today = utcTodayString();
  const http = () => request(app.getHttpServer());
  const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00Z`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Workforce ${randomUUID()}`, timezone: 'UTC' } })).id;
    admin = await seedUser('agency_admin');
    supervisor = await seedUser('supervisor');
    office = await seedUser('office_staff');
    steady = await seedUser('home_health_aide', 'HHA');
    rushed = await seedUser('home_health_aide', 'HHA');
    patientId = (await prisma.patient.create({ data: { agencyId, firstName: 'Wren', lastName: 'Work', dateOfBirth: new Date('1938-01-01T00:00:00Z'), status: 'active' } })).id;

    // "steady": 10 completed visits (one 30 min late), every note in on time, clean EVV, plus one missed visit.
    for (let n = 1; n <= 10; n++) {
      const date = addDays(today, -n);
      const start = n === 3 ? '09:30' : '09:00';
      await visit(steady, date, '09:00', '10:00', { start, end: '10:00', note: at(date, '10:30'), gps: HOME });
    }
    await prisma.visit.create({
      data: { agencyId, patientId, staffId: steady.staffId!, visitType: 'home_health_aide', status: 'missed', scheduledDate: toDate(addDays(today, -11))!, scheduledStart: toTime('09:00'), scheduledEnd: toTime('10:00') },
    });

    // "rushed": two visits that overlap by an hour, and two 30 miles apart ten minutes apart.
    const d1 = addDays(today, -1);
    await visit(rushed, d1, '08:00', '10:00', { start: '08:00', end: '10:00', gps: HOME });
    await visit(rushed, d1, '09:00', '11:00', { start: '09:00', end: '11:00', gps: HOME });
    const d2 = addDays(today, -2);
    await visit(rushed, d2, '08:00', '09:00', { start: '08:00', end: '09:00', gps: HOME });
    await visit(rushed, d2, '09:10', '10:00', { start: '09:10', end: '10:00', gps: FAR });
  });

  afterAll(async () => {
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visitNote.deleteMany({ where: { visit: { agencyId } } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, discipline?: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `wf-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Wil',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(discipline ? { staffProfile: { create: { agencyId, discipline } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  async function visit(who: Person, date: string, from: string, to: string, actual: { start: string; end: string; note?: Date; gps: { lat: number; lng: number } }) {
    const v = await prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId: who.staffId!,
        visitType: 'home_health_aide',
        status: 'completed',
        scheduledDate: toDate(date)!,
        scheduledStart: toTime(from),
        scheduledEnd: toTime(to),
        actualStart: at(date, actual.start),
        actualEnd: at(date, actual.end),
      },
    });
    await prisma.evvRecord.create({
      data: {
        visitId: v.id,
        agencyId,
        staffId: who.staffId!,
        patientId,
        serviceType: 'home_health_aide',
        serviceDate: toDate(date)!,
        clockInTime: at(date, actual.start),
        clockOutTime: at(date, actual.end),
        clockInMethod: 'gps',
        clockOutMethod: 'gps',
        clockInLatitude: actual.gps.lat,
        clockInLongitude: actual.gps.lng,
        clockOutLatitude: actual.gps.lat,
        clockOutLongitude: actual.gps.lng,
        status: 'completed',
        flags: [],
      },
    });
    if (actual.note) {
      await prisma.visitNote.create({
        data: { visitId: v.id, staffId: who.staffId!, authorId: who.id, noteType: 'aide_activity', narrative: 'Routine visit.', status: 'submitted', submittedAt: actual.note },
      });
    }
    return v;
  }

  it('finds EVV patterns for supervisors and shows them in the Command Center', async () => {
    const res = (await http().get('/api/v1/insights/evv-anomalies').set(supervisor.auth).expect(200)).body.data;
    expect(res.items.map((a: { type: string; staffId: string }) => [a.type, a.staffId])).toEqual([
      ['overlap', rushed.staffId],
      ['impossible_travel', rushed.staffId],
    ]);
    expect(res.items[0].link).toMatch(/^\/evv\//);
    expect(res.items[0].staffName).toBe('Wil home_health_aide');

    const center = (await http().get('/api/v1/insights/command-center').set(supervisor.auth).expect(200)).body.data;
    expect(center.evv).toMatchObject({ anomalies: 2, criticalAnomalies: 1 });
    expect(center.attention).toContainEqual(expect.objectContaining({ key: 'evv_anomalies', severity: 'critical', count: 2 }));

    await http().get('/api/v1/insights/evv-anomalies').set(steady.auth).expect(403);
    await http().get('/api/v1/insights/evv-anomalies?from=2026-13-01').set(supervisor.auth).expect(400);
  });

  it('gives admins and supervisors an explainable Care Score; others cannot see it', async () => {
    const list = (await http().get('/api/v1/insights/care-scores').set(supervisor.auth).expect(200)).body.data;
    const row = list.items.find((r: { staffId: string }) => r.staffId === steady.staffId);
    // attendance 10/11 = 91, punctuality 9/10 = 90, notes 10/10, EVV 10/10 → (91×35 + 90×25 + 100×20 + 100×20) / 100
    expect(row).toMatchObject({ score: 94, visits: 11, link: `/staff/${steady.staffId}` });
    expect(row.parts.map((p: { score: number }) => p.score)).toEqual([91, 90, 100, 100]);
    // Four visits is too few for a score.
    expect(list.items.find((r: { staffId: string }) => r.staffId === rushed.staffId)).toMatchObject({ score: null, visits: 4 });

    const one = (await http().get(`/api/v1/insights/care-scores/${steady.staffId}`).set(admin.auth).expect(200)).body.data;
    expect(one).toMatchObject({ score: 94, stats: { visits: 11, missed: 1, late: 1, notesOnTime: 10 } });

    await http().get('/api/v1/insights/care-scores').set(office.auth).expect(403); // no reports:read
    await http().get('/api/v1/insights/care-scores').set(steady.auth).expect(403);
    await http().get(`/api/v1/insights/care-scores/${randomUUID()}`).set(admin.auth).expect(404);
  });

  it('shows caregivers their badges only after the agency switches recognition on', async () => {
    expect((await http().get('/api/v1/insights/my-recognition').set(steady.auth).expect(200)).body.data).toMatchObject({ enabled: false, badges: [] });

    const agency = (await http().patch('/api/v1/agency').set(admin.auth).send({ recognitionBadges: true }).expect(200)).body.data;
    expect(agency.recognitionBadges).toBe(true);
    const mine = (await http().get('/api/v1/insights/my-recognition').set(steady.auth).expect(200)).body.data;
    expect(mine.enabled).toBe(true);
    expect(mine.badges.map((b: { key: string }) => b.key)).toEqual(['note_pro', 'gps_star']);
    // Too few visits: no badges, and nothing negative is shown.
    expect((await http().get('/api/v1/insights/my-recognition').set(rushed.auth).expect(200)).body.data.badges).toEqual([]);

    // Other settings are kept when the flag changes.
    await prisma.agency.update({ where: { id: agencyId }, data: { settings: { recognitionBadges: true, other: 'kept' } } });
    await http().patch('/api/v1/agency').set(admin.auth).send({ recognitionBadges: false }).expect(200);
    expect((await prisma.agency.findUniqueOrThrow({ where: { id: agencyId } })).settings).toEqual({ recognitionBadges: false, other: 'kept' });
  });
});
