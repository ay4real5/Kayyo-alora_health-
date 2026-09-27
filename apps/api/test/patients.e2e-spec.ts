import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

/** Obviously fake patient data — never real PHI in tests. */
const newPatient = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Testy',
  lastName: `Patient-${randomUUID().slice(0, 8)}`,
  dateOfBirth: '1941-06-15',
  gender: 'female',
  ssn: '123-45-6789',
  phoneHome: '555-010-1000',
  addressLine1: '1 Example Street',
  city: 'Springfield',
  state: 'il',
  zip: '62701',
  medicareBeneficiaryId: '1eg4-te5-mk73'.replaceAll('-', ''),
  ...overrides,
});

describe.skipIf(!hasDb)('Patients (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  let office: { id: string; auth: { Authorization: string } };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Patients Test ${randomUUID()}` } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Patients Other ${randomUUID()}` } })).id;
    office = await seedUser('office_staff');
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.visit.deleteMany({ where: { agencyId: id } });
      await prisma.patient.deleteMany({ where: { agencyId: id } });
      await prisma.physician.deleteMany({ where: { agencyId: id } });
      await prisma.auditLog.deleteMany({ where: { agencyId: id } });
      await prisma.user.deleteMany({ where: { agencyId: id } }); // staff profiles cascade
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(roleName: string, inAgency = agencyId) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `p-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: inAgency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Staff',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const { accessToken } = (await http().post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.data;
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  const admit = async (body = newPatient()) =>
    (await http().post('/api/v1/patients').set(office.auth).send(body).expect(201)).body.data;

  describe('admit and read', () => {
    it('admits a patient, normalises fields, and never returns the SSN', async () => {
      const body = newPatient();
      const res = await http().post('/api/v1/patients').set(office.auth).send(body).expect(201);
      const patient = res.body.data;

      expect(patient).toMatchObject({
        firstName: 'Testy',
        dateOfBirth: '1941-06-15',
        status: 'active',
        state: 'IL',
        ssnLast4: '6789',
        geoFenceRadiusMeters: 200,
        medicareBeneficiaryId: '1EG4TE5MK73',
        diagnoses: [],
        allergies: [],
      });
      expect(patient.admissionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(JSON.stringify(res.body)).not.toContain('123-45-6789');
      expect(JSON.stringify(res.body)).not.toContain('123456789');
      expect(patient).not.toHaveProperty('ssnEncrypted');

      // Stored encrypted, not in the clear.
      const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(Buffer.from(stored.ssnEncrypted!).toString('latin1')).not.toContain('123456789');
      expect(await prisma.auditLog.count({ where: { action: 'ADMIT_PATIENT', resourceId: patient.id } })).toBe(1);
    });

    it('validates input', async () => {
      const bad = [
        { dateOfBirth: '2999-01-01' },
        { dateOfBirth: '1950-02-30' },
        { ssn: '000-12-3456' },
        { ssn: '666-12-3456' },
        { state: 'Illinois' },
        { zip: '1234' },
        { medicareBeneficiaryId: 'NOT-AN-MBI' },
        { geoFenceRadiusMeters: 5 },
        { gender: 'robot' },
        { isAdmin: true },
      ];
      for (const override of bad) {
        await http().post('/api/v1/patients').set(office.auth).send(newPatient(override)).expect(400);
      }
    });

    it('lists with search, status filter and pagination; gets the detail', async () => {
      const a = await admit(newPatient({ lastName: `Zeta-${randomUUID().slice(0, 6)}`, mrn: `MRN-${randomUUID().slice(0, 6)}` }));
      const list = await http().get(`/api/v1/patients?search=${a.lastName.slice(0, 9)}`).set(office.auth).expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toContain(a.id);
      expect(list.body.data[0]).not.toHaveProperty('ssnLast4'); // summaries carry no identifiers beyond MRN

      const byMrn = await http().get(`/api/v1/patients?search=${a.mrn.toLowerCase()}`).set(office.auth).expect(200);
      expect(byMrn.body.data).toHaveLength(1);

      const detail = await http().get(`/api/v1/patients/${a.id}`).set(office.auth).expect(200);
      expect(detail.body.data.ssnLast4).toBe('6789');
    });

    it('keeps MRNs unique within an agency', async () => {
      const mrn = `DUP-${randomUUID().slice(0, 6)}`;
      await admit(newPatient({ mrn }));
      const dup = await http().post('/api/v1/patients').set(office.auth).send(newPatient({ mrn })).expect(409);
      expect(dup.body.error.message).toMatch(/MRN/);
    });
  });

  describe('who can see which patients', () => {
    it("hides other agencies' patients completely", async () => {
      const otherOffice = await seedUser('office_staff', otherAgencyId);
      const theirs = (await http().post('/api/v1/patients').set(otherOffice.auth).send(newPatient()).expect(201)).body.data;
      await http().get(`/api/v1/patients/${theirs.id}`).set(office.auth).expect(404);
      await http().patch(`/api/v1/patients/${theirs.id}`).set(office.auth).send({ city: 'X' }).expect(404);
      const list = await http().get('/api/v1/patients?limit=100').set(office.auth).expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(theirs.id);
    });

    it('shows field staff only the patients they have visits with', async () => {
      const nurse = await seedUser('registered_nurse');
      const staff = await prisma.staffProfile.create({
        data: { userId: nurse.id, agencyId, discipline: 'RN' },
      });
      const mine = await admit();
      const notMine = await admit();
      await prisma.visit.create({
        data: {
          agencyId,
          patientId: mine.id,
          staffId: staff.id,
          visitType: 'skilled_nursing',
          scheduledDate: new Date('2026-10-01T00:00:00Z'),
          scheduledStart: new Date('1970-01-01T09:00:00Z'),
          scheduledEnd: new Date('1970-01-01T10:00:00Z'),
        },
      });

      const list = await http().get('/api/v1/patients?limit=100').set(nurse.auth).expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([mine.id]);
      await http().get(`/api/v1/patients/${mine.id}`).set(nurse.auth).expect(200);
      await http().get(`/api/v1/patients/${notMine.id}`).set(nurse.auth).expect(404);
      await http().patch(`/api/v1/patients/${mine.id}`).set(nurse.auth).send({ city: 'X' }).expect(403); // read-only role
    });

    it('lets billing staff read all patients but not change them', async () => {
      const biller = await seedUser('billing_staff');
      const p = await admit();
      await http().get(`/api/v1/patients/${p.id}`).set(biller.auth).expect(200);
      await http().post('/api/v1/patients').set(biller.auth).send(newPatient()).expect(403);
    });
  });

  describe('updates and lifecycle', () => {
    it('updates fields, re-encrypts a changed SSN, and rejects a physician from another agency', async () => {
      const p = await admit();
      const res = await http()
        .patch(`/api/v1/patients/${p.id}`)
        .set(office.auth)
        .send({ city: 'Shelbyville', ssn: '234-56-7890' })
        .expect(200);
      expect(res.body.data).toMatchObject({ city: 'Shelbyville', ssnLast4: '7890', firstName: 'Testy' });

      const foreignDoc = await prisma.physician.create({ data: { agencyId: otherAgencyId, firstName: 'Doc', lastName: 'Other' } });
      await http().patch(`/api/v1/patients/${p.id}`).set(office.auth).send({ primaryPhysicianId: foreignDoc.id }).expect(400);
      const ownDoc = await prisma.physician.create({ data: { agencyId, firstName: 'Doc', lastName: 'Own' } });
      await http().patch(`/api/v1/patients/${p.id}`).set(office.auth).send({ primaryPhysicianId: ownDoc.id }).expect(200);
    });

    it('discharges and readmits with date rules', async () => {
      const p = await admit(newPatient({ admissionDate: '2026-01-10' }));
      await http().post(`/api/v1/patients/${p.id}/discharge`).set(office.auth).send({ dischargeDate: '2026-01-01' }).expect(400);

      const discharged = await http()
        .post(`/api/v1/patients/${p.id}/discharge`)
        .set(office.auth)
        .send({ dischargeDate: '2026-02-01' })
        .expect(200);
      expect(discharged.body.data).toMatchObject({ status: 'discharged', dischargeDate: '2026-02-01' });
      await http().post(`/api/v1/patients/${p.id}/discharge`).set(office.auth).send({}).expect(409);

      const onlyActive = await http().get('/api/v1/patients?status=discharged&limit=100').set(office.auth).expect(200);
      expect(onlyActive.body.data.map((x: { id: string }) => x.id)).toContain(p.id);

      const readmitted = await http().post(`/api/v1/patients/${p.id}/readmit`).set(office.auth).send({}).expect(200);
      expect(readmitted.body.data).toMatchObject({ status: 'active', dischargeDate: null });
      await http().post(`/api/v1/patients/${p.id}/readmit`).set(office.auth).send({}).expect(409);
    });

    it('status cannot be changed by PATCH', async () => {
      const p = await admit();
      await http().patch(`/api/v1/patients/${p.id}`).set(office.auth).send({ status: 'discharged' }).expect(400);
    });
  });

  describe('diagnoses and allergies', () => {
    it('normalises ICD-10 codes, keeps a single primary, and removes', async () => {
      const p = await admit();
      const add = (body: object) => http().post(`/api/v1/patients/${p.id}/diagnoses`).set(office.auth).send(body);

      const first = (await add({ icd10Code: 'e119', description: 'Type 2 diabetes', isPrimary: true }).expect(201)).body.data;
      expect(first).toMatchObject({ icd10Code: 'E11.9', isPrimary: true, sequenceOrder: 1 });
      const second = (await add({ icd10Code: 'I10', isPrimary: true }).expect(201)).body.data;
      expect(second.sequenceOrder).toBe(2);
      await add({ icd10Code: 'not-a-code' }).expect(400);

      const list = (await http().get(`/api/v1/patients/${p.id}/diagnoses`).set(office.auth).expect(200)).body.data;
      expect(list.filter((d: { isPrimary: boolean }) => d.isPrimary).map((d: { icd10Code: string }) => d.icd10Code)).toEqual(['I10']);

      await http().delete(`/api/v1/patients/${p.id}/diagnoses/${first.id}`).set(office.auth).expect(204);
      await http().delete(`/api/v1/patients/${p.id}/diagnoses/${first.id}`).set(office.auth).expect(404);
    });

    it('adds, lists and removes allergies', async () => {
      const p = await admit();
      const allergy = (
        await http()
          .post(`/api/v1/patients/${p.id}/allergies`)
          .set(office.auth)
          .send({ allergen: 'Penicillin', reaction: 'Hives', severity: 'moderate' })
          .expect(201)
      ).body.data;
      await http().post(`/api/v1/patients/${p.id}/allergies`).set(office.auth).send({ allergen: 'X', severity: 'deadly' }).expect(400);

      const detail = (await http().get(`/api/v1/patients/${p.id}`).set(office.auth).expect(200)).body.data;
      expect(detail.allergies).toEqual([{ id: allergy.id, allergen: 'Penicillin', reaction: 'Hives', severity: 'moderate' }]);

      await http().delete(`/api/v1/patients/${p.id}/allergies/${allergy.id}`).set(office.auth).expect(204);
    });

    it("cannot touch another patient's diagnosis through a different patient's URL", async () => {
      const a = await admit();
      const b = await admit();
      const d = (await http().post(`/api/v1/patients/${a.id}/diagnoses`).set(office.auth).send({ icd10Code: 'I10' })).body.data;
      await http().delete(`/api/v1/patients/${b.id}/diagnoses/${d.id}`).set(office.auth).expect(404);
    });
  });

  it('keeps PHI out of the audit trail', async () => {
    const logs = await prisma.auditLog.findMany({ where: { agencyId } });
    const text = JSON.stringify(logs.map(({ details }) => details));
    for (const phi of ['123-45-6789', 'Testy', 'Penicillin', 'Springfield', '1941-06-15']) {
      expect(text).not.toContain(phi);
    }
  });
});
