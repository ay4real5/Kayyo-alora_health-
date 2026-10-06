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

describe.skipIf(!hasDb)('Onboarding checklist (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let admin: Person;
  let office: Person;
  let aide: Person;
  const today = utcTodayString();
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1${p}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Onboarding ${randomUUID()}`, timezone: 'UTC' } })).id;
    admin = await seedUser('agency_admin');
    office = await seedUser('office_staff');
    aide = await seedUser('home_health_aide', 'HHA'); // signs in below, so "signed in" is done
  });

  afterAll(async () => {
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } }); // staff profiles, credentials, availability cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, discipline?: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `onb-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Ona',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(discipline ? { staffProfile: { create: { agencyId, discipline } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  it('lists what a new aide is missing, and fills up as the office completes it', async () => {
    const first = (await http().get(api(`/staff/${aide.staffId}/onboarding`)).set(office.auth).expect(200)).body.data;
    // HHA defaults: 7 profile items + 4 credentials = 11 required; only "signed in" is done.
    expect(first).toMatchObject({ percent: 9, ready: false });
    expect(first.items.filter((i: { done: boolean; required: boolean }) => i.required && !i.done).map((i: { key: string }) => i.key)).toEqual([
      'phone',
      'address',
      'hire_date',
      'pay_rate',
      'availability',
      'service_area',
      'credential:hha_certificate',
      'credential:cpr',
      'credential:tb_test',
      'credential:background_check',
    ]);

    await prisma.user.update({ where: { id: aide.id }, data: { phone: '804-555-0110' } });
    await prisma.staffProfile.update({
      where: { id: aide.staffId! },
      data: { addressLine1: '1 Main St', city: 'Richmond', zip: '23220', hireDate: toDate(today), hourlyRate: 18, serviceAreaZipCodes: ['23220'] },
    });
    await prisma.staffAvailability.create({ data: { staffProfileId: aide.staffId!, dayOfWeek: 1, startTime: toTime('08:00'), endTime: toTime('16:00') } });
    for (const t of ['HHA_Certificate', 'cpr', 'TB Test']) {
      await prisma.staffCredential.create({ data: { staffProfileId: aide.staffId!, credentialType: t, credentialName: t } });
    }
    await prisma.staffCredential.create({ data: { staffProfileId: aide.staffId!, credentialType: 'background_check', credentialName: 'Background', expiryDate: toDate(addDays(today, -1)) } });

    const later = (await http().get(api(`/staff/${aide.staffId}/onboarding`)).set(office.auth).expect(200)).body.data;
    expect(later.percent).toBe(91); // 10 of 11 — the background check is expired
    expect(later.items.find((i: { key: string }) => i.key === 'credential:background_check')).toMatchObject({ done: false, detail: expect.stringContaining('expired') });

    // The aide sees their own; the overview lists people least ready first.
    expect((await http().get(api('/staff/me/onboarding')).set(aide.auth).expect(200)).body.data.percent).toBe(91);
    const overview = (await http().get(api('/staff/onboarding')).set(office.auth).expect(200)).body.data;
    expect(overview.find((s: { staffId: string }) => s.staffId === aide.staffId)).toMatchObject({ percent: 91, missing: ['Background check'] });
    const center = (await http().get(api('/insights/command-center')).set(office.auth).expect(200)).body.data;
    expect(center.onboarding.notReady).toBeGreaterThanOrEqual(1);
  });

  it('lets admins change what each discipline needs', async () => {
    const req = (await http().get(api('/staff/onboarding/requirements')).set(office.auth).expect(200)).body.data;
    expect(req.HHA).toEqual(['hha_certificate', 'cpr', 'tb_test', 'background_check']);
    await http().put(api('/staff/onboarding/requirements')).set(office.auth).send({ requirements: { HHA: ['cpr'] } }).expect(403);
    const saved = (await http().put(api('/staff/onboarding/requirements')).set(admin.auth).send({ requirements: { HHA: ['CPR', 'Hha Certificate'] } }).expect(200)).body.data;
    expect(saved.HHA).toEqual(['cpr', 'hha_certificate']);
    expect(saved.RN).toEqual(['license', 'cpr', 'tb_test', 'background_check']); // others keep defaults
    expect((await http().get(api(`/staff/${aide.staffId}/onboarding`)).set(office.auth).expect(200)).body.data).toMatchObject({ percent: 100, ready: true });
    await http().put(api('/staff/onboarding/requirements')).set(admin.auth).send({ requirements: { XYZ: ['cpr'] } }).expect(400);
    await http().get(api(`/staff/${randomUUID()}/onboarding`)).set(office.auth).expect(404);
    await http().get(api('/staff/onboarding')).set(aide.auth).expect(403);
  });
});
