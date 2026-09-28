import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
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

describe.skipIf(!hasDb)('Visit documentation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  let supervisor: { id: string; auth: Auth };
  let office: Auth;
  let patientId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Docs Test ${randomUUID()}` } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Docs Other ${randomUUID()}` } }))
      .id;
    supervisor = await seedUser('supervisor');
    office = (await seedUser('office_staff')).auth;
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Pat',
          lastName: `Documented-${randomUUID().slice(0, 6)}`,
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
          admissionDate: new Date('2025-01-01T00:00:00Z'),
        },
      })
    ).id;
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.visit.deleteMany({ where: { agencyId: id } }); // notes, vitals, tasks cascade
      await prisma.patient.deleteMany({ where: { agencyId: id } });
      await purgeAuditLogs(prisma, id);
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(roleName: string, inAgency = agencyId) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `docs-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: inAgency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Dee',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const accessToken = await loginForTests(http(), email, PASSWORD);
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  async function caregiver(role = 'home_health_aide', discipline = 'HHA') {
    const user = await seedUser(role);
    const staff = await prisma.staffProfile.create({
      data: { userId: user.id, agencyId, discipline },
    });
    return { ...user, staffId: staff.id };
  }

  async function seedVisit(staffId: string, status = 'in_progress') {
    const v = await prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId,
        visitType: 'home_health_aide',
        status,
        scheduledDate: toDate(utcTodayString())!,
        scheduledStart: toTime('10:00'),
        scheduledEnd: toTime('11:00'),
      },
    });
    return v.id;
  }

  const url = (visitId: string, rest = '') => `/api/v1/schedule/visits/${visitId}${rest}`;

  describe('notes', () => {
    it('a nurse drafts, edits and signs a note; it is then locked and amended by addendum', async () => {
      const rn = await caregiver('registered_nurse', 'RN');
      const visitId = await seedVisit(rn.staffId);

      const created = await http()
        .post(url(visitId, '/notes'))
        .set(rn.auth)
        .send({
          noteType: 'skilled_nursing',
          subjective: 'Feels better today.',
          formData: { woundCare: true },
        })
        .expect(201);
      const note = created.body.data;
      expect(note).toMatchObject({
        status: 'draft',
        author: { id: rn.id },
        formData: { woundCare: true },
      });
      expect(
        await prisma.auditLog.count({
          where: { action: 'CREATE_VISIT_NOTE', resourceId: visitId },
        }),
      ).toBe(1);

      const edited = await http()
        .patch(url(visitId, `/notes/${note.id}`))
        .set(rn.auth)
        .send({ assessment: 'Wound healing well.', subjective: '' })
        .expect(200);
      expect(edited.body.data).toMatchObject({
        subjective: null,
        assessment: 'Wound healing well.',
      });

      const signed = await http()
        .post(url(visitId, `/notes/${note.id}/sign`))
        .set(rn.auth)
        .expect(200);
      expect(signed.body.data).toMatchObject({ status: 'signed', signedById: rn.id });
      expect(signed.body.data.signedAt).toBeTruthy();

      await http()
        .patch(url(visitId, `/notes/${note.id}`))
        .set(rn.auth)
        .send({ plan: 'x' })
        .expect(409);
      await http()
        .delete(url(visitId, `/notes/${note.id}`))
        .set(rn.auth)
        .expect(409);
      await http()
        .post(url(visitId, `/notes/${note.id}/sign`))
        .set(rn.auth)
        .expect(409);

      await http()
        .post(url(visitId, '/notes'))
        .set(rn.auth)
        .send({ noteType: 'addendum', narrative: 'x' })
        .expect(400);
      await http()
        .post(url(visitId, '/notes'))
        .set(rn.auth)
        .send({ noteType: 'progress', amendsNoteId: note.id, narrative: 'x' })
        .expect(400);
      const addendum = await http()
        .post(url(visitId, '/notes'))
        .set(rn.auth)
        .send({
          noteType: 'addendum',
          amendsNoteId: note.id,
          narrative: 'Correction: left heel, not right.',
        })
        .expect(201);
      expect(addendum.body.data.amendsNoteId).toBe(note.id);

      const list = await http().get(url(visitId, '/notes')).set(supervisor.auth).expect(200);
      expect(list.body.data.map((n: { id: string }) => n.id)).toEqual([
        note.id,
        addendum.body.data.id,
      ]);
    });

    it("aides submit rather than sign; empty notes can't be finalised; drafts can be discarded", async () => {
      const hha = await caregiver();
      const visitId = await seedVisit(hha.staffId);
      const note = (
        await http()
          .post(url(visitId, '/notes'))
          .set(hha.auth)
          .send({ noteType: 'aide_activity' })
          .expect(201)
      ).body.data;

      await http()
        .post(url(visitId, `/notes/${note.id}/sign`))
        .set(hha.auth)
        .expect(403); // no visit_notes:sign
      await http()
        .post(url(visitId, `/notes/${note.id}/submit`))
        .set(hha.auth)
        .expect(400); // empty
      await http()
        .patch(url(visitId, `/notes/${note.id}`))
        .set(hha.auth)
        .send({ narrative: 'Bathed, lunch.' })
        .expect(200);
      const submitted = await http()
        .post(url(visitId, `/notes/${note.id}/submit`))
        .set(hha.auth)
        .expect(200);
      expect(submitted.body.data).toMatchObject({ status: 'submitted', signedAt: null });
      expect(submitted.body.data.submittedAt).toBeTruthy();

      const draft = (
        await http()
          .post(url(visitId, '/notes'))
          .set(hha.auth)
          .send({ noteType: 'aide_activity', narrative: 'oops' })
          .expect(201)
      ).body.data;
      await http()
        .delete(url(visitId, `/notes/${draft.id}`))
        .set(hha.auth)
        .expect(204);
      expect(await prisma.visitNote.count({ where: { visitId } })).toBe(1);
    });

    it("only the visit's caregiver writes, only after clock-in; others can't touch the note", async () => {
      const hha = await caregiver();
      const other = await caregiver();
      const scheduled = await seedVisit(hha.staffId, 'scheduled');
      await http()
        .post(url(scheduled, '/notes'))
        .set(hha.auth)
        .send({ noteType: 'aide_activity' })
        .expect(409);
      const cancelled = await seedVisit(hha.staffId, 'cancelled');
      await http()
        .post(url(cancelled, '/notes'))
        .set(hha.auth)
        .send({ noteType: 'aide_activity' })
        .expect(409);

      const visitId = await seedVisit(hha.staffId);
      await http()
        .post(url(visitId, '/notes'))
        .set(other.auth)
        .send({ noteType: 'aide_activity' })
        .expect(404);
      await http().get(url(visitId, '/notes')).set(other.auth).expect(404);
      await http()
        .post(url(visitId, '/notes'))
        .set(supervisor.auth)
        .send({ noteType: 'progress' })
        .expect(403);
      await http()
        .post(url(visitId, '/notes'))
        .set(office)
        .send({ noteType: 'progress' })
        .expect(403);
      await http()
        .post(url(visitId, '/notes'))
        .set(hha.auth)
        .send({ noteType: 'essay' })
        .expect(400);

      const note = (
        await http()
          .post(url(visitId, '/notes'))
          .set(hha.auth)
          .send({ noteType: 'aide_activity', narrative: 'x' })
          .expect(201)
      ).body.data;
      await http()
        .patch(url(visitId, `/notes/${note.id}`))
        .set(supervisor.auth)
        .send({ narrative: 'y' })
        .expect(403);
      const outsider = await seedUser('agency_admin', otherAgencyId);
      await http().get(url(visitId, '/notes')).set(outsider.auth).expect(404);
    });
  });

  describe('vitals', () => {
    it('records vitals with range checks, and marks mistakes instead of editing them', async () => {
      const rn = await caregiver('registered_nurse', 'RN');
      const visitId = await seedVisit(rn.staffId);
      const post = (body: Record<string, unknown>) =>
        http().post(url(visitId, '/vitals')).set(rn.auth).send(body);

      await post({}).expect(400); // nothing measured
      await post({ bloodPressureSystolic: 120 }).expect(400); // half a BP
      await post({ bloodPressureSystolic: 80, bloodPressureDiastolic: 90 }).expect(400);
      await post({ heartRate: 400 }).expect(400);
      await post({ temperature: 98.6, temperatureUnit: 'C' }).expect(400);
      await post({
        heartRate: 70,
        recordedAt: new Date(Date.now() + 3_600_000).toISOString(),
      }).expect(400);

      const ok = await post({
        bloodPressureSystolic: 128,
        bloodPressureDiastolic: 82,
        heartRate: 72,
        temperature: 98.6,
        oxygenSaturation: 97.5,
        painLevel: 2,
      }).expect(201);
      expect(ok.body.data).toMatchObject({
        bloodPressureSystolic: 128,
        temperature: 98.6,
        temperatureUnit: 'F',
        oxygenSaturation: 97.5,
        recordedById: rn.id,
        enteredInError: null,
      });
      const celsius = await post({ temperature: 37.2, temperatureUnit: 'C' }).expect(201);

      await http()
        .post(url(visitId, `/vitals/${celsius.body.data.id}/entered-in-error`))
        .set(rn.auth)
        .send({ reason: '' })
        .expect(400);
      const marked = await http()
        .post(url(visitId, `/vitals/${celsius.body.data.id}/entered-in-error`))
        .set(supervisor.auth)
        .send({ reason: 'Wrong patient' })
        .expect(200);
      expect(marked.body.data.enteredInError).toMatchObject({
        byId: supervisor.id,
        reason: 'Wrong patient',
      });
      await http()
        .post(url(visitId, `/vitals/${celsius.body.data.id}/entered-in-error`))
        .set(rn.auth)
        .send({ reason: 'again' })
        .expect(409);

      const list = await http().get(url(visitId, '/vitals')).set(rn.auth).expect(200);
      expect(list.body.data).toHaveLength(2); // the marked entry stays visible
    });
  });

  describe('tasks', () => {
    it('the office sets up a checklist; the caregiver records done / not done / undo', async () => {
      const hha = await caregiver();
      const visitId = await seedVisit(hha.staffId, 'scheduled');

      await http().post(url(visitId, '/tasks')).set(office).send({ tasks: [] }).expect(400);
      await http()
        .post(url(visitId, '/tasks'))
        .set(hha.auth)
        .send({ tasks: [{ taskName: 'Bath' }] })
        .expect(403);
      const added = await http()
        .post(url(visitId, '/tasks'))
        .set(office)
        .send({
          tasks: [
            { taskName: 'Assist with bath' },
            { taskName: 'Prepare lunch', description: 'Low sodium' },
          ],
        })
        .expect(201);
      expect(
        added.body.data.map((t: { taskName: string; state: string }) => [t.taskName, t.state]),
      ).toEqual([
        ['Assist with bath', 'open'],
        ['Prepare lunch', 'open'],
      ]);
      const more = await http()
        .post(url(visitId, '/tasks'))
        .set(office)
        .send({ tasks: [{ taskName: 'Walk' }] })
        .expect(201);
      const [bath, lunch, walk] = more.body.data;
      expect(walk.sortOrder).toBe(2);

      const patch = (taskId: string, body: Record<string, unknown>) =>
        http()
          .patch(url(visitId, `/tasks/${taskId}`))
          .set(hha.auth)
          .send(body);
      await patch(bath.id, { completed: true }).expect(409); // not clocked in yet
      await prisma.visit.update({ where: { id: visitId }, data: { status: 'in_progress' } });

      expect((await patch(bath.id, { completed: true }).expect(200)).body.data).toMatchObject({
        state: 'done',
        completedById: hha.id,
      });
      await patch(lunch.id, { completed: true, notDoneReason: 'x' }).expect(400);
      expect(
        (await patch(lunch.id, { completed: false, notDoneReason: 'Patient declined' }).expect(200))
          .body.data,
      ).toMatchObject({
        state: 'not_done',
        notDoneReason: 'Patient declined',
      });
      expect((await patch(lunch.id, { completed: false }).expect(200)).body.data).toMatchObject({
        state: 'open',
        completedById: null,
        completedAt: null,
      });

      await http()
        .delete(url(visitId, `/tasks/${bath.id}`))
        .set(office)
        .expect(409); // already recorded
      await http()
        .delete(url(visitId, `/tasks/${walk.id}`))
        .set(office)
        .expect(204);
      const list = await http().get(url(visitId, '/tasks')).set(hha.auth).expect(200);
      expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([bath.id, lunch.id]);

      await prisma.visit.update({ where: { id: visitId }, data: { status: 'completed' } });
      await http()
        .post(url(visitId, '/tasks'))
        .set(office)
        .send({ tasks: [{ taskName: 'Late' }] })
        .expect(409);
    });
  });
});
