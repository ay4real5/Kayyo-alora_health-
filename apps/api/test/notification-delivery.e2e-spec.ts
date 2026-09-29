import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { NotificationDeliveryService } from '../src/modules/notifications/delivery/delivery.service.js';
import { EmailSender, PushSender, SmsSender, type SendOutcome } from '../src/modules/notifications/delivery/senders.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
const ok = (id: string): SendOutcome => ({ ok: true, providerMessageId: id });

/** Fake providers: "connected", recording what they're asked to send. Nothing leaves the machine. */
const push = { channel: 'push', enabled: true, send: vi.fn(async (): Promise<SendOutcome> => ok('push-1')) };
const sms = { channel: 'sms', enabled: true, send: vi.fn(async (): Promise<SendOutcome> => ok('SM1')) };
const email = { channel: 'email', enabled: false, send: vi.fn(async (): Promise<SendOutcome> => ok('em-1')) };

describe.skipIf(!hasDb)('Notification delivery: push / SMS / email outbox (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let delivery: NotificationDeliveryService;
  let agencyId: string;
  let aideId: string;
  let patientUserId: string;
  let auth: { Authorization: string };
  const http = () => request(app.getHttpServer());
  const TOKEN = `ExponentPushToken[${randomUUID().replaceAll('-', '').slice(0, 22)}]`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .overrideProvider(PushSender)
      .useValue(push)
      .overrideProvider(SmsSender)
      .useValue(sms)
      .overrideProvider(EmailSender)
      .useValue(email)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    delivery = app.get(NotificationDeliveryService);
    agencyId = (await prisma.agency.create({ data: { name: `Delivery Test ${randomUUID()}`, timezone: 'UTC' } })).id;
    const role = async (name: string) => (await prisma.role.findFirstOrThrow({ where: { agencyId: null, name } })).id;
    const aideEmail = `deliv-${randomUUID()}@example.test`;
    aideId = (
      await prisma.user.create({
        data: {
          agencyId,
          email: aideEmail,
          phone: '(555) 010-0199',
          passwordHash: await app.get(PasswordService).hash(PASSWORD),
          passwordChangedAt: new Date(),
          firstName: 'Dee',
          lastName: 'Livery',
          userRoles: { create: { roleId: await role('home_health_aide') } },
        },
      })
    ).id;
    patientUserId = (
      await prisma.user.create({
        data: {
          agencyId,
          email: `deliv-portal-${randomUUID()}@example.test`,
          phone: '555-010-0198',
          passwordHash: 'x',
          firstName: 'Pat',
          lastName: 'Portal',
          userRoles: { create: { roleId: await role('portal_user') } },
        },
      })
    ).id;
    auth = { Authorization: `Bearer ${await loginForTests(http(), aideEmail, PASSWORD)}` };
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { agencyId } }); // deliveries cascade
    await prisma.user.deleteMany({ where: { agencyId } }); // devices, preferences cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  const deliveriesFor = async (userId: string) =>
    prisma.notificationDelivery.findMany({ where: { notification: { userId } }, orderBy: { channel: 'asc' } });

  it('the app registers a phone for push; bad tokens are refused; channels shows what is connected', async () => {
    await http().post('/api/v1/notifications/devices').set(auth).send({ token: 'not-a-token', platform: 'ios' }).expect(400);
    await http().post('/api/v1/notifications/devices').set(auth).send({ token: TOKEN, platform: 'ios' }).expect(200);
    expect(await prisma.pushDevice.count({ where: { userId: aideId } })).toBe(1);
    const channels = (await http().get('/api/v1/notifications/channels').set(auth).expect(200)).body.data;
    expect(channels).toEqual({ push: true, sms: true, email: false });
    const prefs = (await http().get('/api/v1/notifications/preferences').set(auth).expect(200)).body.data;
    expect(prefs.find((p: { type: string }) => p.type === 'shift_assigned')).toMatchObject({ push: true, sms: true, email: false });
  });

  it('a new shift is queued for push and SMS (type defaults) — never for a patient — and the job sends it', async () => {
    await notifications.notify({ agencyId, userIds: [aideId, patientUserId], type: 'shift_assigned', title: 'New shift assigned', data: { visitId: 'v-1' } });
    const queued = await deliveriesFor(aideId);
    expect(queued.map((d) => [d.channel, d.status])).toEqual([
      ['push', 'pending'],
      ['sms', 'pending'],
    ]);
    expect(await deliveriesFor(patientUserId)).toEqual([]); // in-app only
    expect(await prisma.notification.count({ where: { userId: patientUserId } })).toBe(1);

    const result = await delivery.run();
    expect(result).toMatchObject({ sent: 2, failed: 0 });
    expect(push.send).toHaveBeenCalledWith([TOKEN], expect.objectContaining({ title: 'New shift assigned', data: { visitId: 'v-1' } }));
    expect(sms.send).toHaveBeenCalledWith('+15550100199', expect.objectContaining({ type: 'shift_assigned' }));
    const sent = await deliveriesFor(aideId);
    expect(sent.map((d) => [d.channel, d.status, d.providerMessageId])).toEqual([
      ['push', 'sent', 'push-1'],
      ['sms', 'sent', 'SM1'],
    ]);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: aideId, type: 'shift_assigned' } });
    expect(n).toMatchObject({ sentViaPush: true, sentViaSms: true, sentViaEmail: false, channels: ['in_app', 'push', 'sms'] });
    expect((await delivery.run()).sent).toBe(0); // nothing sent twice
  });

  it('retries with backoff, then gives up; a phone Expo says is gone is removed', async () => {
    sms.send.mockResolvedValue({ ok: false, retry: true, error: 'twilio 503' });
    push.send.mockResolvedValue({ ok: false, retry: false, error: 'expo DeviceNotRegistered', deadTokens: [TOKEN] });
    await notifications.notify({ agencyId, userIds: [aideId], type: 'missed_visit', title: 'Missed visit' });
    const now = new Date();
    const first = await delivery.run(now);
    expect(first).toMatchObject({ retried: 1, failed: 1 });
    expect(await prisma.pushDevice.count({ where: { token: TOKEN } })).toBe(0);
    const pending = await prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: 'sms', notification: { userId: aideId, type: 'missed_visit' } },
    });
    expect(pending).toMatchObject({ status: 'pending', attempts: 1, lastError: 'twilio 503' });
    expect(pending.nextAttemptAt.getTime() - now.getTime()).toBe(60_000);
    expect((await delivery.run(now)).retried).toBe(0); // not due yet

    // Four more failures (1, 5, 30, 120 minutes apart) and it's given up.
    let at = now.getTime();
    for (const wait of [1, 5, 30, 120]) {
      at += wait * 60_000;
      await delivery.run(new Date(at));
    }
    const final = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: pending.id } });
    expect(final).toMatchObject({ status: 'failed', attempts: 5 });
    sms.send.mockResolvedValue(ok('SM2'));
    push.send.mockResolvedValue(ok('push-2'));
  });

  it('someone who wants a text but not the in-app alert gets the text only', async () => {
    await prisma.notificationPreference.create({
      data: { userId: aideId, notificationType: 'shift_cancelled', channelInApp: false, channelSms: true },
    });
    await notifications.notify({ agencyId, userIds: [aideId], type: 'shift_cancelled', title: 'Shift cancelled' });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: aideId, type: 'shift_cancelled' } });
    expect(row.channels).toEqual(['sms']);
    const inbox = (await http().get('/api/v1/notifications?limit=50').set(auth).expect(200)).body.data;
    expect(inbox.map((x: { type: string }) => x.type)).not.toContain('shift_cancelled');
    expect((await delivery.run()).sent).toBe(1);
  });

  it('nothing is queued while no channel is connected (the default until the owner signs up)', async () => {
    push.enabled = false;
    sms.enabled = false;
    try {
      await notifications.notify({ agencyId, userIds: [aideId], type: 'open_shift', title: 'Open shift' });
      const row = await prisma.notification.findFirstOrThrow({ where: { userId: aideId, type: 'open_shift' } });
      expect(row.channels).toEqual(['in_app']);
      expect(await prisma.notificationDelivery.count({ where: { notificationId: row.id } })).toBe(0);
    } finally {
      push.enabled = true;
      sms.enabled = true;
    }
  });
});
