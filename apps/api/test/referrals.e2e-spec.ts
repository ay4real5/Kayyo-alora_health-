import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
type Person = { id: string; auth: { Authorization: string } };

describe.skipIf(!hasDb)('Referrals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  let office: Person;
  let billing: Person;
  let aide: Person;
  let outsider: Person;
  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Referrals ${randomUUID()}`, timezone: 'UTC' } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Referrals other ${randomUUID()}`, timezone: 'UTC' } })).id;
    office = await seedUser('office_staff');
    billing = await seedUser('billing_staff');
    aide = await seedUser('home_health_aide');
    outsider = await seedUser('office_staff', otherAgencyId);
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.notification.deleteMany({ where: { agencyId: id } });
      await prisma.referral.deleteMany({ where: { agencyId: id } }); // events cascade
      await prisma.referralSource.deleteMany({ where: { agencyId: id } });
      await prisma.patient.deleteMany({ where: { agencyId: id } });
      await purgeAuditLogs(prisma, id);
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(roleName: string, inAgency = agencyId): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `ref-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: inAgency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Rae',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { id: user.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  it('moves a referral through the pipeline and admits it as a patient', async () => {
    const source = (await http().post(api('/referrals/sources')).set(office.auth).send({ name: 'Riverside Hospital', sourceType: 'hospital', contactName: 'Dana Planner' }).expect(201)).body.data;
    const created = (
      await http()
        .post(api('/referrals'))
        .set(office.auth)
        .send({ clientFirstName: 'Opal', clientLastName: 'Intake', phone: '804-555-0101', city: 'Richmond', zip: '23220', payerType: 'medicaid', careNeeds: 'Help bathing and meals after a hip replacement', sourceId: source.id, contactName: 'June Intake', contactRelationship: 'daughter', contactPhone: '804-555-0102' })
        .expect(201)
    ).body.data;
    expect(created).toMatchObject({ status: 'new', channel: 'manual', source: { name: 'Riverside Hospital' } });

    await http().post(api(`/referrals/${created.id}/status`)).set(office.auth).send({ status: 'contacted', note: 'Spoke with daughter' }).expect(200);
    await http().post(api(`/referrals/${created.id}/status`)).set(office.auth).send({ status: 'contacted' }).expect(409);
    await http().post(api(`/referrals/${created.id}/notes`)).set(office.auth).send({ note: 'Assessment booked for Tuesday' }).expect(201);
    await http().post(api(`/referrals/${created.id}/status`)).set(office.auth).send({ status: 'admitted' }).expect(400); // only via admit

    const board = (await http().get(api('/referrals/board')).set(office.auth).expect(200)).body.data;
    expect(board.find((c: { status: string }) => c.status === 'contacted').referrals.map((r: { id: string }) => r.id)).toEqual([created.id]);

    // Admission needs a date of birth.
    const noDob = await http().post(api(`/referrals/${created.id}/admit`)).set(office.auth).send({}).expect(400);
    expect(noDob.body.error.message).toContain('date of birth');
    const admitted = (await http().post(api(`/referrals/${created.id}/admit`)).set(office.auth).send({ dateOfBirth: '1941-04-02', state: 'VA' }).expect(200)).body.data;
    expect(admitted.referral).toMatchObject({ status: 'admitted', patientId: admitted.patientId });
    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: admitted.patientId } });
    expect(patient).toMatchObject({ agencyId, firstName: 'Opal', lastName: 'Intake', phoneCell: '804-555-0101', emergencyContactName: 'June Intake', emergencyContactRelation: 'daughter', state: 'VA', status: 'active' });
    await http().post(api(`/referrals/${created.id}/admit`)).set(office.auth).send({ dateOfBirth: '1941-04-02' }).expect(409);
    await http().patch(api(`/referrals/${created.id}`)).set(office.auth).send({ city: 'Henrico' }).expect(409);

    const detail = (await http().get(api(`/referrals/${created.id}`)).set(office.auth).expect(200)).body.data;
    expect(detail.events.map((e: { eventType: string }) => e.eventType)).toEqual(['admitted', 'note', 'status', 'created']);
  });

  it('reports conversion by source', async () => {
    const source = (await http().post(api('/referrals/sources')).set(office.auth).send({ name: 'Dr. Lane Family Practice', sourceType: 'physician' }).expect(201)).body.data;
    for (const name of ['Ann', 'Bea', 'Cal']) {
      const r = (await http().post(api('/referrals')).set(office.auth).send({ clientFirstName: name, clientLastName: 'Source', sourceId: source.id }).expect(201)).body.data;
      if (name === 'Ann') await http().post(api(`/referrals/${r.id}/admit`)).set(office.auth).send({ dateOfBirth: '1950-01-01' }).expect(200);
      if (name === 'Bea') {
        await http().post(api(`/referrals/${r.id}/status`)).set(office.auth).send({ status: 'lost' }).expect(400); // needs a reason
        await http().post(api(`/referrals/${r.id}/status`)).set(office.auth).send({ status: 'lost', lostReason: 'Chose another agency' }).expect(200);
      }
    }
    const report = (await http().get(api('/referrals/sources/report')).set(office.auth).expect(200)).body.data;
    expect(report.rows.find((r: { name: string }) => r.name === 'Dr. Lane Family Practice')).toMatchObject({ referrals: 3, admitted: 1, lost: 1, open: 1, conversionRate: 50 });
  });

  it('accepts the public intake form, alerts the office without PHI, and ignores bots', async () => {
    const form = { submittedBy: 'someone_else', consent: true, clientFirstName: 'Pearl', clientLastName: 'Website', zip: '23220', payerType: 'unknown', careNeeds: 'Mom needs help in the mornings', contactName: 'Sam Website', contactPhone: '804-555-0199' };
    await request(app.getHttpServer()).post(api(`/intake/${agencyId}`)).send(form).expect(202);
    const row = await prisma.referral.findFirstOrThrow({ where: { agencyId, clientLastName: 'Website' } });
    expect(row).toMatchObject({ channel: 'web_form', status: 'new', contactPhone: '804-555-0199' });

    const alert = await prisma.notification.findFirstOrThrow({ where: { agencyId, userId: office.id, type: 'referral_received' } });
    expect(`${alert.title} ${alert.body}`).not.toContain('Pearl');
    expect(await prisma.notification.count({ where: { agencyId, userId: billing.id, type: 'referral_received' } })).toBe(0);

    // Honeypot: looks accepted, stores nothing.
    await http().post(api(`/intake/${agencyId}`)).send({ ...form, clientLastName: 'Robot', website: 'http://spam.example' }).expect(202);
    expect(await prisma.referral.count({ where: { agencyId, clientLastName: 'Robot' } })).toBe(0);
    // Consent and a way to call back are required; unknown agencies are 404.
    await http().post(api(`/intake/${agencyId}`)).send({ ...form, consent: false }).expect(400);
    await http().post(api(`/intake/${agencyId}`)).send({ ...form, contactName: undefined, contactPhone: undefined }).expect(400);
    await http().post(api(`/intake/${randomUUID()}`)).send(form).expect(404);

    // The Command Center counts it.
    const center = (await http().get(api('/insights/command-center')).set(office.auth).expect(200)).body.data;
    expect(center.referrals.newWaiting).toBeGreaterThanOrEqual(1);
    expect(center.attention).toContainEqual(expect.objectContaining({ key: 'referrals_new', link: '/referrals' }));
  });

  it('keeps referrals to people who manage them, within their agency', async () => {
    const r = (await http().post(api('/referrals')).set(office.auth).send({ clientFirstName: 'Iris', clientLastName: 'Private' }).expect(201)).body.data;
    await http().get(api('/referrals')).set(aide.auth).expect(403);
    await http().get(api('/referrals')).set(billing.auth).expect(403);
    await http().get(api(`/referrals/${r.id}`)).set(outsider.auth).expect(404);
    expect((await http().get(api('/referrals?search=Private')).set(outsider.auth).expect(200)).body.meta.total).toBe(0);
    const mine = (await http().get(api('/referrals?status=open&search=Private')).set(office.auth).expect(200)).body;
    expect(mine.meta.total).toBe(1);
    // Assignee and source must be in the same agency.
    await http().patch(api(`/referrals/${r.id}`)).set(office.auth).send({ assignedToId: outsider.id }).expect(400);
    await http().patch(api(`/referrals/${r.id}`)).set(office.auth).send({ assignedToId: office.id, nextFollowUp: '2026-10-01' }).expect(200);
    await http().patch(api(`/referrals/${r.id}`)).set(office.auth).send({ nextFollowUp: null }).expect(200);
  });
});
