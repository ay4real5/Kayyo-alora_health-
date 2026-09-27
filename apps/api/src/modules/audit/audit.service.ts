import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

export interface AuditEntry {
  agencyId: string;
  userId?: string | null;
  /** UPPER_SNAKE verb, e.g. LOGIN_SUCCESS, VIEW_PATIENT. */
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Never put PHI here (names, DOBs, SSNs, clinical text). IDs and reasons only. */
  details?: Prisma.InputJsonObject;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Writes the HIPAA audit trail (audit_logs). Append-only.
 * A failed audit write is logged loudly but never breaks the user's request.
 * P1-09 adds the interceptor that records PHI reads/writes automatically.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          agencyId: entry.agencyId,
          userId: entry.userId ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          details: entry.details ?? Prisma.JsonNull,
          ipAddress: toInet(entry.ipAddress),
          userAgent: entry.userAgent?.slice(0, 1000) ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`AUDIT WRITE FAILED for ${entry.action}`, (error as Error).stack);
    }
  }
}

/** Express may report IPv4 as "::ffff:1.2.3.4"; Postgres INET accepts both, but reject junk. */
function toInet(ip: string | undefined): string | null {
  if (!ip) return null;
  return /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}
