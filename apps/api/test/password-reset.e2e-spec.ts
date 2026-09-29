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
import { PasswordResetService } from '../src/modules/auth/password-reset.service.js';
import { EmailSender, type SendOutcome } from '../src/modules/notifications/delivery/senders.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
// The reset link points at the dashboard; CI doesn't set this.
process.env.FRONTEND_URL ??= 'http://localhost:3000';
const OLD = 'Correct-Horse-9!';
const NEW = 'Battery-Staple-7?';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
/** A "connected" email provider that keeps what it would send. Nothing leaves the machine. */
const email = {
  channel: 'email',
  enabled: true,
  send: vi.fn(async (): Promise<SendOutcome> => ({ ok: true, providerMessageId: 'x' })),
  sendText: vi.fn(async (_to: string, _subject: string, _text: string): Promise<SendOutcome> => ({ ok: true, providerMessageId: 'x' })),
};
const linkToken = () => /#token=([A-Za-z0-9_-]{43})/.exec(email.sendText.mock.calls.at(-1)![2])![1]!;

describe.skipIf(!hasDb)('Forgot / reset password (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let resets: PasswordResetService;
  let agencyId: string;
  let userId: string;
  const address = `reset-${randomUUID()}@example.test`;
  const http = () => request(app.getHttpServer());
  const client = { ipAddress: '127.0.0.1', userAgent: 'test' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .overrideProvider(EmailSender)
      .useValue(email)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    resets = app.get(PasswordResetService);
    agencyId = (await prisma.agency.create({ data: { name: `Reset Test ${randomUUID()}`, timezone: 'UTC' } })).id;
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    userId = (
      await prisma.user.create({
        data: {
          agencyId,
          email: address,
          passwordHash: await app.get(PasswordService).hash(OLD),
          passwordChangedAt: new Date(),
          firstName: 'Rae',
          lastName: 'Set',
          failedLoginAttempts: 5,
          lockedUntil: new Date(Date.now() + 3_600_000), // locked out — a reset unlocks
          userRoles: { create: { roleId: role.id } },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } }); // reset tokens cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  it('answers the same for known and unknown addresses, and emails a single-use link to the known one', async () => {
    const known = await http().post('/api/v1/auth/forgot-password').send({ email: address.toUpperCase() }).expect(200);
    const unknown = await http().post('/api/v1/auth/forgot-password').send({ email: `nobody-${randomUUID()}@example.test` }).expect(200);
    expect(known.body.data).toEqual({ accepted: true, emailAvailable: true });
    expect(unknown.body.data).toEqual(known.body.data);
    await vi.waitFor(() => expect(email.sendText).toHaveBeenCalledTimes(1), { timeout: 10_000 }); // sent in the background
    const [to, subject, text] = email.sendText.mock.calls[0]!;
    expect([to, subject]).toEqual([address, 'Reset your Primordial Health password']);
    // The token is in the fragment (#), which browsers never send to a server — so it can't land in any log.
    expect(text).toMatch(/^http:\/\/localhost:3000\/reset-password#token=[A-Za-z0-9_-]{43}$/m);
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
    expect(stored.tokenHash).not.toContain(linkToken()); // only a hash is kept
  });

  it('the link sets a new password once, unlocks the account and ends every session', async () => {
    const token = linkToken();
    await http().post('/api/v1/auth/reset-password').send({ token, newPassword: 'weak' }).expect(400);
    await http().post('/api/v1/auth/reset-password').send({ token, newPassword: NEW }).expect(200);
    await http().post('/api/v1/auth/reset-password').send({ token, newPassword: 'Another-Pass-5!' }).expect(400); // used
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });
    await loginForTests(http(), address, NEW);
    await http().post('/api/v1/auth/login').send({ email: address, password: OLD }).expect(401);
    const actions = await prisma.auditLog.findMany({ where: { agencyId, action: { startsWith: 'PASSWORD_RESET' } }, select: { action: true } });
    expect(actions.map((a) => a.action).sort()).toEqual(['PASSWORD_RESET', 'PASSWORD_RESET_REQUESTED']);
  });

  it('only the newest link works, links expire, and nothing is sent to inactive accounts', async () => {
    const now = new Date();
    await resets.sendLink(address, client, now);
    const first = linkToken();
    await resets.sendLink(address, client, now);
    const second = linkToken();
    await expect(resets.reset(first, 'Brand-New-Pass-1!', client, now)).rejects.toThrow(/invalid or has expired/);
    const later = new Date(now.getTime() + 31 * 60_000);
    await expect(resets.reset(second, 'Brand-New-Pass-1!', client, later)).rejects.toThrow(/invalid or has expired/);

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    const calls = email.sendText.mock.calls.length;
    await resets.sendLink(address, client);
    expect(email.sendText.mock.calls.length).toBe(calls);
  });

  it('with no email provider connected, nothing is sent and the page can say so', async () => {
    email.enabled = false;
    try {
      const res = await http().post('/api/v1/auth/forgot-password').send({ email: address }).expect(200);
      expect(res.body.data).toEqual({ accepted: true, emailAvailable: false });
    } finally {
      email.enabled = true;
    }
  });
});
