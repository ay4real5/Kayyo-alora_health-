import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { todayInTimeZone } from '@alora/shared';
import { AppModule } from '../src/app.module.js';
import { toDate, toTime } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { twilioSignature } from '../src/modules/ivr/twilio.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
// FAKE Twilio settings for this test only — IVR is off unless both are set.
const TOKEN = 'fake-twilio-auth-token';
const BASE = 'https://ivr.example.test';
process.env.TWILIO_AUTH_TOKEN = TOKEN;
process.env.TWILIO_WEBHOOK_BASE_URL = BASE;
const TZ = 'America/New_York';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

describe.skipIf(!hasDb)('Telephony EVV over Twilio webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let visitId: string;
  let staffId: string;
  // A random fake 555 number so parallel dev data can't collide with it.
  const home = `555${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const homeCallerId = `+1${home}`;
  const code = String(randomInt(100_000, 1_000_000));

  /** Posts like Twilio: form-encoded, signed over the full public URL. */
  const call = (path: string, params: Record<string, string>, signature?: string) =>
    request(app.getHttpServer())
      .post(path)
      .type('form')
      .set('X-Twilio-Signature', signature ?? twilioSignature(TOKEN, `${BASE}${path}`, params))
      .send(params);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `IVR Test ${randomUUID()}`, timezone: TZ } })).id;
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `ivr-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Ivy',
        lastName: 'Arr',
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA', ivrCode: code } },
      },
      include: { staffProfile: true },
    });
    staffId = aide.staffProfile!.id;
    const patient = await prisma.patient.create({
      data: {
        agencyId,
        mrn: `IVR-${randomInt(0, 1_000_000)}`,
        firstName: 'Sam',
        lastName: 'Sample',
        dateOfBirth: new Date('1940-01-01T00:00:00Z'),
        status: 'active',
        phoneHome: `(${home.slice(0, 3)}) ${home.slice(3, 6)}-${home.slice(6)}`,
      },
    });
    // A visit around now, in the agency's time zone (kept inside the day).
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    const startMin = Math.max(0, h * 60 + m - 5);
    const endMin = Math.min(23 * 60 + 59, startMin + 60);
    const t = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    visitId = (
      await prisma.visit.create({
        data: {
          agencyId,
          patientId: patient.id,
          staffId,
          visitType: 'home_health_aide',
          status: 'scheduled',
          scheduledDate: toDate(todayInTimeZone(TZ))!,
          scheduledStart: toTime(t(startMin)),
          scheduledEnd: toTime(t(endMin)),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  it('refuses requests Twilio did not sign', async () => {
    await call('/api/v1/ivr/voice', { From: homeCallerId }, 'bogus').expect(403);
    const params = { From: homeCallerId };
    // Signed for another URL (e.g. replayed against a different step) → refused.
    await call('/api/v1/ivr/voice/code?tries=1', params, twilioSignature(TOKEN, `${BASE}/api/v1/ivr/voice`, params)).expect(403);
  });

  it('only a registered patient home phone gets the check-in prompt', async () => {
    const stranger = await call('/api/v1/ivr/voice', { From: '+15550000000' }).expect(200);
    expect(stranger.headers['content-type']).toMatch(/text\/xml/);
    expect(stranger.text).toContain("isn't registered for visit check-in");
    const known = await call('/api/v1/ivr/voice', { From: homeCallerId }).expect(200);
    expect(known.text).toContain('<Gather action="/api/v1/ivr/voice/code?tries=1"');
    expect(known.text).not.toContain('Sample'); // never names the patient
  });

  it('a wrong code gets another try; the right one offers clock-in, then clock-out', async () => {
    const wrong = await call('/api/v1/ivr/voice/code?tries=1', { From: homeCallerId, Digits: '0000' }).expect(200);
    expect(wrong.text).toContain("that code didn't work");
    expect(wrong.text).toContain('action="/api/v1/ivr/voice/code?tries=2"');

    const right = await call('/api/v1/ivr/voice/code?tries=2', { From: homeCallerId, Digits: code }).expect(200);
    const action = `/api/v1/ivr/voice/action?visit=${visitId}&staff=${staffId}`;
    expect(right.text).toContain(`action="${action.replace('&', '&amp;')}"`);
    expect(right.text).toContain('To clock in now, press 1.');

    const clockedIn = await call(action, { From: homeCallerId, Digits: '1' }).expect(200);
    expect(clockedIn.text).toMatch(/You are clocked in at \d{1,2}:\d{2}\s?[AP]M/);
    const record = await prisma.evvRecord.findUniqueOrThrow({ where: { visitId } });
    expect(record).toMatchObject({
      clockInMethod: 'telephony',
      clockInPhoneNumber: homeCallerId,
      clockInLatitude: null,
      clockInWithinGeofence: null,
      status: 'in_progress',
    });
    expect(record.flags).not.toContain('no_patient_location'); // the landline stands in for GPS

    const again = await call('/api/v1/ivr/voice/code?tries=1', { From: homeCallerId, Digits: code }).expect(200);
    expect(again.text).toContain('To clock out now, press 2.');
    const out = await call(action, { From: homeCallerId, Digits: '2' }).expect(200);
    expect(out.text).toContain('You are clocked out at');
    const closed = await prisma.evvRecord.findUniqueOrThrow({ where: { visitId } });
    expect(closed).toMatchObject({ clockOutMethod: 'telephony', clockOutPhoneNumber: homeCallerId });
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe('completed');
    const audit = await prisma.auditLog.findMany({ where: { agencyId, action: { startsWith: 'EVV_CLOCK' } }, select: { action: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(['EVV_CLOCK_IN_BY_PHONE', 'EVV_CLOCK_OUT_BY_PHONE']);

    // Nothing left to do at this home today.
    const done = await call('/api/v1/ivr/voice/code?tries=3', { From: homeCallerId, Digits: code }).expect(200);
    expect(done.text).toContain("couldn't find a visit for you at this home today");
    expect(done.text).toContain('<Hangup/>');
  });
});
