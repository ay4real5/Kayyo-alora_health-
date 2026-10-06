import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationsService, type AuthorizationRisk } from '../billing/authorizations.service.js';
import type { CheckCode } from '../billing/billing-readiness.js';
import { BillingReadinessService } from '../billing/billing-readiness.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';

/** How far back "money at risk" looks: unbilled, blocked completed visits from the last 60 days. */
export const AT_RISK_DAYS = 60;
/** Visits listed under coverage (the counts cover them all). */
const LIST_LIMIT = 10;

export type Severity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  /** Dollars, when the item is about money. */
  amount?: number;
  link: string;
}

const REASON_LABELS: Record<CheckCode, string> = {
  visit_completed: 'Visit not completed',
  not_billed: 'Already billed',
  evv_verified: 'EVV not verified',
  note_finalised: 'Visit note not finished',
  service_code: 'No service code',
  payer: 'Payer missing or inactive',
  member_id: 'Member ID missing',
  diagnosis: 'No primary diagnosis',
  authorization: 'Authorization problem',
  rate: 'No rate set',
  agency_npi: 'Agency NPI missing',
  timely_filing: 'Past timely filing',
  evv_claim_data: 'EVV claim data missing',
};

export interface CommandCenter {
  today: string;
  attention: AttentionItem[];
  coverage?: {
    unassignedToday: number;
    unassignedTomorrow: number;
    openShifts: number;
    unassigned: { id: string; date: string; start: string; end: string; visitType: string; patient: string; link: string }[];
  };
  documentation?: { missingNotes: number; draftNotes: number };
  evv?: { pendingCorrections: number; flaggedLast7Days: number };
  credentials?: { expired: number; expiringIn7Days: number; expiringIn30Days: number };
  authorizations?: { atRisk: (AuthorizationRisk & { link: string })[] };
  money?: {
    expectedToday: number;
    visitsToday: number;
    /** Today's visits with no service code or rate, so no price. */
    unpricedToday: number;
    atRisk: { total: number; visits: number; days: number; byReason: { reason: CheckCode; label: string; amount: number; visits: number }[] };
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Command Center (D-093): what needs attention today, built from data the platform already has. Each section is
 * computed only when the viewer holds its permission, so nobody sees more than their role allows; the same object
 * feeds the dashboard home page and the assistant's "what should I worry about today?".
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly authorizations: AuthorizationsService,
    private readonly readiness: BillingReadinessService,
  ) {}

  async commandCenter(caller: AuthUser): Promise<CommandCenter> {
    const access = await this.permissions.forUser(caller);
    const can = (p: string) => access.permissions.has(p);
    const today = await this.clock.todayString(caller.agencyId);
    const result: CommandCenter = { today, attention: [] };

    const [coverage, documentation, evv, credentials, authorizations, money] = await Promise.all([
      can('visits:read_all') ? this.coverage(caller.agencyId, today) : undefined,
      can('visits:read_all') ? this.documentation(caller.agencyId, today) : undefined,
      can('evv:read') ? this.evv(caller.agencyId, today) : undefined,
      can('staff:read') ? this.credentials(caller.agencyId, today) : undefined,
      can('authorizations:read') ? this.authorizations.atRisk(caller.agencyId) : undefined,
      can('billing:read') ? this.money(caller.agencyId, today) : undefined,
    ]);
    if (coverage) result.coverage = coverage;
    if (documentation) result.documentation = documentation;
    if (evv) result.evv = evv;
    if (credentials) result.credentials = credentials;
    if (authorizations) result.authorizations = { atRisk: authorizations.map((a) => ({ ...a, link: `/patients/${a.patient.id}` })) };
    if (money) result.money = money;
    result.attention = attentionItems(result);

    // Patient names appear here (unassigned visits, authorizations): record the view, as for any PHI read.
    await this.audit.record({ agencyId: caller.agencyId, userId: caller.userId, action: 'VIEW_COMMAND_CENTER', resourceType: 'insights' });
    return result;
  }

