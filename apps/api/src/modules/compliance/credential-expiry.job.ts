import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ComplianceService } from './compliance.service.js';

/** Alert stages, in order. A credential is alerted once per stage (D-062). */
export const STAGES = ['due', 'week', 'expired'] as const;
export type ExpiryStage = (typeof STAGES)[number];

/** Which stage a credential is in on `today`, or null if it's not time to alert yet. */
export function expiryStage(expiryDate: string, today: string, alertDaysBefore: number): ExpiryStage | null {
  if (expiryDate < today) return 'expired';
  if (expiryDate <= addDays(today, 7)) return 'week';
  if (expiryDate <= addDays(today, Math.max(alertDaysBefore, 7))) return 'due';
  return null;
}

const daysUntil = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Daily: tells staff and their managers (staff:update holders) about credentials entering an expiry stage. Idempotent:
 * the stage is claimed with a guarded update before anyone is notified, so several API instances can run it.
 */
@Injectable()
export class CredentialExpiryJob {
  private readonly logger = new Logger(CredentialExpiryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly notifications: NotificationsService,
    private readonly compliance: ComplianceService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // 12:30 UTC — morning in the US.
  @Cron('30 12 * * *', { name: 'credential-expiry' })
  async cron(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return;
    try {
      const sent = await this.run();
      this.logger.log(`credential expiry: ${sent} alerts`);
    } catch (error) {
      this.logger.error('credential expiry job failed', (error as Error).stack);
    }
  }

  /** Returns how many credentials were alerted. `agencyId` limits it to one agency (tests). */
  async run(agencyId?: string): Promise<number> {
    const horizon = toDate(addDays(new Date().toISOString().slice(0, 10), 120))!;
    const rows = await this.prisma.staffCredential.findMany({
      where: {
        expiryDate: { lte: horizon },
        // Not yet told it's expired (spelled out: NOT (stage = 'expired') would also drop NULL stages in SQL).
        OR: [{ expiryAlertStage: null }, { expiryAlertStage: { not: 'expired' } }],
        staffProfile: { isActive: true, user: { isActive: true }, ...(agencyId ? { agencyId } : {}) },
      },
      select: {
        id: true,
        credentialName: true,
        expiryDate: true,
        alertDaysBefore: true,
        expiryAlertStage: true,
        staffProfile: { select: { agencyId: true, userId: true, user: { select: { firstName: true, lastName: true } } } },
      },
    });
    const todayByAgency = new Map<string, string>();
    const managersByAgency = new Map<string, string[]>();
    let sent = 0;
    for (const c of rows) {
      const agency = c.staffProfile.agencyId;
      if (!todayByAgency.has(agency)) todayByAgency.set(agency, await this.clock.todayString(agency));
      const today = todayByAgency.get(agency)!;
      const expiry = fromDate(c.expiryDate)!;
      const stage = expiryStage(expiry, today, c.alertDaysBefore);
      if (!stage) continue;
      const current = c.expiryAlertStage as ExpiryStage | null;
      if (current && STAGES.indexOf(current) >= STAGES.indexOf(stage)) continue;
      const claimed = await this.prisma.staffCredential.updateMany({
        where: { id: c.id, expiryAlertStage: current },
        data: { expiryAlertStage: stage },
      });
      if (!claimed.count) continue; // another instance got it
      if (!managersByAgency.has(agency)) managersByAgency.set(agency, await this.compliance.usersWithPermission(agency, 'staff', 'update'));
      const who = `${c.staffProfile.user.firstName} ${c.staffProfile.user.lastName}`;
      const days = daysUntil(today, expiry);
      await this.notifications.notify({
        agencyId: agency,
        userIds: [c.staffProfile.userId, ...managersByAgency.get(agency)!],
        type: 'credential_expiry',
        title: stage === 'expired' ? `Credential expired: ${c.credentialName}` : `Credential expires in ${days} day${days === 1 ? '' : 's'}: ${c.credentialName}`,
        body: `${who} — renew it and update the expiry date in Staff.`,
        data: { credentialId: c.id },
      });
      sent++;
    }
    return sent;
  }
}
