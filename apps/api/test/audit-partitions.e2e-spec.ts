import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { AuditPartitionsJob } from '../src/modules/jobs/audit-partitions.job.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

// These run on the shared dev database: never call run() or dropExpired() with a future `now` —
// that would drop real monthly partitions.
describe.skipIf(!hasDb)('Audit log partitioning (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  let job: AuditPartitionsJob;
  let agencyId: string;

  const partitions = () =>
    prisma.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'audit_logs'::regclass`;

  const partitionOf = async (id: bigint): Promise<string> => {
    const [row] = await prisma.$queryRaw<{ part: string }[]>`
      SELECT tableoid::regclass::text AS part FROM audit_logs WHERE id = ${id}`;
    return row!.part;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
    job = app.get(AuditPartitionsJob);
    agencyId = (await prisma.agency.create({ data: { name: `Audit Partition Test ${randomUUID()}` } })).id;
  });

  afterAll(async () => {
    await purgeAuditLogs(prisma, agencyId);
    // Drop the far-future partitions the move test created (empty after the purge).
    const leftovers = (await partitions())
      .map((p) => p.name)
      .filter((n) => /^audit_logs_y2031m0[2-5]$/.test(n));
    for (const name of leftovers) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" DETACH PARTITION "${name}"`);
      await prisma.$executeRawUnsafe(`DROP TABLE "${name}"`);
    }
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  it('refuses UPDATE and DELETE on audit_logs unless the transaction opts into purge', async () => {
    await audit.record({ agencyId, action: 'TEST_APPEND_ONLY' });

    await expect(
      prisma.auditLog.updateMany({ where: { agencyId }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({ where: { agencyId } })).rejects.toThrow(/append-only/);

    // Deleting straight from the row's partition is refused too (row trigger is cloned there).
    const [row] = await prisma.$queryRaw<{ id: bigint; part: string }[]>`
      SELECT id, tableoid::regclass::text AS part FROM audit_logs WHERE agency_id = ${agencyId}::uuid LIMIT 1`;
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "${row!.part}" WHERE agency_id = $1`, agencyId),
    ).rejects.toThrow(/append-only/);

    await purgeAuditLogs(prisma, agencyId);
    expect(await prisma.auditLog.count({ where: { agencyId } })).toBe(0);
  });

  it('moves default-partition rows into a newly created month partition, idempotently', async () => {
    const created = await prisma.auditLog.create({
      data: { agencyId, action: 'TEST_MOVE', createdAt: new Date('2031-03-10T00:00:00Z') },
    });
    expect(await partitionOf(created.id)).toBe('audit_logs_default');

    const first = await job.ensurePartitions(new Date('2031-02-10T12:00:00Z'));
    expect(first.created).toContain('audit_logs_y2031m03');
    expect(first.moved).toBe(1);
    expect(await partitionOf(created.id)).toBe('audit_logs_y2031m03');

    const second = await job.ensurePartitions(new Date('2031-02-10T12:00:00Z'));
    expect(second.created).toEqual([]);
    expect(second.moved).toBe(0);
  });

  it('dropExpired detaches and drops only expired monthly partitions', async () => {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "audit_logs_y2001m01" PARTITION OF "audit_logs" FOR VALUES FROM ('2001-01-01 00:00:00+00') TO ('2001-02-01 00:00:00+00')`,
    );
    await prisma.auditLog.create({
      data: { agencyId, action: 'TEST_EXPIRED', createdAt: new Date('2001-01-15T00:00:00Z') },
    });
    const before = (await partitions()).map((p) => p.name);

    const { dropped } = await job.dropExpired(new Date());

    expect(dropped).toEqual(['audit_logs_y2001m01']);
    const after = (await partitions()).map((p) => p.name);
    expect(after).toEqual(expect.arrayContaining(before.filter((n) => n !== 'audit_logs_y2001m01')));
    expect(after).not.toContain('audit_logs_y2001m01');
  });
});
