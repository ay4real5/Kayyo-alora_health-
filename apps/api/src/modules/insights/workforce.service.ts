import { Injectable, NotFoundException } from '@nestjs/common';
import { zonedTimeToUtc } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, fromTime, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  badges,
  careScore,
  evvAnomalies,
  LATE_MINUTES,
  NOTE_HOURS,
  type Anomaly,
  type Badge,
  type CareScore,
  type CareStats,
} from './workforce.js';

/** Default windows: anomalies look back two weeks, scores a month, badges a quarter. */
export const ANOMALY_DAYS = 14;
export const SCORE_DAYS = 30;
export const BADGE_DAYS = 90;

export interface AnomalyView extends Anomaly {
  staffName: string;
  /** The EVV record to open first. */
  link: string;
}

export interface CareScoreRow extends CareScore {
  staffId: string;
  name: string;
  discipline: string;
  visits: number;
  link: string;
}

const num = (d: unknown) => (d === null || d === undefined ? null : Number(d));
const point = (lat: unknown, lng: unknown) => (num(lat) !== null && num(lng) !== null ? { lat: num(lat)!, lng: num(lng)! } : null);
const emptyStats = (): CareStats => ({ visits: 0, missed: 0, started: 0, late: 0, notes: 0, notesOnTime: 0, evv: 0, evvClean: 0, incidents: 0 });

/**
 * Workforce intelligence (D-097): EVV anomaly patterns, the explainable Care Score and recognition badges. Read-only
 * and computed on demand from visits, notes and EVV, so there is nothing to keep in sync.
 */