  private async coverage(agencyId: string, today: string): Promise<NonNullable<CommandCenter['coverage']>> {
    const tomorrow = addDays(today, 1);
    const where = { agencyId, status: 'scheduled', staffId: null };
    const [unassignedToday, unassignedTomorrow, openShifts, rows] = await Promise.all([
      this.prisma.visit.count({ where: { ...where, scheduledDate: toDate(today)! } }),
      this.prisma.visit.count({ where: { ...where, scheduledDate: toDate(tomorrow)! } }),
      this.prisma.openShift.count({ where: { agencyId, status: 'open', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      this.prisma.visit.findMany({
        where: { ...where, scheduledDate: { gte: toDate(today)!, lte: toDate(tomorrow)! } },
        select: { id: true, scheduledDate: true, scheduledStart: true, scheduledEnd: true, visitType: true, patient: { select: { firstName: true, lastName: true } } },
        orderBy: [{ scheduledDate: 'asc' }, { scheduledStart: 'asc' }],
        take: LIST_LIMIT,
      }),
    ]);
    return {
      unassignedToday,
      unassignedTomorrow,
      openShifts,
      unassigned: rows.map((v) => ({
        id: v.id,
        date: fromDate(v.scheduledDate)!,
        start: hhmm(v.scheduledStart),
        end: hhmm(v.scheduledEnd),
        visitType: v.visitType,
        patient: `${v.patient.firstName} ${v.patient.lastName}`,
        link: `/schedule/visits/${v.id}`,
      })),
    };
  }

  /** Completed visits from the last 7 days (before today) without a finished note, and notes still in draft. */
  private async documentation(agencyId: string, today: string): Promise<NonNullable<CommandCenter['documentation']>> {
    const range = { gte: toDate(addDays(today, -7))!, lt: toDate(today)! };
    const [missingNotes, draftNotes] = await Promise.all([
      this.prisma.visit.count({
        where: { agencyId, status: 'completed', scheduledDate: range, visitNotes: { none: { status: { in: ['submitted', 'signed'] } } } },
      }),
      this.prisma.visitNote.count({ where: { status: 'draft', visit: { agencyId, status: 'completed', scheduledDate: range } } }),
    ]);
    return { missingNotes, draftNotes };
  }

  private async evv(agencyId: string, today: string): Promise<NonNullable<CommandCenter['evv']>> {
    const [pendingCorrections, flaggedLast7Days] = await Promise.all([
      this.prisma.evvException.count({ where: { status: 'pending', evvRecord: { visit: { agencyId } } } }),
      this.prisma.evvRecord.count({
        where: { visit: { agencyId }, status: { notIn: ['verified', 'rejected'] }, flags: { isEmpty: false }, clockInTime: { gte: toDate(addDays(today, -7))! } },
      }),
    ]);
    return { pendingCorrections, flaggedLast7Days };
  }

  private async credentials(agencyId: string, today: string): Promise<NonNullable<CommandCenter['credentials']>> {
    const active = { status: 'active', staffProfile: { agencyId, isActive: true } };
    const [expired, expiringIn7Days, expiringIn30Days] = await Promise.all([
      this.prisma.staffCredential.count({ where: { ...active, expiryDate: { lt: toDate(today)! } } }),
      this.prisma.staffCredential.count({ where: { ...active, expiryDate: { gte: toDate(today)!, lte: toDate(addDays(today, 7))! } } }),
      this.prisma.staffCredential.count({ where: { ...active, expiryDate: { gte: toDate(today)!, lte: toDate(addDays(today, 30))! } } }),
    ]);
    return { expired, expiringIn7Days, expiringIn30Days };
  }

  /** Expected revenue from today's visits, and completed-but-blocked visits from the last 60 days in dollars. */
  private async money(agencyId: string, today: string): Promise<NonNullable<CommandCenter['money']>> {
    const todays = await this.prisma.visit.findMany({
      where: { agencyId, scheduledDate: toDate(today)!, status: { in: ['scheduled', 'in_progress', 'completed'] } },
      select: { id: true },
    });
    const [priced, recent] = await Promise.all([
      todays.length ? this.readiness.evaluateVisits(agencyId, todays.map((v) => v.id)) : Promise.resolve([]),
      this.readiness.evaluateRange(agencyId, addDays(today, -AT_RISK_DAYS), today),
    ]);
    const byReason = new Map<CheckCode, { amount: number; visits: number }>();
    let total = 0;
    let visits = 0;
    for (const v of recent) {
      const failing = v.checks.filter((c) => !c.ok && c.severity === 'error');
      // Already on a claim: not at risk.
      if (v.ready || failing.some((c) => c.code === 'not_billed')) continue;
      const reason = failing[0]?.code;
      if (!reason) continue;
      const amount = v.amount ?? 0;
      total += amount;
      visits++;
      const bucket = byReason.get(reason) ?? { amount: 0, visits: 0 };
      bucket.amount += amount;
      bucket.visits++;
      byReason.set(reason, bucket);
    }
    return {
      expectedToday: round2(priced.reduce((sum, v) => sum + (v.amount ?? 0), 0)),
      visitsToday: todays.length,
      unpricedToday: priced.filter((v) => v.amount === null).length,
      atRisk: {
        total: round2(total),
        visits,
        days: AT_RISK_DAYS,
        byReason: [...byReason.entries()]
          .map(([reason, b]) => ({ reason, label: REASON_LABELS[reason], amount: round2(b.amount), visits: b.visits }))
          .sort((a, b) => b.amount - a.amount || b.visits - a.visits),
      },
    };
  }
}

/** The "Needs attention" list: worst first, only what is actually wrong. */
export function attentionItems(c: CommandCenter): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (item: AttentionItem) => item.count > 0 && items.push(item);
  if (c.coverage) {
    add({
      key: 'unassigned_today',
      severity: 'critical',
      title: `${plural(c.coverage.unassignedToday, 'visit')} today without a caregiver`,
      detail: 'Assign someone or offer them as open shifts.',
      count: c.coverage.unassignedToday,
      link: '/schedule',
    });
    add({
      key: 'unassigned_tomorrow',
      severity: 'warning',
      title: `${plural(c.coverage.unassignedTomorrow, 'visit')} tomorrow without a caregiver`,
      detail: 'Fill them today to avoid a scramble.',
      count: c.coverage.unassignedTomorrow,
      link: '/schedule',
    });
  }
  if (c.credentials) {
    add({
      key: 'credentials_expired',
      severity: 'critical',
      title: `${plural(c.credentials.expired, 'credential')} expired`,
      detail: 'Expired credentials block scheduling.',
      count: c.credentials.expired,
      link: '/staff/credentials',
    });
    add({
      key: 'credentials_expiring',
      severity: 'warning',
      title: `${plural(c.credentials.expiringIn7Days, 'credential')} expiring this week`,
      detail: 'Collect renewals before they lapse.',
      count: c.credentials.expiringIn7Days,
      link: '/staff/credentials',
    });
  }
  if (c.authorizations) {
    const over = c.authorizations.atRisk.filter((a) => a.forecast.level === 'over');
    const near = c.authorizations.atRisk.filter((a) => a.forecast.level === 'near');
    add({
      key: 'authorizations_over',
      severity: 'critical',
      title: `${plural(over.length, 'authorization')} on track to run over`,
      detail: 'At the current pace these patients will use more than approved — adjust the schedule or request more.',
      count: over.length,
      link: over.length === 1 ? over[0]!.link : '/',
    });
    add({
      key: 'authorizations_near',
      severity: 'warning',
      title: `${plural(near.length, 'authorization')} close to the limit`,
      detail: 'Over 90% used or booked.',
      count: near.length,
      link: near.length === 1 ? near[0]!.link : '/',
    });
  }
  if (c.money && c.money.atRisk.visits > 0) {
    add({
      key: 'revenue_at_risk',
      severity: c.money.atRisk.total >= 1000 ? 'critical' : 'warning',
      title: `$${c.money.atRisk.total.toLocaleString('en-US', { maximumFractionDigits: 0 })} can't be billed yet`,
      detail: `${plural(c.money.atRisk.visits, 'completed visit')} blocked — top reason: ${c.money.atRisk.byReason[0]?.label ?? 'see Ready to bill'}.`,
      count: c.money.atRisk.visits,
      amount: c.money.atRisk.total,
      link: '/billing/ready',
    });
  }
  if (c.evv) {
    add({
      key: 'evv_corrections',
      severity: 'warning',
      title: `${plural(c.evv.pendingCorrections, 'EVV correction')} waiting for review`,
      detail: 'Approve or deny so the visits can be billed.',
      count: c.evv.pendingCorrections,
      link: '/evv',
    });
    add({
      key: 'evv_flagged',
      severity: 'info',
      title: `${plural(c.evv.flaggedLast7Days, 'visit')} with EVV flags this week`,
      detail: 'Outside the geofence, outside the time window, or manually corrected.',
      count: c.evv.flaggedLast7Days,
      link: '/evv',
    });
  }
  if (c.documentation) {
    add({
      key: 'notes_missing',
      severity: 'warning',
      title: `${plural(c.documentation.missingNotes, 'completed visit')} without a finished note`,
      detail: 'From the last 7 days — notes are needed before billing.',
      count: c.documentation.missingNotes,
      link: '/billing/ready',
    });
  }
  if (c.coverage) {
    add({
      key: 'open_shifts',
      severity: 'info',
      title: `${plural(c.coverage.openShifts, 'open shift')} waiting for a caregiver`,
      detail: 'Offered to caregivers, not yet claimed.',
      count: c.coverage.openShifts,
      link: '/schedule/open-shifts',
    });
  }
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
