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

describe.skipIf(!hasDb)('Client timeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let supervisor: Person;
  let office: Person;
  let aide: Person;
  let otherAide: Person;
  let patientId: string;
  const today = utcTodayString();
  const http = () => request(app.getHttpServer());
  const timeline = (who: Person, expect = 200) => http().get(`/api/v1/patients/${patientId}/timeline`).set(who.auth).expect(expect);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Timeline ${randomUUID()}`, timezone: 'UTC' } })).id;
    supervisor = await seedUser('supervisor');
    office = await seedUser('office_staff');
    aide = await seedUser('home_health_aide', 'HHA');
    otherAide = await seedUser('home_health_aide', 'HHA');
    patientId = (
      await prisma.patient.create({
        data: { agencyId, firstName: 'Tess', lastName: 'Timeline', dateOfBirth: new Date('1937-01-01T00:00:00Z'), status: 'active', admissionDate: toDate(addDays(today, -20))! },
      })
    ).id;
    await prisma.referral.create({ data: { agencyId, clientFirstName: 'Tess', clientLastName: 'Timeline', status: 'admitted', patientId, channel: 'web_form', createdAt: new Date(`${addDays(today, -25)}T10:00:00Z`) } });

    const done = await visit(aide, -3, 'completed');
    await visit(otherAide, -2, 'missed', 'Caregiver sick');
    await prisma.visitNote.create({
      data: { visitId: done.id, staffId: aide.staffId!, authorId: aide.id, noteType: 'aide_activity', status: 'submitted', submittedAt: new Date(`${addDays(today, -3)}T11:00:00Z`), incidentFlagType: 'fall', incidentFlagStatus: 'open' },
    });
    await prisma.evvRecord.create({
      data: {
        visitId: done.id,
        agencyId,
        staffId: aide.staffId!,
        patientId,
        serviceType: 'home_health_aide',
        serviceDate: toDate(addDays(today, -3))!,
        clockInTime: new Date(`${addDays(today, -3)}T09:01:00Z`),
        clockInMethod: 'gps',
        status: 'completed',
        flags: ['outside_geofence_in'],
      },
    });
    await prisma.incidentReport.create({
      data: { agencyId, patientId, visitId: done.id, reportedById: supervisor.id, incidentDate: toDate(addDays(today, -3))!, incidentType: 'fall', severity: 'moderate', description: 'Slipped in the hall' },
    });
    await prisma.careUpdate.create({ data: { agencyId, patientId, visitId: done.id, staffProfileId: aide.staffId!, summary: 'Had a shower and a good breakfast.', mood: 'good' } });
  });

  afterAll(async () => {
    await prisma.incidentReport.deleteMany({ where: { agencyId } });
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visitNote.deleteMany({ where: { visit: { agencyId } } });
    await prisma.careUpdate.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.referral.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, discipline?: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `tl-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Tim',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(discipline ? { staffProfile: { create: { agencyId, discipline } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  function visit(who: Person, day: number, status: string, missedReason?: string) {
    const date = addDays(today, day);
    return prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId: who.staffId!,
        visitType: 'home_health_aide',
        status,
        missedReason: missedReason ?? null,
        scheduledDate: toDate(date)!,
        scheduledStart: toTime('09:00'),
        scheduledEnd: toTime('10:00'),
        ...(status === 'completed' ? { actualStart: new Date(`${date}T09:02:00Z`), actualEnd: new Date(`${date}T10:00:00Z`) } : {}),
      },
    });
  }

  it('shows supervisors everything, newest first', async () => {
    const res = (await timeline(supervisor)).body.data;
    // Care update (today), missed visit (2 days ago), then 3 days ago: note 11:00, visit 09:02, EVV 09:01, incident.
    expect(res.events.map((e: { kind: string }) => e.kind)).toEqual(['care_update', 'visit', 'note', 'visit', 'evv', 'incident', 'admission', 'referral']);
    expect(res.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'note', tone: 'warning', detail: expect.stringContaining('possible fall') })]));
    expect(res.events.find((e: { kind: string }) => e.kind === 'referral')).toMatchObject({ detail: 'Website form', link: expect.stringMatching(/^\/referrals\//) });
    expect(res.events.find((e: { title: string }) => e.title === 'Visit missed')).toMatchObject({ tone: 'warning', detail: 'Tim home_health_aide · Caregiver sick' });
  });

  it('leaves out what the viewer may not see', async () => {
    // Office staff: no compliance:read (incidents) — and referrals, visits, EVV are fine.
    const officeKinds = (await timeline(office)).body.data.events.map((e: { kind: string }) => e.kind);
    expect(officeKinds).not.toContain('incident');
    expect(officeKinds).toContain('referral');
    // A caregiver sees only their own visits and notes, no EVV review, no referral.
    const mine = (await timeline(aide)).body.data.events;
    expect(mine.filter((e: { kind: string }) => e.kind === 'visit').map((e: { title: string }) => e.title)).toEqual(['Visit completed — home health aide']);
    expect(mine.map((e: { kind: string }) => e.kind)).not.toContain('referral');
    expect(mine.map((e: { kind: string }) => e.kind)).not.toContain('evv');
  });

  it('respects the date window', async () => {
    const res = (await http().get(`/api/v1/patients/${patientId}/timeline?from=${addDays(today, -4)}&to=${addDays(today, -2)}`).set(supervisor.auth).expect(200)).body.data;
    expect(res.events.map((e: { kind: string }) => e.kind)).toEqual(['visit', 'note', 'visit', 'evv', 'incident']);
    await http().get(`/api/v1/patients/${patientId}/timeline?from=nope`).set(supervisor.auth).expect(400);
    await http().get(`/api/v1/patients/${randomUUID()}/timeline`).set(supervisor.auth).expect(404);
  });
});
