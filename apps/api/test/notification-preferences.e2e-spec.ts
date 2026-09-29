import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { NOTIFICATION_TYPES } from '@alora/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

describe.skipIf(!hasDb)('Notification preferences (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let userId: string;
  let otherId: string;
  let auth: { Authorization: string };
  const http = () => request(app.getHttpServer());
  const base = '/api/v1/notifications/preferences';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Prefs Test ${randomUUID()}`, timezone: 'UTC' } })).id;
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const make = async () => {
      const email = `prefs-${randomUUID()}@example.test`;
      const u = await prisma.user.create({
        data: { agencyId, email, passwordHash: await app.get(PasswordService).hash(PASSWORD), passwordChangedAt: new Date(), firstName: 'Nia', lastName: 'Note', userRoles: { create: { roleId: role.id } } },
      });
      return { id: u.id, email };
    };
    const me = await make();
    userId = me.id;
    otherId = (await make()).id;
    auth = { Authorization: `Bearer ${await loginForTests(http(), me.email, PASSWORD)}` };
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } }); // preferences cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  it('lists every type: in-app on by default, outside channels per type (DESIGN §13.2); system alerts are mandatory', async () => {
    const prefs = (await http().get(base).set(auth).expect(200)).body.data;
    expect(prefs).toHaveLength(NOTIFICATION_TYPES.length);
    expect(prefs.find((p: { type: string }) => p.type === 'shift_assigned')).toEqual({ type: 'shift_assigned', mandatory: false, inApp: true, push: true, sms: true, email: false });
    expect(prefs.find((p: { type: string }) => p.type === 'payroll_ready')).toMatchObject({ push: false, sms: false, email: true });
    expect(prefs.find((p: { type: string }) => p.type === 'system')).toMatchObject({ mandatory: true, inApp: true });
  });

  it('changes only the channels sent, and refuses to mute mandatory or unknown types', async () => {
    const prefs = (await http().put(`${base}/shift_assigned`).set(auth).send({ inApp: false, sms: false }).expect(200)).body.data;
    expect(prefs.find((p: { type: string }) => p.type === 'shift_assigned')).toMatchObject({ inApp: false, sms: false, push: true, email: false });
    const again = (await http().put(`${base}/shift_assigned`).set(auth).send({ push: false }).expect(200)).body.data;
    expect(again.find((p: { type: string }) => p.type === 'shift_assigned')).toMatchObject({ inApp: false, sms: false, push: false });
    await http().put(`${base}/system`).set(auth).send({ inApp: false }).expect(400);
    await http().put(`${base}/not_a_type`).set(auth).send({ inApp: false }).expect(400);
    await http().put(`${base}/shift_assigned`).set(auth).send({ inApp: 'nope' }).expect(400);
  });

  it('muted alerts are not delivered in the app; others and mandatory ones still are', async () => {
    const notifications = app.get(NotificationsService);
    await notifications.notify({ agencyId, userIds: [userId, otherId], type: 'shift_assigned', title: 'New shift' });
    await notifications.notify({ agencyId, userIds: [userId], type: 'shift_cancelled', title: 'Shift cancelled' });
    await notifications.notify({ agencyId, userIds: [userId], type: 'system', title: 'Serious incident' });
    const mine = await prisma.notification.findMany({ where: { userId }, select: { type: true } });
    expect(mine.map((n) => n.type).sort()).toEqual(['shift_cancelled', 'system']);
    expect(await prisma.notification.count({ where: { userId: otherId, type: 'shift_assigned' } })).toBe(1); // only the caller muted it
  });
});
