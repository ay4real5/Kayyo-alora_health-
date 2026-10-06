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

describe.skipIf(!hasDb)('Caregiver matching (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let office: Person;
  let a: Person; // best fit
  let b: Person; // eligible, weaker fit
  let c: Person; // declined by the patient
  let d: Person; // double booked
  let e: Person; // wrong discipline
  let patientId: string;
  let visitId: string;
  const day = addDays(utcTodayString(), 3);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Matching ${randomUUID()}`, timezone: 'UTC' } })).id;
    office = await seedUser('office_staff');
    a = await seedUser('home_health_aide', { discipline: 'HHA', gender: 'female', languages: ['English', 'Spanish'], latitude: 37.55, longitude: -77.45 }, 'Ana');
    b = await seedUser('home_health_aide', { discipline: 'HHA', gender: 'male', languages: ['English'], latitude: 37.95, longitude: -77.45 }, 'Ben');
    c = await seedUser('home_health_aide', { discipline: 'HHA' }, 'Cal');
    d = await seedUser('home_health_aide', { discipline: 'HHA' }, 'Dee');
    e = await seedUser('registered_nurse', { discipline: 'RN' }, 'Eve');

    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Mira',
          lastName: `Match-${randomUUID().slice(0, 6)}`,
          dateOfBirth: new Date('1938-01-01T00:00:00Z'),
          status: 'active',
          zip: '23220',
          latitude: 37.54,
          longitude: -77.43,
          preferredLanguage: 'Spanish',
          preferredCaregiverGender: 'female',
        },
      })
    ).id;
    const visit = (date: string, staffId: string | null, start: string, end: string, status = 'scheduled') =>
      prisma.visit.create({
        data: { agencyId, patientId, staffId, status, visitType: 'home_health_aide', scheduledDate: toDate(date)!, scheduledStart: toTime(start), scheduledEnd: toTime(end) },
      });
    // Ana has been here three times before.
    for (const n of [10, 17, 24]) await visit(addDays(day, -n), a.staffId!, '09:00', '11:00', 'completed');
    // Dee is busy at the same time on that day (another visit for the same patient keeps the setup small).
    await visit(day, d.staffId!, '10:30', '11:30');
    visitId = (await visit(day, null, '10:00', '12:00')).id;
  });

  afterAll(async () => {
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, staff?: Record<string, unknown>, firstName = 'Oli'): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `match-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName,
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(staff ? { staffProfile: { create: { agencyId, discipline: 'HHA', ...staff } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  it('records preferred and declined caregivers on the patient', async () => {
    await http().put(`/api/v1/patients/${patientId}/caregiver-preferences/${c.staffId}`).set(office.auth).send({ kind: 'declined', note: 'Family request' }).expect(200);
    await http().put(`/api/v1/patients/${patientId}/caregiver-preferences/${randomUUID()}`).set(office.auth).send({ kind: 'preferred' }).expect(400);
    const list = (await http().get(`/api/v1/patients/${patientId}/caregiver-preferences`).set(office.auth).expect(200)).body.data;
    expect(list).toEqual([expect.objectContaining({ kind: 'declined', note: 'Family request', staff: expect.objectContaining({ id: c.staffId, firstName: 'Cal' }) })]);
  });

  it('ranks eligible caregivers with reasons and explains who can’t take it', async () => {
    const res = (await http().get(`/api/v1/schedule/visits/${visitId}/suggestions`).set(office.auth).expect(200)).body.data;
    expect(res.considered).toBe(4); // the RN isn't an aide
    expect(res.suggestions.map((s: { staff: { id: string } }) => s.staff.id)).toEqual([a.staffId, b.staffId]);
    const best = res.suggestions[0];
    expect(best.reasons.filter((r: { good: boolean }) => r.good).map((r: { text: string }) => r.text)).toEqual(
      expect.arrayContaining(['Has visited this patient 3 times', 'Speaks Spanish', 'Matches the patient’s caregiver gender preference']),
    );
    expect(best.reasons.some((r: { text: string }) => /miles away/.test(r.text))).toBe(true);
    expect(res.suggestions[1].reasons.filter((r: { good: boolean }) => !r.good).map((r: { text: string }) => r.text)).toEqual(
      expect.arrayContaining(['Doesn’t list Spanish', 'Doesn’t match the patient’s caregiver gender preference']),
    );
    const excluded = Object.fromEntries(res.excluded.map((x: { staff: { id: string }; reason: string }) => [x.staff.id, x.reason]));
    expect(excluded[c.staffId!]).toBe('Declined by the patient');
    expect(excluded[d.staffId!]).toMatch(/already|another visit|double/i);
    expect(excluded[e.staffId!]).toBeUndefined();
  });

  it('works for a visit not booked yet, and only for people who can assign visits', async () => {
    const body = { patientId, visitType: 'home_health_aide', scheduledDate: addDays(day, 1), scheduledStart: '08:00', scheduledEnd: '12:00' };
    const res = (await http().post('/api/v1/schedule/suggestions').set(office.auth).send(body).expect(200)).body.data;
    expect(res.suggestions[0].staff.id).toBe(a.staffId);
    expect(res.suggestions.map((s: { staff: { id: string } }) => s.staff.id)).toContain(d.staffId); // free that day
    await http().post('/api/v1/schedule/suggestions').set(a.auth).send(body).expect(403);
    await http().get(`/api/v1/schedule/visits/${visitId}/suggestions`).set(a.auth).expect(403);
  });
});
