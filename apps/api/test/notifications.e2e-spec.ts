import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const PATIENT_LAST_NAME = `Privateperson${randomUUID().slice(0, 6)}`;
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let office: { id: string; auth: Auth };
  let admin: { id: string; auth: Auth };
  let patientId: string;
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), 30);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Notifications Test ${randomUUID()}` } })).id;
    office = await seedUser('office_staff');
    admin = await seedUser('agency_admin');
    patientId = (
      await prisma.patient.create({
        data: { agencyId, firstName: 'Secret', lastName: PATIENT_LAST_NAME, dateOfBirth: new Date('1950-01-01T00:00:00Z'), status: 'active' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `n-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Nia',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const accessToken = await loginForTests(http(), email, PASSWORD);
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  async function caregiver() {
    const user = await seedUser('home_health_aide');
    const staff = await prisma.staffProfile.create({ data: { userId: user.id, agencyId, discipline: 'HHA' } });
    return { ...user, staffId: staff.id };
  }

  const inbox = async (who: Auth) => (await http().get('/api/v1/notifications').set(who).expect(200)).body.data;
  const book = (staffId: string, start: string) =>
    http()
      .post('/api/v1/schedule/visits')
      .set(office.auth)
      .send({ patientId, staffId, visitType: 'home_health_aide', scheduledDate: day, scheduledStart: start, scheduledEnd: `${Number(start.slice(0, 2)) + 1}:00`.padStart(5, '0') })
      .expect(201);

  it('tells a caregiver about a new visit — with no patient details', async () => {
    const cg = await caregiver();
    const visit = (await book(cg.staffId, '09:00')).body.data;

    const [note] = await inbox(cg.auth);
    expect(note).toMatchObject({
      type: 'shift_assigned',
      title: 'New visit assigned',
      body: `You have a visit on ${day} at 09:00. Open the app for details.`,
      data: { visitId: visit.id },
      isRead: false,
    });
    expect(JSON.stringify(note)).not.toContain(PATIENT_LAST_NAME);
    expect(JSON.stringify(note)).not.toContain('Secret');
  });

  it('notifies both caregivers on reassignment, and the caregiver on reschedule and cancel', async () => {
    const a = await caregiver();
    const b = await caregiver();
    const visit = (await book(a.staffId, '11:00')).body.data;

    await http().patch(`/api/v1/schedule/visits/${visit.id}`).set(office.auth).send({ staffId: b.staffId }).expect(200);
    expect((await inbox(a.auth)).map((n: { type: string }) => n.type)).toEqual(['shift_unassigned', 'shift_assigned']);
    expect((await inbox(b.auth)).map((n: { type: string }) => n.type)).toEqual(['shift_assigned']);

    await http().patch(`/api/v1/schedule/visits/${visit.id}`).set(office.auth).send({ scheduledStart: '12:00', scheduledEnd: '13:00' }).expect(200);
    await http().patch(`/api/v1/schedule/visits/${visit.id}`).set(office.auth).send({ notes: 'Bring gloves' }).expect(200); // no time change → no notification
    await http().post(`/api/v1/schedule/visits/${visit.id}/cancel`).set(office.auth).send({ reason: 'test' }).expect(200);
    expect((await inbox(b.auth)).map((n: { type: string }) => n.type)).toEqual(['shift_cancelled', 'shift_updated', 'shift_assigned']);
  });

  it('tells the requester when time off is decided', async () => {
    const cg = await caregiver();
    const request1 = (
      await http()
        .post(`/api/v1/staff/${cg.staffId}/time-off`)
        .set(cg.auth)
        .send({ startDate: addDays(day, 10), endDate: addDays(day, 12), type: 'vacation' })
        .expect(201)
    ).body.data;
    await http().patch(`/api/v1/staff/${cg.staffId}/time-off/${request1.id}`).set(admin.auth).send({ status: 'approved' }).expect(200);

    const types = (await inbox(cg.auth)).map((n: { type: string; title: string }) => `${n.type}:${n.title}`);
    expect(types).toContain('time_off_decided:Time off approved');
  });

  it('marks one or all as read, counts unread, and keeps inboxes private', async () => {
    const cg = await caregiver();
    await book(cg.staffId, '14:00');
    await book(cg.staffId, '15:00');

    expect((await http().get('/api/v1/notifications/unread-count').set(cg.auth).expect(200)).body.data).toEqual({ unread: 2 });
    const [first] = await inbox(cg.auth);

    // Someone else can't see or mark it.
    expect(await inbox(office.auth)).not.toContainEqual(expect.objectContaining({ id: first.id }));
    await http().patch(`/api/v1/notifications/${first.id}/read`).set(office.auth).expect(404);

    const read = await http().patch(`/api/v1/notifications/${first.id}/read`).set(cg.auth).expect(200);
    expect(read.body.data).toMatchObject({ isRead: true });
    expect((await http().get('/api/v1/notifications?unreadOnly=true').set(cg.auth).expect(200)).body.data).toHaveLength(1);

    expect((await http().post('/api/v1/notifications/mark-all-read').set(cg.auth).expect(200)).body.data).toEqual({ updated: 1 });
    expect((await http().get('/api/v1/notifications/unread-count').set(cg.auth).expect(200)).body.data).toEqual({ unread: 0 });
  });

  it("doesn't notify people about their own actions", async () => {
    const before = await prisma.notification.count({ where: { userId: office.id } });
    const cg = await caregiver();
    await book(cg.staffId, '16:00'); // office books; only the caregiver is told
    expect(await prisma.notification.count({ where: { userId: office.id } })).toBe(before);
  });
});
