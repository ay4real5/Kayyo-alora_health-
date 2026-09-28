import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
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

/** A tiny FAKE PDF. */
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

describe.skipIf(!hasDb)('Documents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let patientId: string;
  let office: Auth;
  let admin: Auth;
  let rn: Auth;
  let otherRn: Auth;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (
      await prisma.agency.create({ data: { name: `Docs Test ${randomUUID()}`, timezone: 'UTC' } })
    ).id;
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Dot',
          lastName: 'Document',
          dateOfBirth: new Date('1940-01-01T00:00:00Z'),
          status: 'active',
        },
      })
    ).id;
    office = await seedUser('office_staff');
    admin = await seedUser('agency_admin');
    otherRn = await seedUser('registered_nurse');
    // A nurse with a visit to the patient can see (and sign) the patient's documents.
    const role = await prisma.role.findFirstOrThrow({
      where: { agencyId: null, name: 'registered_nurse' },
    });
    const email = `docs-rn-${randomUUID()}@example.test`;
    const nurse = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Rita',
        lastName: 'Nurse',
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId, discipline: 'RN' } },
      },
      include: { staffProfile: true },
    });
    await prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId: nurse.staffProfile!.id,
        visitType: 'home_health_aide',
        scheduledDate: toDate(utcTodayString())!,
        scheduledStart: toTime('09:00'),
        scheduledEnd: toTime('10:00'),
      },
    });
    rn = { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  });

  afterAll(async () => {
    await prisma.document.updateMany({ where: { agencyId }, data: { previousVersionId: null } });
    await prisma.document.deleteMany({ where: { agencyId } }); // blobs cascade
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string): Promise<Auth> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `docs-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Doc',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  const upload = (who: Auth, file: Buffer, name: string, fields: Record<string, string>) => {
    let req = http().post('/api/v1/documents').set(who).attach('file', file, name);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  };

  it('uploads, stores encrypted, and downloads the exact file', async () => {
    const content = pdf('signed consent');
    const res = await upload(office, content, 'Consent Form.pdf', {
      documentType: 'consent',
      title: 'Admission consent',
      patientId,
    }).expect(201);
    const doc = res.body.data;
    expect(doc).toMatchObject({
      fileName: 'Consent Form.pdf',
      mimeType: 'application/pdf',
      version: 1,
      isSigned: false,
      patient: { id: patientId },
    });

    const blob = await prisma.documentBlob.findUniqueOrThrow({ where: { documentId: doc.id } });
    expect(Buffer.from(blob.content).includes(Buffer.from('%PDF'))).toBe(false); // encrypted at rest

    const dl = await http()
      .get(`/api/v1/documents/${doc.id}/download`)
      .set(office)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(dl.body as Buffer, content)).toBe(0);
    expect(dl.headers['content-disposition']).toBe('attachment; filename="Consent Form.pdf"');
    expect(
      await prisma.auditLog.count({ where: { action: 'DOWNLOAD_DOCUMENT', resourceId: doc.id } }),
    ).toBe(1);
  });

  it('refuses files that are not what they claim, missing, or too big', async () => {
    await upload(office, Buffer.from('MZ\x90\x00this is an exe'), 'invoice.pdf', {
      documentType: 'other',
      title: 'x',
    }).expect(415);
    await http()
      .post('/api/v1/documents')
      .set(office)
      .field('documentType', 'other')
      .field('title', 'x')
      .expect(400);
    await upload(office, Buffer.concat([pdf('big'), Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf', {
      documentType: 'other',
      title: 'x',
    }).expect(413);
    await upload(office, pdf('x'), 'x.pdf', { documentType: 'tax_return', title: 'x' }).expect(400);
  });

  it("follows patient access: a nurse sees their patient's documents, not others'", async () => {
    const doc = (
      await upload(office, pdf('care plan'), 'plan.pdf', {
        documentType: 'care_plan',
        title: 'Plan of care',
        patientId,
      }).expect(201)
    ).body.data;
    await http().get(`/api/v1/documents/${doc.id}/download`).set(rn).expect(200);
    await http().get(`/api/v1/documents/${doc.id}`).set(otherRn).expect(404);
    await http().get(`/api/v1/documents?patientId=${patientId}`).set(otherRn).expect(404);
    const all = await http().get('/api/v1/documents').set(otherRn).expect(200);
    expect(all.body.data.map((d: { id: string }) => d.id)).not.toContain(doc.id);
  });

  it('versions: a new upload replaces the old one, history kept, no forks', async () => {
    const v1 = (
      await upload(office, pdf('v1'), 'orders.pdf', {
        documentType: 'physician_order',
        title: 'Orders',
        patientId,
      }).expect(201)
    ).body.data;
    const v2 = (
      await upload(office, pdf('v2'), 'orders-2.pdf', {
        documentType: 'other',
        title: 'Orders (signed copy)',
        replacesDocumentId: v1.id,
      }).expect(201)
    ).body.data;
    expect(v2).toMatchObject({
      version: 2,
      previousVersionId: v1.id,
      documentType: 'physician_order',
      patient: { id: patientId },
    });
    await upload(office, pdf('fork'), 'fork.pdf', {
      documentType: 'other',
      title: 'fork',
      replacesDocumentId: v1.id,
    }).expect(409);

    const list = (
      await http()
        .get(`/api/v1/documents?patientId=${patientId}&documentType=physician_order`)
        .set(office)
        .expect(200)
    ).body.data;
    expect(list.map((d: { id: string }) => d.id)).toEqual([v2.id]);
    const history = (
      await http().get(`/api/v1/documents/${v1.id}/versions`).set(office).expect(200)
    ).body.data;
    expect(
      history.map((d: { version: number; superseded: boolean }) => [d.version, d.superseded]),
    ).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it('e-signature records who, when and the file hash; tampering is caught', async () => {
    const doc = (
      await upload(office, pdf('to sign'), 'sign-me.pdf', {
        documentType: 'consent',
        title: 'Consent',
        patientId,
      }).expect(201)
    ).body.data;
    await http()
      .post(`/api/v1/documents/${doc.id}/sign`)
      .set(office)
      .send({ typedName: 'Office' })
      .expect(403); // no documents:sign
    const signed = (
      await http()
        .post(`/api/v1/documents/${doc.id}/sign`)
        .set(rn)
        .send({ typedName: 'Rita Nurse, RN' })
        .expect(200)
    ).body.data;
    expect(signed).toMatchObject({ isSigned: true, signature: { name: 'Rita Nurse, RN' } });
    await http()
      .post(`/api/v1/documents/${doc.id}/sign`)
      .set(rn)
      .send({ typedName: 'Again' })
      .expect(409);
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect((stored.signatureData as { contentHash: string }).contentHash).toBe(stored.contentHash);

    // If the stored file no longer matches what was uploaded, it is not served.
    await prisma.document.update({ where: { id: doc.id }, data: { contentHash: 'f'.repeat(64) } });
    await http().get(`/api/v1/documents/${doc.id}/download`).set(office).expect(409);
  });

  it('deleting is soft, needs a reason and documents:delete', async () => {
    const doc = (
      await upload(office, pdf('old'), 'old.pdf', {
        documentType: 'other',
        title: 'Old letter',
        patientId,
      }).expect(201)
    ).body.data;
    await http()
      .delete(`/api/v1/documents/${doc.id}`)
      .set(office)
      .send({ reason: 'dup' })
      .expect(403);
    await http().delete(`/api/v1/documents/${doc.id}`).set(admin).send({ reason: '' }).expect(400);
    await http()
      .delete(`/api/v1/documents/${doc.id}`)
      .set(admin)
      .send({ reason: 'Duplicate upload' })
      .expect(204);
    const list = (
      await http().get(`/api/v1/documents?patientId=${patientId}`).set(office).expect(200)
    ).body.data;
    expect(list.map((d: { id: string }) => d.id)).not.toContain(doc.id);
    const withDeleted = (
      await http()
        .get(`/api/v1/documents?patientId=${patientId}&includeDeleted=true`)
        .set(office)
        .expect(200)
    ).body.data;
    expect(withDeleted.find((d: { id: string }) => d.id === doc.id)).toMatchObject({
      deleted: true,
    });
    await http().get(`/api/v1/documents/${doc.id}/download`).set(office).expect(404);
  });
});
