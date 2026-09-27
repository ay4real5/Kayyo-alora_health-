import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service.js';

// Runs against a real, migrated Postgres. CI provides one; locally it is skipped when DATABASE_URL is unset.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('database schema (e2e)', () => {
  let prisma: PrismaService;
  let agencyId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    const agency = await prisma.agency.create({ data: { name: `Test Agency ${randomUUID()}` } });
    agencyId = agency.id;
  });

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await prisma.$disconnect();
  });

  it('applies database defaults (uuid, timestamps, geofence radius, status)', async () => {
    const patient = await prisma.patient.create({
      data: { agencyId, firstName: 'Test', lastName: 'Patient', dateOfBirth: new Date('1950-01-01') },
    });
    expect(patient.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(patient.status).toBe('active');
    expect(patient.geoFenceRadiusMeters).toBe(200);
    expect(patient.createdAt).toBeInstanceOf(Date);
  });

  it('enforces unique email per agency', async () => {
    const data = { agencyId, email: 'dup@example.test', passwordHash: 'x', firstName: 'A', lastName: 'B' };
    await prisma.user.create({ data });
    await expect(prisma.user.create({ data })).rejects.toThrow();
  });

  it('cascades patient children on delete', async () => {
    const patient = await prisma.patient.create({
      data: {
        agencyId,
        firstName: 'Cascade',
        lastName: 'Test',
        dateOfBirth: new Date('1960-05-05'),
        diagnoses: { create: { icd10Code: 'I10', isPrimary: true } },
      },
    });
    await prisma.patient.delete({ where: { id: patient.id } });
    expect(await prisma.patientDiagnosis.count({ where: { patientId: patient.id } })).toBe(0);
  });
});
