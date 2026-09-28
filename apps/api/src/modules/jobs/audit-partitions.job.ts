import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { isExpired, monthsToEnsure, parsePartitionName, partitionName } from './audit-partitions.js';

const ADVISORY_LOCK = `SELECT pg_advisory_xact_lock(hashtext('audit_logs_partitions'))`;

/**
 * Monthly audit_logs partitions (D-067): keeps the current month + 3 ahead created, moves stray
 * rows out of the default partition, and drops whole months older than AUDIT_RETENTION_MONTHS
 * (HIPAA 6 years). Idempotent and advisory-locked — several API instances may run it.
 */
@Injectable()
export class AuditPartitionsJob {
  private readonly logger = new Logger(AuditPartitionsJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // 03:45 UTC daily — frequent enough that a missed run self-heals.
  @Cron('45 3 * * *', { name: 'audit-partitions' })
  async run(now: Date = new Date()): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return;
    try {
      const ensured = await this.ensurePartitions(now);
      const dropped = await this.dropExpired(now);
      this.logger.log(
        `audit-partitions: created ${ensured.created.length} (${ensured.created.join(', ') || 'none'}), ` +
          `moved ${ensured.moved} rows, dropped ${dropped.dropped.length} (${dropped.dropped.join(', ') || 'none'})`,
      );
    } catch (error) {
      this.logger.error('audit partition maintenance failed', (error as Error).stack);
    }
  }

  /** Creates any missing partitions for monthsToEnsure(now), first rescuing rows that landed in
   * audit_logs_default. Returns the partitions created and rows moved. */
  async ensurePartitions(now: Date): Promise<{ created: string[]; moved: number }> {
    const created: string[] = [];
    let moved = 0;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(ADVISORY_LOCK);
        for (const { year, month, from, to } of monthsToEnsure(now)) {
          const name = partitionName(year, month);
          const [{ exists }] = await tx.$queryRaw<[{ exists: boolean }]>`
            SELECT to_regclass(${`"${name}"`}) IS NOT NULL AS exists`;
          if (exists) continue;

          // Deletes are append-only-blocked; this transaction opts in (alora.audit_purge is
          // transaction-local, so nothing outside it can delete).
          await tx.$queryRaw`SELECT set_config('alora.audit_purge', 'on', true)`;
          const tmp = `audit_part_move_${year}_${month}`;
          await tx.$executeRawUnsafe(`CREATE TEMP TABLE "${tmp}" (LIKE "audit_logs") ON COMMIT DROP`);
          moved += await tx.$executeRawUnsafe(
            `WITH d AS (DELETE FROM "audit_logs_default" WHERE "created_at" >= $1 AND "created_at" < $2 RETURNING *)
             INSERT INTO "${tmp}" SELECT * FROM d`,
            from,
            to,
          );
          await tx.$executeRawUnsafe(
            `CREATE TABLE "${name}" PARTITION OF "audit_logs" FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`,
          );
          await tx.$executeRawUnsafe(`INSERT INTO "audit_logs" SELECT * FROM "${tmp}"`);
          await tx.$executeRawUnsafe(`DROP TABLE "${tmp}"`);
          created.push(name);
        }
      },
      { timeout: 30_000 },
    );
    return { created, moved };
  }

  /** Detaches and drops whole monthly partitions whose rows are all older than retention. The
   * default partition and anything not matching our naming scheme is never touched. */
  async dropExpired(now: Date): Promise<{ dropped: string[] }> {
    const retentionMonths = this.config.get('AUDIT_RETENTION_MONTHS', { infer: true });
    const children = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'audit_logs'::regclass`;
    const expired = children
      .map((c) => c.name)
      .filter((name) => {
        const parsed = parsePartitionName(name);
        return parsed !== null && isExpired(parsed.year, parsed.month, now, retentionMonths);
      });
    const dropped: string[] = [];
    if (expired.length === 0) return { dropped };
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(ADVISORY_LOCK);
        for (const name of expired) {
          // Another instance may have dropped it while we waited for the lock.
          const [{ exists }] = await tx.$queryRaw<[{ exists: boolean }]>`
            SELECT to_regclass(${`"${name}"`}) IS NOT NULL AS exists`;
          if (!exists) continue;
          await tx.$executeRawUnsafe(`ALTER TABLE "audit_logs" DETACH PARTITION "${name}"`);
          await tx.$executeRawUnsafe(`DROP TABLE "${name}"`);
          dropped.push(name);
        }
      },
      { timeout: 30_000 },
    );
    return { dropped };
  }
}
