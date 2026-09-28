import type { PrismaClient } from '../../generated/prisma/client.js';

/** Deletes an agency's audit rows — FAKE data only (test cleanup, demo wipe). audit_logs refuses deletes otherwise (D-067). */
export async function purgeAuditLogs(prisma: PrismaClient, agencyId: string): Promise<void> {
  await prisma.$transaction([
    prisma.$queryRaw`SELECT set_config('alora.audit_purge', 'on', true)`,
    prisma.auditLog.deleteMany({ where: { agencyId } }),
  ]);
}
