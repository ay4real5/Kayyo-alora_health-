import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ClaimWorkflowService } from '../billing/claim-workflow.service.js';

export interface Range {
  from: string;
  to: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * Reports (DESIGN.md §14, DECISIONS D-065). Aggregates for the dashboards; list-type reports can be exported as CSV.
 * Visit totals come from the `mv_daily_visit_summary` materialized view (refreshed every 15 minutes); the rest are
 * direct queries — the data sizes of a home health agency don't need more yet (revisit after the P4-09 load test).
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly billing: ClaimWorkflowService,
  ) {}

  /** Default: the last 30 days (agency timezone). At most a year. */
  async range(caller: AuthUser, from?: string, to?: string): Promise<Range> {
    const today = await this.clock.todayString(caller.agencyId);
    const end = to ?? today;
    const start = from ?? addDays(end, -29);
    if (end < start) throw new BadRequestException('to cannot be before from');
    if (end > addDays(start, 366)) throw new BadRequestException('A report can cover at most a year');
    return { from: start, to: end };
  }

  /** Refreshes the materialized views. CONCURRENTLY keeps them readable during the refresh. */
  async refreshViews(): Promise<void> {
    const started = Date.now();
    await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_visit_summary');
    this.logger.log(`report views refreshed in ${Date.now() - started} ms`);
  }

  async census(caller: AuthUser, r: Range) {
    const agencyId = caller.agencyId;
    const [byStatus, activeByPayer, admissions, discharges] = await Promise.all([
      this.prisma.patient.groupBy({ by: ['status'], where: { agencyId }, _count: { _all: true } }),
      this.prisma.patient.groupBy({ by: ['payerPrimaryId'], where: { agencyId, status: 'active' }, _count: { _all: true } }),
      this.prisma.patient.count({ where: { agencyId, admissionDate: { gte: toDate(r.from), lte: toDate(r.to) } } }),
      this.prisma.patient.count({ where: { agencyId, dischargeDate: { gte: toDate(r.from), lte: toDate(r.to) } } }),
    ]);
    const payers = await this.prisma.payer.findMany({
      where: { id: { in: activeByPayer.map((p) => p.payerPrimaryId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, name: true },
    });
    const payerName = new Map(payers.map((p) => [p.id, p.name]));
    return {
      ...r,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      active: byStatus.find((s) => s.status === 'active')?._count._all ?? 0,
      activeByPayer: activeByPayer
        .map((p) => ({ payer: p.payerPrimaryId ? (payerName.get(p.payerPrimaryId) ?? 'Unknown') : 'No payer', patients: p._count._all }))
        .sort((a, b) => b.patients - a.patients),
      admissions,
      discharges,
    };
  }

  async visitUtilization(caller: AuthUser, r: Range) {
    const rows = await this.prisma.$queryRaw<
      { scheduled_date: Date; visit_type: string; scheduled: number; completed: number; missed: number; cancelled: number; open: number }[]
    >`SELECT scheduled_date, visit_type, scheduled, completed, missed, cancelled, open
        FROM mv_daily_visit_summary
       WHERE agency_id = ${caller.agencyId}::uuid AND scheduled_date BETWEEN ${toDate(r.from)} AND ${toDate(r.to)}
       ORDER BY scheduled_date`;
    const empty = () => ({ scheduled: 0, completed: 0, missed: 0, cancelled: 0, open: 0 });
    const days = new Map<string, ReturnType<typeof empty>>();
    const types = new Map<string, ReturnType<typeof empty>>();
    const total = empty();
    for (const row of rows) {
      const date = fromDate(row.scheduled_date)!;
      for (const [map, key] of [[days, date], [types, row.visit_type]] as const) {
        const t = map.get(key) ?? empty();
        for (const k of ['scheduled', 'completed', 'missed', 'cancelled', 'open'] as const) t[k] += row[k];
        map.set(key, t);
      }
      for (const k of ['scheduled', 'completed', 'missed', 'cancelled', 'open'] as const) total[k] += row[k];
    }
    // Every day in the range, so charts have no gaps.
    const daily = [];
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) daily.push({ date: d, ...(days.get(d) ?? empty()) });
    return {
      ...r,
      totals: { ...total, completionRate: pct(total.completed, total.completed + total.missed) },
      daily,
      byVisitType: [...types.entries()].map(([visitType, t]) => ({ visitType, ...t })).sort((a, b) => b.scheduled - a.scheduled),
    };
  }

  async evvCompliance(caller: AuthUser, r: Range) {
    const visits = await this.prisma.visit.findMany({
      where: { agencyId: caller.agencyId, status: 'completed', scheduledDate: { gte: toDate(r.from), lte: toDate(r.to) } },
      select: { evvRecords: { select: { status: true, clockInMethod: true } } },
    });
    const count = { verified: 0, awaitingReview: 0, rejected: 0, missing: 0 };
    const methods: Record<string, number> = {};
    for (const v of visits) {
      const e = v.evvRecords[0];
      if (!e) {
        count.missing++;
        continue;
      }
      methods[e.clockInMethod] = (methods[e.clockInMethod] ?? 0) + 1;
      if (e.status === 'verified') count.verified++;
      else if (e.status === 'rejected') count.rejected++;
      else count.awaitingReview++;
    }
    return { ...r, completedVisits: visits.length, ...count, verifiedRate: pct(count.verified, visits.length), clockInMethods: methods };
  }

  async staffProductivity(caller: AuthUser, r: Range) {
    const visits = await this.prisma.visit.findMany({
      where: { agencyId: caller.agencyId, staffId: { not: null }, status: { in: ['completed', 'missed'] }, scheduledDate: { gte: toDate(r.from), lte: toDate(r.to) } },
      select: {
        status: true,
        staffId: true,
        staff: { select: { discipline: true, user: { select: { firstName: true, lastName: true } } } },
        evvRecords: { select: { clockInTime: true, clockOutTime: true } },
      },
    });
    const byStaff = new Map<string, { staffId: string; name: string; discipline: string; completed: number; missed: number; minutes: number }>();
    for (const v of visits) {
      const s = byStaff.get(v.staffId!) ?? {
        staffId: v.staffId!,
        name: `${v.staff!.user.lastName}, ${v.staff!.user.firstName}`,
        discipline: v.staff!.discipline,
        completed: 0,
        missed: 0,
        minutes: 0,
      };
      if (v.status === 'missed') s.missed++;
      else {
        s.completed++;
        const e = v.evvRecords[0];
        if (e?.clockInTime && e.clockOutTime) s.minutes += Math.max(0, (e.clockOutTime.getTime() - e.clockInTime.getTime()) / 60_000);
      }
      byStaff.set(v.staffId!, s);
    }
    const rows = [...byStaff.values()]
      .map((s) => ({
        staffId: s.staffId,
        name: s.name,
        discipline: s.discipline,
        completedVisits: s.completed,
        missedVisits: s.missed,
        hours: round(s.minutes / 60),
        averageVisitMinutes: s.completed ? Math.round(s.minutes / s.completed) : null,
      }))
      .sort((a, b) => b.completedVisits - a.completedVisits || a.name.localeCompare(b.name));
    return { ...r, rows };
  }

  async missedVisits(caller: AuthUser, r: Range) {
    const rows = await this.prisma.visit.findMany({
      where: { agencyId: caller.agencyId, status: { in: ['missed', 'cancelled'] }, scheduledDate: { gte: toDate(r.from), lte: toDate(r.to) } },
      select: {
        id: true,
        scheduledDate: true,
        visitType: true,
        status: true,
        missedReason: true,
        cancelReason: true,
        patient: { select: { firstName: true, lastName: true, mrn: true } },
        staff: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { scheduledDate: 'desc' },
      take: 1000,
    });
    return {
      ...r,
      rows: rows.map((v) => ({
        visitId: v.id,
        date: fromDate(v.scheduledDate)!,
        patient: `${v.patient.lastName}, ${v.patient.firstName}`,
        mrn: v.patient.mrn,
        caregiver: v.staff ? `${v.staff.user.lastName}, ${v.staff.user.firstName}` : null,
        visitType: v.visitType,
        status: v.status,
        reason: v.missedReason ?? v.cancelReason ?? null,
      })),
    };
  }

  async financialSummary(caller: AuthUser, r: Range) {
    const agencyId = caller.agencyId;
    const start = new Date(`${r.from}T00:00:00Z`);
    const end = new Date(`${addDays(r.to, 1)}T00:00:00Z`);
    const [billed, invoiced, remits, invoicePayments, denials, aging] = await Promise.all([
      this.prisma.claim.aggregate({
        where: { agencyId, status: { notIn: ['void', 'replaced'] }, createdAt: { gte: start, lt: end } },
        _sum: { totalCharges: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.aggregate({ where: { agencyId, status: { not: 'void' }, issueDate: { gte: toDate(r.from), lte: toDate(r.to) } }, _sum: { totalAmount: true } }),
      this.prisma.payment.aggregate({ where: { agencyId, status: 'posted', postedAt: { gte: start, lt: end } }, _sum: { paymentAmount: true } }),
      this.prisma.invoicePayment.aggregate({ where: { invoice: { agencyId }, paidOn: { gte: toDate(r.from), lte: toDate(r.to) } }, _sum: { amount: true } }),
      this.prisma.claim.findMany({
        where: { agencyId, deniedAt: { gte: start, lt: end } },
        select: { totalCharges: true, denialReasonCode: true, payer: { select: { name: true } } },
      }),
      this.billing.aging(caller, {}),
    ]);
    const byReason = new Map<string, { reason: string; claims: number; amount: number }>();
    for (const d of denials) {
      const key = d.denialReasonCode ?? 'unknown';
      const row = byReason.get(key) ?? { reason: key, claims: 0, amount: 0 };
      row.claims++;
      row.amount = round(row.amount + Number(d.totalCharges));
      byReason.set(key, row);
    }
    const billedCount = billed._count._all;
    return {
      ...r,
      billed: round(Number(billed._sum.totalCharges ?? 0) + Number(invoiced._sum.totalAmount ?? 0)),
      claimsBilled: billedCount,
      collected: round(Number(remits._sum.paymentAmount ?? 0) + Number(invoicePayments._sum.amount ?? 0)),
      denied: { claims: denials.length, amount: round(denials.reduce((s, d) => s + Number(d.totalCharges), 0)), rate: pct(denials.length, billedCount), byReason: [...byReason.values()].sort((a, b) => b.claims - a.claims) },
      outstanding: aging.total,
      aging: { buckets: aging.buckets, totals: aging.totals },
    };
  }
}

/** Rows → CSV (RFC 4180, CRLF). Only for list reports; no free-text PHI beyond what the screen shows. */
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    const text = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(','))].join('\r\n') + '\r\n';
}
