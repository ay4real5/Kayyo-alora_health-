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

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const VALID_NPI = '1234567893';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

describe.skipIf(!hasDb)('Physicians (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Physicians Test ${randomUUID()}` } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Physicians Other ${randomUUID()}` } })).id;
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.physician.deleteMany({ where: { agencyId: id } });
      await purgeAuditLogs(prisma, id);
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  async function seedUser(roleName: string, inAgency = agencyId) {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `doc-${randomUUID()}@example.test`;
    await prisma.user.create({
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
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('creates, finds, updates and deactivates a physician', async () => {
    const office = await seedUser('office_staff');
    const created = (
      await http()
        .post('/api/v1/physicians')
        .set(office)
        .send({ firstName: 'Gregory', lastName: 'Example', npi: VALID_NPI, fax: '555-010-3000', state: 'nj' })
        .expect(201)
    ).body.data;
    expect(created).toMatchObject({ npi: VALID_NPI, state: 'NJ', isActive: true });
    expect(created).not.toHaveProperty('agencyId');

    const byNpi = await http().get(`/api/v1/physicians?search=${VALID_NPI}`).set(office).expect(200);
    expect(byNpi.body.data.map((p: { id: string }) => p.id)).toEqual([created.id]);

    await http().patch(`/api/v1/physicians/${created.id}`).set(office).send({ isActive: false }).expect(200);
    const active = await http().get('/api/v1/physicians?isActive=true&limit=100').set(office).expect(200);
    expect(active.body.data.map((p: { id: string }) => p.id)).not.toContain(created.id);
  });

  it('rejects a mistyped NPI and a duplicate NPI in the same agency', async () => {
    const office = await seedUser('office_staff');
    const bad = await http().post('/api/v1/physicians').set(office).send({ firstName: 'A', lastName: 'B', npi: '1234567890' }).expect(400);
    expect(bad.body.error.details[0]).toMatch(/National Provider Identifier/);

    const npi = '1245319599';
    await http().post('/api/v1/physicians').set(office).send({ firstName: 'A', lastName: 'B', npi }).expect(201);
    await http().post('/api/v1/physicians').set(office).send({ firstName: 'C', lastName: 'D', npi }).expect(409);

    // A different agency may list the same physician.
    const otherOffice = await seedUser('office_staff', otherAgencyId);
    await http().post('/api/v1/physicians').set(otherOffice).send({ firstName: 'A', lastName: 'B', npi }).expect(201);
  });

  it('lets nurses read the directory but not edit it, and hides other agencies', async () => {
    const office = await seedUser('office_staff');
    const nurse = await seedUser('registered_nurse');
    const doc = (await http().post('/api/v1/physicians').set(office).send({ firstName: 'Read', lastName: 'Only' })).body.data;

    await http().get(`/api/v1/physicians/${doc.id}`).set(nurse).expect(200);
    await http().post('/api/v1/physicians').set(nurse).send({ firstName: 'X', lastName: 'Y' }).expect(403);
    await http().patch(`/api/v1/physicians/${doc.id}`).set(nurse).send({ city: 'X' }).expect(403);

    const outsider = await seedUser('office_staff', otherAgencyId);
    await http().get(`/api/v1/physicians/${doc.id}`).set(outsider).expect(404);
  });
});
