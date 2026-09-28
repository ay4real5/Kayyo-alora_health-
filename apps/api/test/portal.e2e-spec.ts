import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { checkPassword } from '@alora/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const FAMILY_PASSWORD = 'Family-Horse-7!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

describe.skipIf(!hasDb)('Patient portal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let mom: string; // linked patient
  let dad: string; // second patient, same family member
  let stranger: string; // never linked
  let office: Auth;
  let officeId: string;
  let supervisorId: string;
  let supervisor: Auth;
  let family: Auth;
  const familyEmail = `family-${randomUUID()}@example.test`;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Portal Test ${randomUUID()}`, timezone: 'UTC', phone: '555-010-0199' } })).id;
    const patient = async (firstName: string) =>
      (
        await prisma.patient.create({
          data: {
            agencyId,
            firstName,
            lastName: 'Portal',
            dateOfBirth: new Date('1941-03-03T00:00:00Z'),
            status: 'active',
            medicaidId: 'FAKE12345678',
          },
        })
      ).id;
    mom = await patient('Mona');
    dad = await patient('Dan');
    stranger = await patient('Stella');
    ({ id: officeId, auth: office } = await seedUser('office_staff'));
    ({ id: supervisorId, auth: supervisor } = await seedUser('supervisor'));

    // An aide with visits for Mom: one upcoming, one done last week, one cancelled.
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `portal-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Carla',
        lastName: 'Caregiver',
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    const today = utcTodayString();
    const visit = (days: number, status: string) => ({
      agencyId,
      patientId: mom,
      staffId: aide.staffProfile!.id,
      visitType: 'home_health_aide',
      status,
      scheduledDate: toDate(addDays(today, days))!,
      scheduledStart: toTime('09:00'),
      scheduledEnd: toTime('10:00'),
    });
    await prisma.visit.createMany({ data: [visit(2, 'scheduled'), visit(-7, 'completed'), visit(3, 'cancelled')] });
    await prisma.medication.createMany({
      data: [
        { patientId: mom, drugName: 'Metformin', dosage: '500 mg', frequency: 'twice daily', isActive: true },
        { patientId: mom, drugName: 'Old pill', isActive: false, discontinuedReason: 'stopped' },
      ],
    });
    await prisma.carePlan.create({
      data: {
        patientId: mom,
        status: 'active',
        certificationPeriodStart: toDate(today)!,
        certificationPeriodEnd: toDate(addDays(today, 59))!,
        goals: ['Safe transfers'],
        visitFrequency: [{ discipline: 'HHA', frequency: '3W8' }],
      },
    });
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await prisma.document.updateMany({ where: { agencyId }, data: { previousVersionId: null } });
    await prisma.document.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } }); // meds, care plans cascade
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `portal-${roleName}-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: roleName,
        lastName: 'Staff',
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { id: user.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  const access = (patientId: string) => `/api/v1/patients/${patientId}/portal-access`;
  const portal = (patientId: string, path = '') => `/api/v1/portal/patients/${patientId}${path}`;

  it('staff give a family member access with a one-time temporary password they must change', async () => {
    await http().get(access(mom)).set(office).expect(200, { success: true, data: { portalUser: null } });
    const res = await http().post(access(mom)).set(office).send({ email: familyEmail.toUpperCase(), firstName: 'Fran', lastName: 'Family' }).expect(201);
    const temp = res.body.data.temporaryPassword as string;
    expect(checkPassword(temp).valid).toBe(true);
    expect(res.body.data.portalUser).toMatchObject({ email: familyEmail, mustChangePassword: true, isActive: true });
    await http().post(access(mom)).set(office).send({ email: 'other@example.test', firstName: 'A', lastName: 'B' }).expect(409);
    // A staff member's address can't become a portal account.
    const staffEmail = (await prisma.user.findUniqueOrThrow({ where: { id: officeId } })).email;
    await http().post(access(dad)).set(office).send({ email: staffEmail, firstName: 'A', lastName: 'B' }).expect(409);

    const login = await http().post('/api/v1/auth/login').send({ email: familyEmail, password: temp }).expect(200);
    expect(login.body.data.mustChangePassword).toBe(true);
    await http()
      .post('/api/v1/auth/change-password')
      .set({ Authorization: `Bearer ${login.body.data.accessToken}` })
      .send({ currentPassword: temp, newPassword: FAMILY_PASSWORD })
      .expect(200);
    family = { Authorization: `Bearer ${await loginForTests(http(), familyEmail, FAMILY_PASSWORD)}` };
  });

  it('the same family member can be linked to a second patient without a new password', async () => {
    const res = await http().post(access(dad)).set(office).send({ email: familyEmail, firstName: 'Fran', lastName: 'Family' }).expect(201);
    expect(res.body.data.temporaryPassword).toBeUndefined();
    const me = (await http().get('/api/v1/portal/me').set(family).expect(200)).body.data;
    expect(me.patients.map((p: { id: string }) => p.id).sort()).toEqual([mom, dad].sort());
    expect(me.agency).toMatchObject({ phone: '555-010-0199' });
  });

  it('portal users see only their own patients and nothing of the staff app', async () => {
    const profile = (await http().get(portal(mom, '/profile')).set(family).expect(200)).body.data;
    expect(profile).toMatchObject({ firstName: 'Mona', dateOfBirth: '1941-03-03' });
    expect(JSON.stringify(profile)).not.toContain('FAKE12345678'); // no insurance IDs
    expect(profile).not.toHaveProperty('ssnEncrypted');

    for (const path of ['/profile', '/visits', '/care-plan', '/medications', '/documents', '/messages']) {
      await http().get(portal(stranger, path)).set(family).expect(404);
    }
    await http().get('/api/v1/patients').set(family).expect(403);
    await http().get(`/api/v1/patients/${mom}`).set(family).expect(403);
    await http().get('/api/v1/messages/conversations').set(family).expect(403);
    await http().get('/api/v1/portal/me').set(office).expect(403); // staff don't use the portal
    const audited = await prisma.auditLog.count({ where: { agencyId, action: 'PORTAL_VIEW_PROFILE', resourceId: mom } });
    expect(audited).toBeGreaterThan(0);
  });

  it('shows the visit schedule, active plan of care and active medications', async () => {
    const visits = (await http().get(portal(mom, '/visits')).set(family).expect(200)).body.data;
    expect(visits.upcoming).toEqual([expect.objectContaining({ status: 'scheduled', start: '09:00', caregiver: 'Carla C.' })]);
    expect(visits.recent).toEqual([expect.objectContaining({ status: 'completed' })]);
    const plan = (await http().get(portal(mom, '/care-plan')).set(family).expect(200)).body.data;
    expect(plan).toMatchObject({ goals: ['Safe transfers'], visitFrequency: [{ discipline: 'HHA', frequency: '3W8' }] });
    expect((await http().get(portal(dad, '/care-plan')).set(family).expect(200)).body.data).toBeNull();
    const meds = (await http().get(portal(mom, '/medications')).set(family).expect(200)).body.data;
    expect(meds.map((m: { drugName: string }) => m.drugName)).toEqual(['Metformin']);
  });

  it('documents appear in the portal only when staff share them', async () => {
    const upload = (title: string, shared?: boolean) => {
      let req = http().post('/api/v1/documents').set(office).attach('file', pdf(title), `${title}.pdf`)
        .field('documentType', 'consent').field('title', title).field('patientId', mom);
      if (shared !== undefined) req = req.field('sharedWithPatient', String(shared));
      return req;
    };
    const shared = (await upload('Shared consent', true).expect(201)).body.data;
    const internal = (await upload('Internal note').expect(201)).body.data;
    expect(internal.sharedWithPatient).toBe(false);
    await http().post('/api/v1/documents').set(office).attach('file', pdf('x'), 'x.pdf').field('documentType', 'policy').field('title', 'Policy').field('sharedWithPatient', 'true').expect(400);

    let list = (await http().get(portal(mom, '/documents')).set(family).expect(200)).body.data;
    expect(list.map((d: { id: string }) => d.id)).toEqual([shared.id]);
    const dl = await http().get(portal(mom, `/documents/${shared.id}/download`)).set(family).expect(200);
    expect(dl.headers['content-disposition']).toContain('Shared consent.pdf');
    await http().get(portal(mom, `/documents/${internal.id}/download`)).set(family).expect(404);
    await http().get(portal(dad, `/documents/${shared.id}/download`)).set(family).expect(404); // wrong patient

    await http().patch(`/api/v1/documents/${internal.id}`).set(office).send({ sharedWithPatient: true }).expect(200);
    await http().patch(`/api/v1/documents/${shared.id}`).set(office).send({ sharedWithPatient: false }).expect(200);
    list = (await http().get(portal(mom, '/documents')).set(family).expect(200)).body.data;
    expect(list.map((d: { id: string }) => d.id)).toEqual([internal.id]);
  });

  it('messages reach the office and supervisors, who reply from their Messages', async () => {
    const empty = (await http().get(portal(mom, '/messages')).set(family).expect(200)).body.data;
    expect(empty).toEqual({ conversationId: null, unread: 0, messages: [] });

    await http().post(portal(mom, '/messages')).set(family).send({ content: 'Mom seems more tired this week.' }).expect(201);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: supervisorId, type: 'message_received' } });
    expect(`${note.title} ${note.body}`).not.toContain('tired');

    const inbox = (await http().get('/api/v1/messages/conversations').set(supervisor).expect(200)).body.data;
    const convo = inbox.find((c: { type: string }) => c.type === 'portal');
    expect(convo).toMatchObject({ unread: 1, patient: { id: mom }, lastMessage: { content: 'Mom seems more tired this week.' } });
    await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(supervisor).send({ content: 'Thanks — the nurse will call you today.' }).expect(201);

    const thread = (await http().get(portal(mom, '/messages')).set(family).expect(200)).body.data;
    expect(thread.unread).toBe(1);
    expect(thread.messages.map((m: { content: string }) => m.content)).toEqual([
      'Thanks — the nurse will call you today.',
      'Mom seems more tired this week.',
    ]);
    await http().post(portal(mom, '/messages/read')).set(family).expect(204);
    expect((await http().get(portal(mom, '/messages')).set(family).expect(200)).body.data.unread).toBe(0);
    // Staff can't pull the family member into other conversations.
    await http().post('/api/v1/messages/conversations').set(office).send({ participantIds: [convo.participants[0].id], content: 'x' }).expect(400);
  });

  it('resetting the password signs them out; removing access from the last patient deactivates the account', async () => {
    const reset = (await http().post(`${access(mom)}/reset-password`).set(office).expect(200)).body.data;
    expect(reset.portalUser.mustChangePassword).toBe(true);
    await http().post('/api/v1/auth/login').send({ email: familyEmail, password: FAMILY_PASSWORD }).expect(401);

    await http().delete(access(mom)).set(office).expect(204);
    await http().get(portal(mom, '/profile')).set(family).expect(404); // immediately, even with a live token
    expect((await prisma.user.findUniqueOrThrow({ where: { email: familyEmail } })).isActive).toBe(true); // still has Dad
    await http().delete(access(dad)).set(office).expect(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: familyEmail } })).isActive).toBe(false);
    await http().post('/api/v1/auth/login').send({ email: familyEmail, password: reset.temporaryPassword }).expect(401);
    await http().delete(access(dad)).set(office).expect(404);
  });
});
