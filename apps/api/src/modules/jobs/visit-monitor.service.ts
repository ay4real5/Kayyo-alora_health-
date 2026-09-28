import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { zonedTimeToUtc } from '@alora/shared';
import { addDays, fromDate, fromTime, toDate, utcTodayString } from '../../common/utils/dates.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const MINUTE = 60_000;
/** Alert thresholds after the scheduled start, and when an un-clocked visit counts as missed (D-041). */
export const MONITOR_RULES = {
  lateAfterMinutes: 15,
  noShowAfterMinutes: 30,
  missedAfterEndMinutes: 120,
  /** How far back to look for visits never closed (e.g. the server was down). */
  lookBackDays: 7,
} as const;

export interface MonitorRunResult {
  late: string[];
  noShow: string[];
  missed: string[];
}

/**
 * Watches today's schedule (DESIGN.md §8.3): late at +15 min, no-show at +30 min (supervisors alerted), and `missed`
 * once the scheduled end is 2 hours past with no clock-in. Each step is a guarded update, so it happens exactly once
 * even with several API instances running this job.
 */
@Injectable()
export class VisitMonitorService {
  private readonly logger = new Logger(VisitMonitorService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'visit-monitor' })
  async tick(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true }) || this.running) return;
    this.running = true;
    try {
      const result = await this.run();
      const total = result.late.length + result.noShow.length + result.missed.length;
      if (total)
        this.logger.log(
          `late ${result.late.length}, no-show ${result.noShow.length}, missed ${result.missed.length}`,
        );
    } catch (error) {
      this.logger.error('visit monitor failed', (error as Error).stack);
    } finally {
      this.running = false;
    }
  }

  /** One pass. `now` and `agencyIds` are for tests. */
  async run(now = new Date(), agencyIds?: string[]): Promise<MonitorRunResult> {
    const result: MonitorRunResult = { late: [], noShow: [], missed: [] };
    const today = utcTodayString();
    const visits = await this.prisma.visit.findMany({
      where: {
        status: 'scheduled',
        // Agency-local dates straddle UTC; a day either side covers every timezone.
        scheduledDate: {
          gte: toDate(addDays(today, -MONITOR_RULES.lookBackDays)),
          lte: toDate(addDays(today, 1)),
        },
        ...(agencyIds ? { agencyId: { in: agencyIds } } : {}),
      },
      select: {
        id: true,
        agencyId: true,
        staffId: true,
        visitType: true,
        scheduledDate: true,
        scheduledStart: true,
        scheduledEnd: true,
        lateAlertedAt: true,
        noShowAlertedAt: true,
        agency: { select: { timezone: true } },
        staff: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
        patient: { select: { firstName: true, lastName: true } },
      },
    });

    for (const visit of visits) {
      const date = fromDate(visit.scheduledDate)!;
      const start = zonedTimeToUtc(
        date,
        fromTime(visit.scheduledStart),
        visit.agency.timezone,
      ).getTime();
      const end = zonedTimeToUtc(
        date,
        fromTime(visit.scheduledEnd),
        visit.agency.timezone,
      ).getTime();
      const minutesLate = Math.floor((now.getTime() - start) / MINUTE);
      const event = {
        visitId: visit.id,
        scheduledDate: date,
        scheduledStart: fromTime(visit.scheduledStart),
        staffName: visit.staff
          ? `${visit.staff.user.firstName} ${visit.staff.user.lastName}`
          : null,
        patientName: `${visit.patient.firstName} ${visit.patient.lastName}`,
      };

      if (now.getTime() >= end + MONITOR_RULES.missedAfterEndMinutes * MINUTE) {
        const marked = await this.prisma.visit.updateMany({
          where: { id: visit.id, status: 'scheduled' },
          data: {
            status: 'missed',
            missedReason: visit.staffId ? 'No clock-in' : 'No caregiver assigned',
          },
        });
        if (marked.count) {
          await this.prisma.openShift.updateMany({
            where: { visitId: visit.id, status: 'open' },
            data: { status: 'cancelled' },
          });
          await this.prisma.shiftSwapRequest.updateMany({
            where: { visitId: visit.id, status: 'pending' },
            data: { status: 'cancelled', decisionNote: 'The visit was missed' },
          });
          result.missed.push(visit.id);
          this.realtime.toMonitor(visit.agencyId, 'visit:missed', event);
        }
        continue;
      }
      if (!visit.staff) continue; // late/no-show are about a caregiver not arriving

      if (minutesLate >= MONITOR_RULES.noShowAfterMinutes && !visit.noShowAlertedAt) {
        const marked = await this.prisma.visit.updateMany({
          where: { id: visit.id, status: 'scheduled', noShowAlertedAt: null },
          data: { noShowAlertedAt: now, lateAlertedAt: visit.lateAlertedAt ?? now },
        });
        if (marked.count) {
          result.noShow.push(visit.id);
          this.realtime.toMonitor(visit.agencyId, 'visit:noshow', { ...event, minutesLate });
          await this.notifications.notify({
            agencyId: visit.agencyId,
            userIds: [...(await this.supervisors(visit.agencyId)), visit.staff.userId],
            type: 'missed_visit',
            title: 'Visit not started',
            body: `A caregiver hasn't clocked in ${minutesLate} minutes after a visit's start (${date} ${event.scheduledStart}). Open the live monitor.`,
            data: { visitId: visit.id },
          });
        }
      } else if (minutesLate >= MONITOR_RULES.lateAfterMinutes && !visit.lateAlertedAt) {
        const marked = await this.prisma.visit.updateMany({
          where: { id: visit.id, status: 'scheduled', lateAlertedAt: null },
          data: { lateAlertedAt: now },
        });
        if (marked.count) {
          result.late.push(visit.id);
          this.realtime.toMonitor(visit.agencyId, 'visit:late', { ...event, minutesLate });
          await this.notifications.notify({
            agencyId: visit.agencyId,
            userIds: [visit.staff.userId],
            type: 'late_arrival',
            title: 'Running late?',
            body: `Your visit started at ${event.scheduledStart}. Clock in when you arrive, or call the office.`,
            data: { visitId: visit.id },
          });
        }
      }
    }
    return result;
  }

  /** Active users in the agency who can act on EVV (evv:approve) — supervisors and admins. */
  private async supervisors(agencyId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        agencyId,
        isActive: true,
        userRoles: {
          some: {
            role: {
              rolePermissions: { some: { permission: { resource: 'evv', action: 'approve' } } },
            },
          },
        },
      },
      select: { id: true },
      take: 50,
    });
    return users.map((u) => u.id);
  }
}
