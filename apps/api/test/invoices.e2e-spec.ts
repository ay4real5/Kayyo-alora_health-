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
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };

describe.skipIf(!hasDb)('Private-pay invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let billing: Auth;
  let office: Auth;
  let patientId: string;
  let staffId: string;
  let authorId: string;
  const http = () => request(app.getHttpServer());
  const day = addDays(utcTodayString(), -6);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    const npi = String(Math.floor(1e9 + Math.random() * 9e9));
    agencyId = (
      await prisma.agency.create({
        data: { name: `Invoice Test ${randomUUID()}`, timezone: 'UTC', npi, addressLine1: '1 Test Way', city: 'Richmond', state: 'VA', zip: '23219' },
      })
    ).id;
    billing = await seedUser('billing_staff');
    office = await seedUser('office_staff');

    const payer = await prisma.payer.create({ data: { agencyId, name: 'Private pay', payerType: 'private_pay' } });
    const code = await prisma.serviceCode.create({
      data: { agencyId, code: 'S5130', codeType: 'hcpcs', unitType: 'unit_15min', description: 'Homemaker service' },
    });
    await prisma.payerRate.create({
      data: { payerId: payer.id, serviceCodeId: code.id, rate: 6, effectiveDate: toDate(addDays(day, -60))! },
    });
    patientId = (
      await prisma.patient.create({
        data: {
          agencyId,
          firstName: 'Penny',
          lastName: 'Payer',
          dateOfBirth: new Date('1939-05-05T00:00:00Z'),
          status: 'active',
          payerPrimaryId: payer.id,
          addressLine1: '12 Fake Lane',
          city: 'Richmond',
          state: 'VA',
          zip: '23220',
          diagnoses: { create: { icd10Code: 'R54', description: 'Age-related debility', isPrimary: true, sequenceOrder: 1 } },
        },
      })
    ).id;
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'home_health_aide' } });
    const aide = await prisma.user.create({
      data: {
        agencyId,
        email: `inv-aide-${randomUUID()}@example.test`,
        passwordHash: 'x',
        firstName: 'Ivy',
        lastName: 'Aide',
        userRoles: { create: { roleId: role.id } },
        staffProfile: { create: { agencyId, discipline: 'HHA' } },
      },
      include: { staffProfile: true },
    });
    staffId = aide.staffProfile!.id;
    authorId = aide.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { agencyId } });
    await prisma.claim.deleteMany({ where: { agencyId } });
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.payer.deleteMany({ where: { agencyId } });
    await prisma.serviceCode.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string): Promise<Auth> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `inv-${randomUUID()}@example.test`;
    await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Ina',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` };
  }

  async function visit(date: string, start: string, end: string, billable = true) {
    const v = await prisma.visit.create({
      data: {
        agencyId,
        patientId,
        staffId,
        visitType: 'home_health_aide',
        serviceCode: 'S5130',
        status: 'completed',
        scheduledDate: toDate(date)!,
        scheduledStart: toTime(start),
        scheduledEnd: toTime(end),
        actualStart: new Date(`${date}T${start}:00Z`),
        actualEnd: new Date(`${date}T${end}:00Z`),
      },
    });
    if (billable) {
      await prisma.evvRecord.create({
        data: { visitId: v.id, agencyId, staffId, patientId, serviceType: 'home_health_aide', serviceDate: toDate(date)!, clockInMethod: 'gps', status: 'verified' },
      });
      await prisma.visitNote.create({
        data: { visitId: v.id, staffId, authorId, noteType: 'aide_activity', narrative: 'ok', status: 'submitted' },
      });
    }
    return v.id;
  }

  const invoices = '/api/v1/billing/invoices';
  let invoice: { id: string; invoiceNumber: string; totalAmount: number };

  it('invoices private-pay visits once, priced like claims, and never also on a claim', async () => {
    const a = await visit(day, '09:00', '10:00'); // 4 units × $6
    await visit(addDays(day, 1), '09:00', '09:30'); // 2 units × $6
    const blocked = await visit(addDays(day, 1), '11:00', '12:00', false); // no EVV / note

    await http().post(invoices).set(office).send({ from: day, to: addDays(day, 1) }).expect(403);
    await http().post(invoices).set(billing).send({ from: addDays(day, 1), to: day }).expect(400);
    const res = await http().post(invoices).set(billing).send({ from: day, to: addDays(day, 1), notes: 'Thank you!' }).expect(201);
    expect(res.body.data.created).toHaveLength(1);
    invoice = res.body.data.created[0];
    expect(res.body.data.created[0]).toMatchObject({
      invoiceNumber: 'INV-000001',
      status: 'draft',
      subtotal: 36,
      totalAmount: 36,
      balanceDue: 36,
      billTo: { name: 'Penny Payer', addressLines: ['12 Fake Lane', 'Richmond, VA 23220'] },
      lines: [
        { quantity: 4, unitRate: 6, total: 24, description: 'Homemaker service (Ivy)' },
        { quantity: 2, unitRate: 6, total: 12 },
      ],
    });
    expect(res.body.data.skipped).toEqual([{ visitId: blocked, reasons: expect.arrayContaining([expect.stringMatching(/EVV/)]) }]);

    // Already invoiced: not picked up again, and a claim won't take it either.
    const again = await http().post(invoices).set(billing).send({ from: day, to: addDays(day, 1) }).expect(201);
    expect(again.body.data.created).toHaveLength(0);
    const claim = await http().post('/api/v1/billing/claims').set(billing).send({ visitIds: [a] }).expect(201);
    expect(claim.body.data.skipped[0].reasons[0]).toBe(`Already billed on invoice ${invoice.invoiceNumber}`);
    // A private-pay visit that isn't invoiced yet is still refused by claims.
    const loose = await visit(addDays(day, 2), '09:00', '10:00');
    const claim2 = await http().post('/api/v1/billing/claims').set(billing).send({ visitIds: [loose] }).expect(201);
    expect(claim2.body.data.created).toHaveLength(0);
    expect(claim2.body.data.skipped[0].reasons[0]).toMatch(/Private pay/);
  });

  it('downloads the invoice as a PDF', async () => {
    const res = await http()
      .get(`${invoices}/${invoice.id}/pdf`)
      .set(billing)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.headers['content-disposition']).toBe('attachment; filename="INV-000001.pdf"');
  });

  it('takes payments after it is sent, never more than the balance', async () => {
    const pay = (amount: number) =>
      http().post(`${invoices}/${invoice.id}/record-payment`).set(billing).send({ amount, paidOn: utcTodayString(), method: 'check', reference: '1001' });
    await pay(10).expect(409); // still a draft
    await http().post(`${invoices}/${invoice.id}/send`).set(billing).expect(200);
    await http().post(`${invoices}/${invoice.id}/send`).set(billing).expect(409);
    await pay(40).expect(400);
    expect((await pay(20).expect(200)).body.data).toMatchObject({ status: 'partially_paid', paidAmount: 20, balanceDue: 16 });
    const paid = (await pay(16).expect(200)).body.data;
    expect(paid).toMatchObject({ status: 'paid', balanceDue: 0, payments: [{ amount: 20 }, { amount: 16 }] });
    expect(paid.paidAt).toBeTruthy();
    await pay(1).expect(409);
    await http().post(`${invoices}/${invoice.id}/void`).set(billing).send({ reason: 'x' }).expect(409); // has payments
  });

  it('voiding releases the visits to be invoiced again', async () => {
    const v = await visit(addDays(day, 3), '13:00', '14:00');
    const created = (await http().post(invoices).set(billing).send({ from: addDays(day, 3), to: addDays(day, 3) }).expect(201)).body.data.created;
    expect(created).toHaveLength(1);
    expect(created[0].invoiceNumber).toBe('INV-000002');
    const voided = (await http().post(`${invoices}/${created[0].id}/void`).set(billing).send({ reason: 'Wrong rate' }).expect(200)).body.data;
    expect(voided).toMatchObject({ status: 'void', balanceDue: 0, voidReason: 'Wrong rate' });
    const redo = (await http().post(invoices).set(billing).send({ from: addDays(day, 3), to: addDays(day, 3) }).expect(201)).body.data.created;
    expect(redo[0].lines.map((l: { visitId: string }) => l.visitId)).toEqual([v]);

    const list = (await http().get(`${invoices}?status=void`).set(billing).expect(200)).body.data;
    expect(list.map((i: { id: string }) => i.id)).toEqual([created[0].id]);
    await http().get(invoices).set(office).expect(403);
  });
});
