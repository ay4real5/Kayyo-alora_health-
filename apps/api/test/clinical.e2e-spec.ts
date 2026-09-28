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
const noThrottle = {
  increment: async () => ({
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Clinical records (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let patientId: string;
  let physicianId: string;
  let supervisor: { id: string; auth: Auth };
  let rn: { id: string; auth: Auth };
  let hha: { id: string; auth: Auth };
  let outsiderHha: Auth;
  let office: Auth;
  const http = () => request(app.getHttpServer());
  const today = utcTodayString();
  const url = (rest: string) => `/api/v1/patients/${patientId}${rest}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (
      await prisma.agency.create({
        data: { name: `Clinical Test ${randomUUID()}`, timezone: 'UTC' },
      })
    ).id;
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Cleo',
          lastName: 'Clinical',
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
        },
      })
    ).id;
    physicianId = (
      await prisma.physician.create({
        data: { agencyId, firstName: 'Phil', lastName: 'Doctor', npi: '1234567893' },
      })
    ).id;
    supervisor = await seedUser('supervisor');
    office = (await seedUser('office_staff')).auth;
    rn = await caregiver('registered_nurse', 'RN');
    hha = await caregiver('home_health_aide', 'HHA');
    outsiderHha = (await seedUser('home_health_aide')).auth; // no visits with this patient
  });

  afterAll(async () => {
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } }); // clinical records cascade
    await prisma.physician.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `clin-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Cal',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return {
      id: user.id,
      auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` },
    };
  }

  /** A field clinician with a visit to the patient (that's what gives them access). */
  async function caregiver(role: string, discipline: string) {
    const user = await seedUser(role);
    const staff = await prisma.staffProfile.create({
      data: { userId: user.id, agencyId, discipline },
    });
    await prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId: staff.id,
        visitType: discipline === 'RN' ? 'skilled_nursing' : 'home_health_aide',
        scheduledDate: toDate(today)!,
        scheduledStart: toTime('09:00'),
        scheduledEnd: toTime('10:00'),
      },
    });
    return user;
  }

  it('medications: nurses reconcile, aides read, nobody deletes — discontinued stays on record', async () => {
    await http()
      .post(url('/medications'))
      .set(hha.auth)
      .send({ drugName: 'Metformin' })
      .expect(403);
    await http().post(url('/medications')).set(office).send({ drugName: 'Metformin' }).expect(403);
    const med = (
      await http()
        .post(url('/medications'))
        .set(rn.auth)
        .send({
          drugName: 'Metformin',
          dosage: '500 mg',
          frequency: 'twice daily',
          route: 'oral',
          prescribingPhysicianId: physicianId,
          startDate: addDays(today, -30),
        })
        .expect(201)
    ).body.data;
    expect(med).toMatchObject({
      drugName: 'Metformin',
      isActive: true,
      physician: { id: physicianId },
    });
    await http()
      .patch(url(`/medications/${med.id}`))
      .set(rn.auth)
      .send({ dosage: '1000 mg' })
      .expect(200);

    expect(
      (await http().get(url('/medications')).set(hha.auth).expect(200)).body.data,
    ).toHaveLength(1);
    await http().get(url('/medications')).set(outsiderHha).expect(404);

    await http()
      .post(url(`/medications/${med.id}/discontinue`))
      .set(rn.auth)
      .send({ reason: '' })
      .expect(400);
    const stopped = (
      await http()
        .post(url(`/medications/${med.id}/discontinue`))
        .set(rn.auth)
        .send({ reason: 'Changed to insulin' })
        .expect(200)
    ).body.data;
    expect(stopped).toMatchObject({
      isActive: false,
      endDate: today,
      discontinuedReason: 'Changed to insulin',
      dosage: '1000 mg',
    });
    await http()
      .patch(url(`/medications/${med.id}`))
      .set(rn.auth)
      .send({ dosage: '1 mg' })
      .expect(409);
    expect((await http().get(url('/medications')).set(rn.auth).expect(200)).body.data).toHaveLength(
      0,
    );
    expect(
      (await http().get(url('/medications?includeInactive=true')).set(rn.auth).expect(200)).body
        .data,
    ).toHaveLength(1);
  });

  it('physician orders: pending → sent → signed, overdue after 30 days unsigned', async () => {
    const order = (
      await http()
        .post(url('/orders'))
        .set(rn.auth)
        .send({ orderType: 'verbal', description: 'Increase aide visits to 3W4', physicianId })
        .expect(201)
    ).body.data;
    expect(order).toMatchObject({
      status: 'pending',
      orderedDate: today,
      overdue: false,
      takenBy: { id: rn.id },
    });
    await http()
      .post(url('/orders'))
      .set(hha.auth)
      .send({ orderType: 'verbal', description: 'x' })
      .expect(403);

    await http()
      .post(url(`/orders/${order.id}/status`))
      .set(rn.auth)
      .send({ status: 'sent' })
      .expect(200);
    await http()
      .post(url(`/orders/${order.id}/status`))
      .set(rn.auth)
      .send({ status: 'sent' })
      .expect(409);
    const signed = (
      await http()
        .post(url(`/orders/${order.id}/status`))
        .set(rn.auth)
        .send({ status: 'signed' })
        .expect(200)
    ).body.data;
    expect(signed).toMatchObject({ status: 'signed', signedDate: today });
    await http()
      .post(url(`/orders/${order.id}/status`))
      .set(rn.auth)
      .send({ status: 'cancelled' })
      .expect(409);

    const old = (
      await http()
        .post(url('/orders'))
        .set(rn.auth)
        .send({
          orderType: 'medication',
          description: 'Stop aspirin',
          orderedDate: addDays(today, -45),
        })
        .expect(201)
    ).body.data;
    expect(old.overdue).toBe(true);
  });

  it('care plans: versions, only drafts edit, activation supersedes the previous plan', async () => {
    const body = {
      physicianId,
      certificationPeriodStart: today,
      certificationPeriodEnd: addDays(today, 59),
      goals: ['Independent with bathing in 60 days'],
      interventions: [{ discipline: 'HHA', description: 'Assist with personal care' }],
      visitFrequency: [
        { discipline: 'HHA', frequency: '3W8' },
        { discipline: 'RN', frequency: '1W8' },
      ],
    };
    await http().post(url('/care-plans')).set(hha.auth).send(body).expect(403);
    await http()
      .post(url('/care-plans'))
      .set(rn.auth)
      .send({ ...body, visitFrequency: [{ discipline: 'WIZARD', frequency: '1W1' }] })
      .expect(400);
    const v1 = (await http().post(url('/care-plans')).set(rn.auth).send(body).expect(201)).body
      .data;
    expect(v1).toMatchObject({ version: 1, status: 'draft', disciplinesRequired: ['HHA', 'RN'] });

    await http()
      .patch(url(`/care-plans/${v1.id}`))
      .set(rn.auth)
      .send({ goals: ['Walk to the mailbox'] })
      .expect(200);
    await http()
      .post(url(`/care-plans/${v1.id}/activate`))
      .set(rn.auth)
      .send({ physicianSignatureDate: addDays(today, 1) })
      .expect(400);
    const active = (
      await http()
        .post(url(`/care-plans/${v1.id}/activate`))
        .set(rn.auth)
        .send({ physicianSignatureDate: today })
        .expect(200)
    ).body.data;
    expect(active).toMatchObject({ status: 'active', goals: ['Walk to the mailbox'] });
    await http()
      .patch(url(`/care-plans/${v1.id}`))
      .set(rn.auth)
      .send({ goals: ['x'] })
      .expect(409);

    const v2 = (await http().post(url('/care-plans')).set(rn.auth).send(body).expect(201)).body
      .data;
    expect(v2.version).toBe(2);
    await http()
      .post(url(`/care-plans/${v2.id}/activate`))
      .set(supervisor.auth)
      .send({ physicianSignatureDate: today })
      .expect(200);
    const plans = (await http().get(url('/care-plans')).set(hha.auth).expect(200)).body.data;
    expect(plans.map((p: { version: number; status: string }) => [p.version, p.status])).toEqual([
      [2, 'active'],
      [1, 'superseded'],
    ]);
  });

  it('assessments: scored scales, completed by the assessor, approved by someone else', async () => {
    const partial = { historyOfFalling: 'yes', secondaryDiagnosis: 'no' };
    const a = (
      await http()
        .post(url('/assessments'))
        .set(rn.auth)
        .send({ type: 'morse_fall', data: partial })
        .expect(201)
    ).body.data;
    expect(a).toMatchObject({ status: 'draft', score: null, risk: null, assessor: { id: rn.id } });

    const incomplete = await http()
      .post(url(`/assessments/${a.id}/complete`))
      .set(rn.auth)
      .expect(400);
    expect(incomplete.body.error.details).toEqual([
      'ambulatoryAid',
      'ivOrHeparinLock',
      'gait',
      'mentalStatus',
    ]);

    await http()
      .patch(url(`/assessments/${a.id}`))
      .set(supervisor.auth)
      .send({ data: {} })
      .expect(403); // not the assessor
    const full = {
      ...partial,
      ambulatoryAid: 'crutches_cane_walker',
      ivOrHeparinLock: 'no',
      gait: 'weak',
      mentalStatus: 'oriented',
    };
    const updated = (
      await http()
        .patch(url(`/assessments/${a.id}`))
        .set(rn.auth)
        .send({ data: full })
        .expect(200)
    ).body.data;
    expect(updated).toMatchObject({ score: 50, risk: 'high' });
    await http()
      .post(url(`/assessments/${a.id}/complete`))
      .set(rn.auth)
      .expect(200);
    await http()
      .patch(url(`/assessments/${a.id}`))
      .set(rn.auth)
      .send({ data: full })
      .expect(409);

    await http()
      .post(url(`/assessments/${a.id}/approve`))
      .set(rn.auth)
      .send({})
      .expect(403); // RN lacks approve
    const approved = (
      await http()
        .post(url(`/assessments/${a.id}/approve`))
        .set(supervisor.auth)
        .send({ notes: 'Fall plan in place' })
        .expect(200)
    ).body.data;
    expect(approved).toMatchObject({
      status: 'approved',
      qaReviewedBy: { id: supervisor.id },
      qaNotes: 'Fall plan in place',
    });

    // Unscored types just store the form.
    const oasis = (
      await http()
        .post(url('/assessments'))
        .set(rn.auth)
        .send({ type: 'oasis_soc', data: { M1800: '01' } })
        .expect(201)
    ).body.data;
    expect(oasis.score).toBeNull();
    const listed = (await http().get(url('/assessments?type=morse_fall')).set(hha.auth).expect(200))
      .body.data;
    expect(listed.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });
});
