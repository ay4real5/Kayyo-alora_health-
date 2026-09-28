import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { CredentialExpiryJob } from '../src/modules/compliance/credential-expiry.job.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Compliance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let admin: Auth;
  let supervisor: Auth;
  let supervisorId: string;
  let aide: Auth;
  let aideUserId: string;
  let office: Auth;
  let officeId: string;
  let patientId: string;
  const http = () => request(app.getHttpServer());
  const today = utcTodayString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Compliance Test ${randomUUID()}`, timezone: 'UTC' } })).id;
    ({ auth: admin } = await seedUser('agency_admin'));
    ({ auth: supervisor, id: supervisorId } = await seedUser('supervisor'));
    ({ auth: office, id: officeId } = await seedUser('office_staff'));
    ({ auth: aide, id: aideUserId } = await seedUser('home_health_aide', true));
    patientId = (
      await prisma.patient.create({
        data: { agencyId, firstName: 'Ida', lastName: 'Incident', dateOfBirth: new Date('1935-01-01T00:00:00Z'), status: 'active' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.incidentReport.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } }); // staff profiles, credentials cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, withProfile = false) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `comp-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Cora',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(withProfile ? { staffProfile: { create: { agencyId, discipline: 'HHA' } } } : {}),
      },
    });
    return { id: user.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  let incidentId: string;

  it('any caregiver can report an incident; serious ones alert compliance staff without PHI', async () => {
    const res = await http()
      .post('/api/v1/compliance/incidents')
      .set(aide)
      .send({ incidentType: 'fall', severity: 'high', incidentDate: today, incidentTime: '10:15', description: 'Client slipped in the bathroom, no visible injury.', followUpRequired: true })
      .expect(201);
    incidentId = res.body.data.id;
    expect(res.body.data).toMatchObject({ status: 'open', severity: 'high', incidentTime: '10:15', reportedBy: { id: aideUserId } });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: supervisorId, type: 'system' } });
    expect(note.title).toBe('New high incident report');
    expect(`${note.title} ${note.body}`).not.toMatch(/bathroom|slipped/);

    await http().post('/api/v1/compliance/incidents').set(aide).send({ incidentType: 'fall', severity: 'low', incidentDate: addDays(today, 2), description: 'x' }).expect(400);
    await http().post('/api/v1/compliance/incidents').set(aide).send({ incidentType: 'alien', severity: 'low', incidentDate: today, description: 'x' }).expect(400);
    // An aide can report, not browse incidents; nor report about a patient they don't care for.
    await http().get('/api/v1/compliance/incidents').set(aide).expect(403);
    await http().post('/api/v1/compliance/incidents').set(aide).send({ incidentType: 'complaint', severity: 'low', incidentDate: today, description: 'x', patientId }).expect(404);
  });

  it('supervisors investigate, resolve and close incidents; closed ones are final', async () => {
    const list = (await http().get('/api/v1/compliance/incidents?status=open').set(supervisor).expect(200)).body.data;
    expect(list.map((i: { id: string }) => i.id)).toContain(incidentId);
    await http().patch(`/api/v1/compliance/incidents/${incidentId}`).set(supervisor).send({ status: 'investigating', actionsTaken: 'Called family; PT evaluation ordered.' }).expect(200);
    const resolved = (await http().patch(`/api/v1/compliance/incidents/${incidentId}`).set(supervisor).send({ status: 'resolved', followUpNotes: 'Grab bars installed.' }).expect(200)).body.data;
    expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: { id: supervisorId }, followUpNotes: 'Grab bars installed.' });
    expect(resolved.resolvedAt).toBeTruthy();
    await http().patch(`/api/v1/compliance/incidents/${incidentId}`).set(supervisor).send({ status: 'closed' }).expect(200);
    await http().patch(`/api/v1/compliance/incidents/${incidentId}`).set(supervisor).send({ status: 'open' }).expect(409);
  });

  it('the dashboard counts what needs attention', async () => {
    await http().post('/api/v1/compliance/incidents').set(office).send({ incidentType: 'complaint', severity: 'critical', incidentDate: today, description: 'Family complaint about a late visit.', patientId }).expect(201);
    const d = (await http().get('/api/v1/compliance/dashboard').set(supervisor).expect(200)).body.data;
    expect(d.incidents).toEqual({ open: 1, openHighOrCritical: 1, last30Days: 2 });
    expect(d.security.adminsWithout2fa).toBe(0); // the test admin set up 2FA at sign-in
    await http().get('/api/v1/compliance/dashboard').set(office).expect(403);
  });

  it('credential alerts go out once per stage and start again after renewal', async () => {
    const profile = await prisma.staffProfile.findFirstOrThrow({ where: { userId: aideUserId } });
    const credential = await prisma.staffCredential.create({
      data: { staffProfileId: profile.id, credentialType: 'certification', credentialName: 'CPR card', expiryDate: toDate(addDays(today, 20))!, alertDaysBefore: 30 },
    });
    const job = app.get(CredentialExpiryJob);
    expect(await job.run(agencyId)).toBe(1);
    expect(await job.run(agencyId)).toBe(0); // same stage: nothing new
    const notes = await prisma.notification.findMany({ where: { agencyId, type: 'credential_expiry' } });
    expect(notes.map((n) => n.userId).sort()).toEqual([aideUserId, officeId, ...(await managersOtherThan(officeId))].sort());
    expect(notes[0]!.title).toBe('Credential expires in 20 days: CPR card');

    await prisma.staffCredential.update({ where: { id: credential.id }, data: { expiryDate: toDate(addDays(today, -1))! } });
    expect(await job.run(agencyId)).toBe(1); // now expired
    expect(await job.run(agencyId)).toBe(0);

    // Renewing through the API clears the stage, so the next expiry is announced again.
    await http().patch(`/api/v1/staff/${profile.id}/credentials/${credential.id}`).set(office).send({ expiryDate: addDays(today, 5) }).expect(200);
    expect((await prisma.staffCredential.findUniqueOrThrow({ where: { id: credential.id } })).expiryAlertStage).toBeNull();
    expect(await job.run(agencyId)).toBe(1);
  });

  it('admins search the audit log and see the HIPAA checklist', async () => {
    const res = await http().get(`/api/v1/compliance/audit-logs?action=REPORT_INCIDENT&from=${today}&to=${today}`).set(admin).expect(200);
    // Refused attempts are audited too; two reports succeeded.
    const outcomes = res.body.data.map((e: { details: { outcome: string } }) => e.details.outcome);
    expect(outcomes.filter((o: string) => o === 'success')).toHaveLength(2);
    expect(outcomes.filter((o: string) => o === 'error')).toHaveLength(3);
    expect(res.body.data[0]).toMatchObject({ action: 'REPORT_INCIDENT', resourceType: 'incident_reports', user: { firstName: 'Cora' } });
    await http().get('/api/v1/compliance/audit-logs?action=bad action').set(admin).expect(400);
    await http().get('/api/v1/compliance/audit-logs').set(supervisor).expect(403);

    const checklist = (await http().get('/api/v1/compliance/hipaa-checklist').set(admin).expect(200)).body.data;
    expect(checklist.find((c: { item: string }) => c.item.startsWith('Two-factor'))).toMatchObject({ ok: true });
    expect(checklist.find((c: { item: string }) => c.item.startsWith('Business Associate'))).toMatchObject({ ok: false });
  });

  /** Everyone with staff:update gets credential alerts: office staff, supervisor, admin. */
  async function managersOtherThan(excludeId: string): Promise<string[]> {
    const users = await prisma.user.findMany({
      where: { agencyId, id: { not: excludeId }, userRoles: { some: { role: { name: { in: ['supervisor', 'agency_admin'] } } } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
});
