import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { RealtimeService } from '../src/modules/realtime/realtime.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };
type Person = { id: string; auth: Auth };

describe.skipIf(!hasDb)('Messaging (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  let patientId: string;
  let office: Person;
  let nurse: Person;
  let aide: Person;
  let billing: Person;
  let outsider: Person;
  let portalUserId: string;
  let inactiveId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Msg Test ${randomUUID()}`, timezone: 'UTC' } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Msg Other ${randomUUID()}`, timezone: 'UTC' } })).id;
    patientId = (
      await prisma.patient.create({
        data: { agencyId, firstName: 'Mo', lastName: 'Message', dateOfBirth: new Date('1938-02-02T00:00:00Z'), status: 'active' },
      })
    ).id;
    office = await seedUser(agencyId, 'office_staff', 'Olive');
    nurse = await seedUser(agencyId, 'registered_nurse', 'Nia');
    aide = await seedUser(agencyId, 'home_health_aide', 'Abe');
    billing = await seedUser(agencyId, 'billing_staff', 'Bea');
    outsider = await seedUser(otherAgencyId, 'office_staff', 'Oscar');
    portalUserId = (await seedUser(agencyId, 'portal_user', 'Pat', false)).id;
    inactiveId = (await seedUser(agencyId, 'office_staff', 'Ina', false)).id;
    await prisma.user.update({ where: { id: inactiveId }, data: { isActive: false } });
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.conversation.deleteMany({ where: { agencyId: id } }); // participants, messages cascade
      await prisma.document.deleteMany({ where: { agencyId: id } }); // message photos (blobs cascade)
      await prisma.notification.deleteMany({ where: { agencyId: id } });
      await prisma.patient.deleteMany({ where: { agencyId: id } });
      await purgeAuditLogs(prisma, id);
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(agency: string, roleName: string, firstName: string, login = true): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `msg-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: agency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName,
        lastName: 'Tester',
        userRoles: { create: { roleId: role.id } },
      },
    });
    const auth = login ? { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } : { Authorization: '' };
    return { id: user.id, auth };
  }

  const start = (who: Person, body: Record<string, unknown>) => http().post('/api/v1/messages/conversations').set(who.auth).send(body);
  const unread = async (who: Person) =>
    (await http().get('/api/v1/messages/unread-count').set(who.auth).expect(200)).body.data.unread as number;

  it('lists active staff in the agency as contacts — not portal users, inactive users or other agencies', async () => {
    const res = await http().get('/api/v1/messages/contacts').set(office.auth).expect(200);
    const ids = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([nurse.id, aide.id, billing.id]));
    expect(ids).not.toContain(office.id);
    expect(ids).not.toContain(portalUserId);
    expect(ids).not.toContain(inactiveId);
    expect(ids).not.toContain(outsider.id);
    const search = await http().get('/api/v1/messages/contacts?search=nia').set(office.auth).expect(200);
    expect(search.body.data.map((c: { id: string }) => c.id)).toEqual([nurse.id]);
  });

  it('direct messages: encrypted at rest, unread until read, one thread per pair, pushes carry no text', async () => {
    const push = vi.spyOn(app.get(RealtimeService), 'toUser');
    const res = await start(office, { participantIds: [nurse.id], content: 'Can you cover Tuesday?' }).expect(201);
    const convo = res.body.data;
    expect(convo).toMatchObject({ type: 'direct', unread: 0, lastMessage: { content: 'Can you cover Tuesday?' } });
    expect(push).toHaveBeenCalledWith(nurse.id, 'message:new', expect.objectContaining({ conversationId: convo.id }));
    expect(JSON.stringify(push.mock.calls)).not.toContain('Tuesday');
    push.mockRestore();

    const stored = await prisma.message.findFirstOrThrow({ where: { conversationId: convo.id } });
    expect(Buffer.from(stored.contentEncrypted).toString('latin1')).not.toContain('Tuesday');

    expect(await unread(nurse)).toBe(1);
    const list = (await http().get('/api/v1/messages/conversations').set(nurse.auth).expect(200)).body.data;
    expect(list.find((c: { id: string }) => c.id === convo.id)).toMatchObject({ unread: 1 });
    await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(nurse.auth).send({ content: 'Yes, 9 to 11.' }).expect(201);
    expect(await unread(nurse)).toBe(0); // replying marks it read
    expect(await unread(office)).toBe(1);
    await http().post(`/api/v1/messages/conversations/${convo.id}/read`).set(office.auth).expect(204);
    expect(await unread(office)).toBe(0);

    // Messaging the same person again continues the same thread.
    const again = await start(office, { participantIds: [nurse.id], content: 'Thanks!' }).expect(201);
    expect(again.body.data.id).toBe(convo.id);
    const msgs = (await http().get(`/api/v1/messages/conversations/${convo.id}/messages`).set(nurse.auth).expect(200)).body.data;
    expect(msgs.map((m: { content: string }) => m.content)).toEqual(['Thanks!', 'Yes, 9 to 11.', 'Can you cover Tuesday?']);
    const older = (
      await http().get(`/api/v1/messages/conversations/${convo.id}/messages?limit=1&before=${msgs[1].createdAt}`).set(nurse.auth).expect(200)
    ).body.data;
    expect(older.map((m: { content: string }) => m.content)).toEqual(['Can you cover Tuesday?']);
  });

  it('only participants can see or post; other agencies and non-participants get 404', async () => {
    const convo = (await start(office, { participantIds: [billing.id], content: 'Payer called back' }).expect(201)).body.data;
    for (const who of [aide, outsider]) {
      await http().get(`/api/v1/messages/conversations/${convo.id}`).set(who.auth).expect(404);
      await http().get(`/api/v1/messages/conversations/${convo.id}/messages`).set(who.auth).expect(404);
      await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(who.auth).send({ content: 'hi' }).expect(404);
    }
    const aideList = (await http().get('/api/v1/messages/conversations').set(aide.auth).expect(200)).body.data;
    expect(aideList.map((c: { id: string }) => c.id)).not.toContain(convo.id);
  });

  it('refuses people who can’t be messaged and patients the sender can’t see', async () => {
    await start(office, { participantIds: [portalUserId], content: 'x' }).expect(400);
    await start(office, { participantIds: [inactiveId], content: 'x' }).expect(400);
    await start(office, { participantIds: [outsider.id], content: 'x' }).expect(400);
    await start(office, { participantIds: [office.id], content: 'x' }).expect(400);
    await start(office, { participantIds: [nurse.id], content: '   ' }).expect(400);
    await start(aide, { participantIds: [office.id], patientId, content: 'About my patient' }).expect(404); // not assigned
    await start(office, { participantIds: [nurse.id], content: 'x', documentId: randomUUID() }).expect(404);
    // A bad attachment is refused before anything is created.
    await start(office, { participantIds: [billing.id], subject: 'Never created', content: 'x', documentId: randomUUID() }).expect(404);
    expect(await prisma.conversation.count({ where: { agencyId, subject: 'Never created' } })).toBe(0);
  });

  it('groups about a patient: leaving keeps earlier history only, people can be added back', async () => {
    const convo = (
      await start(office, { participantIds: [nurse.id, aide.id], subject: 'Care team', patientId, content: 'Welcome, team' }).expect(201)
    ).body.data;
    expect(convo).toMatchObject({ type: 'group', subject: 'Care team', patient: { id: patientId } });
    expect(convo.participants).toHaveLength(3);

    await http().post(`/api/v1/messages/conversations/${convo.id}/leave`).set(aide.auth).expect(204);
    await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(aide.auth).send({ content: 'hi' }).expect(409);
    await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(office.auth).send({ content: 'After you left' }).expect(201);
    const aideView = (await http().get(`/api/v1/messages/conversations/${convo.id}/messages`).set(aide.auth).expect(200)).body.data;
    expect(aideView.map((m: { content: string }) => m.content)).toEqual(['Welcome, team']);
    expect((await http().get(`/api/v1/messages/conversations/${convo.id}`).set(aide.auth).expect(200)).body.data).toMatchObject({
      left: true,
      unread: 1, // "Welcome, team" was never read
    });

    await http().post(`/api/v1/messages/conversations/${convo.id}/participants`).set(nurse.auth).send({ userIds: [aide.id, billing.id] }).expect(200);
    await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(aide.auth).send({ content: 'Back again' }).expect(201);

    const direct = (await start(nurse, { participantIds: [aide.id], content: 'hey' }).expect(201)).body.data;
    await http().post(`/api/v1/messages/conversations/${direct.id}/participants`).set(nurse.auth).send({ userIds: [billing.id] }).expect(409);
    await http().post(`/api/v1/messages/conversations/${direct.id}/leave`).set(nurse.auth).expect(409);
  });

  it('urgent messages also notify recipients, without the message text', async () => {
    const convo = (await start(office, { participantIds: [nurse.id], subject: 'Urgent', content: 'Patient fell — call me', isUrgent: true }).expect(201)).body
      .data;
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: nurse.id, type: 'message_received' } });
    expect(note).toMatchObject({ title: 'Urgent message', data: { conversationId: convo.id } });
    expect(`${note.title} ${note.body}`).not.toContain('fell');
    expect(await prisma.notification.count({ where: { userId: office.id, type: 'message_received' } })).toBe(0);
  });

  it('photos (D-089): participants see them inline, nobody else can; they stay out of the document library', async () => {
    const convo = (await start(aide, { participantIds: [nurse.id], content: 'Wound dressing looks different today' }).expect(201)).body.data;
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
    const upload = (who: Person, file: Buffer, name = 'photo.jpg') =>
      http().post(`/api/v1/messages/conversations/${convo.id}/photos`).set(who.auth).attach('file', file, name);

    await upload(aide, Buffer.from('%PDF-1.4 not a photo'), 'x.pdf').expect(415);
    await upload(outsider, jpeg).expect(404);
    const photo = (await upload(aide, jpeg).expect(201)).body.data;
    expect(photo).toMatchObject({ mimeType: 'image/jpeg' });

    // Only its uploader can attach it, and only once.
    await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(nurse.auth).send({ content: 'Mine now', documentId: photo.id }).expect(400);
    const sent = (
      await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(aide.auth).send({ content: 'Photo', documentId: photo.id }).expect(201)
    ).body.data;
    expect(sent.document).toMatchObject({ id: photo.id, isPhoto: true, mimeType: 'image/jpeg' });
    await http().post(`/api/v1/messages/conversations/${convo.id}/messages`).set(aide.auth).send({ content: 'Again', documentId: photo.id }).expect(400);

    const url = `/api/v1/messages/conversations/${convo.id}/attachments/${photo.id}`;
    const seen = await http().get(url).set(nurse.auth).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(seen.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(seen.body as Buffer, jpeg)).toBe(0);
    for (const who of [office, outsider]) await http().get(url).set(who.auth).expect(404);

    // Stored encrypted, and not in the library (nor openable through it).
    const blob = await prisma.documentBlob.findFirstOrThrow({ where: { documentId: photo.id } });
    expect(Buffer.from(blob.content).includes(Buffer.alloc(64, 1))).toBe(false);
    const library = (await http().get('/api/v1/documents?limit=100').set(office.auth).expect(200)).body.data;
    expect(library.map((d: { id: string }) => d.id)).not.toContain(photo.id);
    await http().get(`/api/v1/documents/${photo.id}/download`).set(office.auth).expect(404);
  });

  it('portal users have no staff messaging', async () => {
    const portal = await seedUser(agencyId, 'portal_user', 'Polly');
    await http().get('/api/v1/messages/conversations').set(portal.auth).expect(403);
  });
});