@Injectable()
export class WorkforceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
  ) {}

  private async window(agencyId: string, days: number, from?: string, to?: string) {
    const today = await this.clock.todayString(agencyId);
    const end = to ?? today;
    return { from: from ?? addDays(end, -(days - 1)), to: end };
  }

  async anomalies(caller: AuthUser, from?: string, to?: string): Promise<{ from: string; to: string; items: AnomalyView[] }> {
    const range = await this.window(caller.agencyId, ANOMALY_DAYS, from, to);
    const records = await this.prisma.evvRecord.findMany({
      where: { agencyId: caller.agencyId, serviceDate: { gte: toDate(range.from)!, lte: toDate(range.to)! } },
      select: {
        id: true,
        staffId: true,
        clockInTime: true,
        clockOutTime: true,
        clockInLatitude: true,
        clockInLongitude: true,
        clockOutLatitude: true,
        clockOutLongitude: true,
        flags: true,
        _count: { select: { exceptions: true } },
        staff: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    const names = new Map(records.map((r) => [r.staffId, `${r.staff.user.firstName} ${r.staff.user.lastName}`]));
    const items = evvAnomalies(
      records.map((r) => ({
        id: r.id,
        staffId: r.staffId,
        clockIn: r.clockInTime,
        clockOut: r.clockOutTime,
        inAt: point(r.clockInLatitude, r.clockInLongitude),
        outAt: point(r.clockOutLatitude, r.clockOutLongitude),
        flags: r.flags,
        corrections: r._count.exceptions,
      })),
    );
    return { ...range, items: items.map((a) => ({ ...a, staffName: names.get(a.staffId) ?? 'Caregiver', link: `/evv/${a.recordIds[0]}` })) };
  }

  /** Counts per caregiver over [from, to] (agency dates). */
  async stats(agencyId: string, from: string, to: string, staffIds?: string[]): Promise<Map<string, CareStats>> {
    const dates = { gte: toDate(from)!, lte: toDate(to)! };
    const staffFilter = staffIds ? { in: staffIds } : { not: null };
    const [timezone, visits, evv] = await Promise.all([
      this.clock.timezone(agencyId),
      this.prisma.visit.findMany({
        where: { agencyId, staffId: staffFilter, scheduledDate: dates, status: { in: ['completed', 'missed'] } },
        select: {
          id: true,
          staffId: true,
          status: true,
          scheduledDate: true,
          scheduledStart: true,
          actualStart: true,
          actualEnd: true,
          visitNotes: { where: { status: { in: ['submitted', 'signed'] } }, select: { submittedAt: true, signedAt: true } },
          _count: { select: { incidentReports: true } },
        },
      }),
      this.prisma.evvRecord.findMany({
        where: { agencyId, ...(staffIds ? { staffId: { in: staffIds } } : {}), serviceDate: dates },
        select: { staffId: true, flags: true, _count: { select: { exceptions: true } } },
      }),
    ]);
    const out = new Map<string, CareStats>();
    const of = (id: string) => out.get(id) ?? out.set(id, emptyStats()).get(id)!;
    for (const v of visits) {
      const s = of(v.staffId!);
      s.visits++;
      s.incidents += v._count.incidentReports;
      if (v.status === 'missed') {
        s.missed++;
        continue;
      }
      if (!v.actualStart) continue;
      s.started++;
      const due = zonedTimeToUtc(fromDate(v.scheduledDate)!, fromTime(v.scheduledStart), timezone).getTime();
      if (v.actualStart.getTime() - due > LATE_MINUTES * 60_000) s.late++;
      const done = v.visitNotes.map((n) => n.submittedAt ?? n.signedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0];
      if (done) {
        s.notes++;
        const ended = (v.actualEnd ?? v.actualStart).getTime();
        if (done.getTime() - ended <= NOTE_HOURS * 3_600_000) s.notesOnTime++;
      }
    }
    for (const r of evv) {
      const s = of(r.staffId);
      s.evv++;
      if (r.flags.length === 0 && r._count.exceptions === 0) s.evvClean++;
    }
    return out;
  }

  /** Every active caregiver's score for the period (admins and supervisors: staff:update + reports:read). */
  async careScores(caller: AuthUser, from?: string, to?: string): Promise<{ from: string; to: string; items: CareScoreRow[] }> {
    const range = await this.window(caller.agencyId, SCORE_DAYS, from, to);
    const staff = await this.prisma.staffProfile.findMany({
      where: { agencyId: caller.agencyId, isActive: true },
      select: { id: true, discipline: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
    });
    const stats = await this.stats(caller.agencyId, range.from, range.to);
    return {
      ...range,
      items: staff.map((s) => {
        const st = stats.get(s.id) ?? emptyStats();
        return { staffId: s.id, name: `${s.user.firstName} ${s.user.lastName}`, discipline: s.discipline, visits: st.visits, link: `/staff/${s.id}`, ...careScore(st) };
      }),
    };
  }

  async careScoreFor(caller: AuthUser, staffId: string, from?: string, to?: string): Promise<{ from: string; to: string } & CareScore & { stats: CareStats }> {
    const exists = await this.prisma.staffProfile.count({ where: { id: staffId, agencyId: caller.agencyId } });
    if (!exists) throw new NotFoundException('Staff member not found');
    const range = await this.window(caller.agencyId, SCORE_DAYS, from, to);
    const stats = (await this.stats(caller.agencyId, range.from, range.to, [staffId])).get(staffId) ?? emptyStats();
    return { ...range, ...careScore(stats), stats };
  }

  /** The caller's own badges, when the agency has switched recognition on. */
  async myRecognition(caller: AuthUser): Promise<{ enabled: boolean; from: string; to: string; badges: Badge[] }> {
    const range = await this.window(caller.agencyId, BADGE_DAYS);
    const [agency, me] = await Promise.all([
      this.prisma.agency.findUniqueOrThrow({ where: { id: caller.agencyId }, select: { settings: true } }),
      this.prisma.staffProfile.findFirst({ where: { userId: caller.userId, agencyId: caller.agencyId }, select: { id: true } }),
    ]);
    const enabled = recognitionEnabled(agency.settings);
    if (!enabled || !me) return { enabled, ...range, badges: [] };
    const stats = (await this.stats(caller.agencyId, range.from, range.to, [me.id])).get(me.id) ?? emptyStats();
    return { enabled, ...range, badges: badges(stats) };
  }
}

/** Agency setting (off by default): show caregivers their recognition badges in the app. */
export function recognitionEnabled(settings: unknown): boolean {
  return typeof settings === 'object' && settings !== null && (settings as Record<string, unknown>).recognitionBadges === true;
}
