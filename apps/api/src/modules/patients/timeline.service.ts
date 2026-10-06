import { Injectable } from '@nestjs/common';
import { zonedTimeToUtc } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, fromTime, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { PatientsService } from './patients.service.js';

export type TimelineKind = 'referral' | 'admission' | 'discharge' | 'visit' | 'note' | 'evv' | 'incident' | 'care_update' | 'document';

export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  /** Where the full record is, when the viewer can open it. */
  link: string | null;
  tone: 'good' | 'warning' | 'neutral';
}

/** Default window: the last 90 days. */
export const TIMELINE_DAYS = 90;
const LIMIT = 300;

const human = (s: string) => s.replaceAll('_', ' ');

/**
 * One chronological view of a client (D-100): referral and admission, visits, notes, EVV problems, incidents,
 * family care updates and documents. Each kind appears only when the viewer holds its permission, and the patient
 * itself must be visible to them (assigned-patient rules apply through PatientsService.get). Headlines only — the
 * full record is a link away and audited there.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly permissions: PermissionsService,
    private readonly patients: PatientsService,
  ) {}

  async forPatient(caller: AuthUser, patientId: string, from?: string, to?: string): Promise<{ from: string; to: string; events: TimelineEvent[] }> {
    const patient = await this.patients.get(caller, patientId); // 404 unless the caller may see this patient
    const access = await this.permissions.forUser(caller);
    const can = (p: string) => access.permissions.has(p);
    const tz = await this.clock.timezone(caller.agencyId);
    const end = to ?? (await this.clock.todayString(caller.agencyId));
    const start = from ?? addDays(end, -(TIMELINE_DAYS - 1));
    const dates = { gte: toDate(start)!, lte: toDate(end)! };
    const instants = { gte: zonedTimeToUtc(start, '00:00', tz), lt: zonedTimeToUtc(addDays(end, 1), '00:00', tz) };
    const base = { patientId, agencyId: caller.agencyId };
    const events: TimelineEvent[] = [];
    const inRange = (d: string | null) => d !== null && d >= start && d <= end;
    const dayStart = (d: string) => zonedTimeToUtc(d, '00:00', tz).toISOString();

    if (inRange(patient.admissionDate)) {
      events.push({ at: dayStart(patient.admissionDate!), kind: 'admission', title: 'Admitted', detail: null, link: null, tone: 'good' });
    }
    if (inRange(patient.dischargeDate)) {
      events.push({ at: dayStart(patient.dischargeDate!), kind: 'discharge', title: 'Discharged', detail: null, link: null, tone: 'neutral' });
    }

    // Visits: everyone's for people who see the whole schedule, otherwise only the caller's own.
    const own = can('visits:read_all') ? {} : { staff: { userId: caller.userId } };
    const [referral, visits, notes, evv, incidents, careUpdates, documents] = await Promise.all([
      can('referrals:read')
        ? this.prisma.referral.findFirst({ where: { patientId, agencyId: caller.agencyId }, select: { id: true, createdAt: true, channel: true, source: { select: { name: true } } } })
        : null,
      can('visits:read')
        ? this.prisma.visit.findMany({
            where: { ...base, ...own, scheduledDate: dates, status: { in: ['completed', 'missed', 'cancelled'] } },
            select: {
              id: true,
              status: true,
              visitType: true,
              scheduledDate: true,
              scheduledStart: true,
              actualStart: true,
              missedReason: true,
              cancelReason: true,
              staff: { select: { user: { select: { firstName: true, lastName: true } } } },
            },
            take: LIMIT,
          })
        : [],
      can('visits:read')
        ? this.prisma.visitNote.findMany({
            where: { visit: { ...base, ...own }, status: { in: ['submitted', 'signed'] }, OR: [{ submittedAt: instants }, { signedAt: instants }] },
            select: { id: true, visitId: true, noteType: true, status: true, submittedAt: true, signedAt: true, incidentFlagType: true, author: { select: { firstName: true, lastName: true } } },
            take: LIMIT,
          })
        : [],
      can('evv:read')
        ? this.prisma.evvRecord.findMany({
            where: { ...base, serviceDate: dates, OR: [{ flags: { isEmpty: false } }, { status: 'rejected' }] },
            select: { id: true, serviceDate: true, clockInTime: true, flags: true, status: true },
            take: LIMIT,
          })
        : [],
      can('compliance:read')
        ? this.prisma.incidentReport.findMany({
            where: { ...base, incidentDate: dates },
            select: { id: true, incidentDate: true, incidentType: true, severity: true, status: true },
            take: LIMIT,
          })
        : [],
      can('visits:read')
        ? this.prisma.careUpdate.findMany({ where: { ...base, createdAt: instants }, select: { visitId: true, summary: true, mood: true, createdAt: true }, take: LIMIT })
        : [],
      can('documents:read')
        ? this.prisma.document.findMany({
            where: { ...base, createdAt: instants },
            select: { id: true, title: true, documentType: true, createdAt: true },
            take: LIMIT,
          })
        : [],
    ]);

    if (referral && referral.createdAt >= instants.gte && referral.createdAt < instants.lt) {
      events.push({
        at: referral.createdAt.toISOString(),
        kind: 'referral',
        title: 'Referral received',
        detail: referral.source?.name ?? (referral.channel === 'web_form' ? 'Website form' : null),
        link: `/referrals/${referral.id}`,
        tone: 'neutral',
      });
    }
    for (const v of visits) {
      const date = fromDate(v.scheduledDate)!;
      const who = v.staff ? `${v.staff.user.firstName} ${v.staff.user.lastName}` : 'Unassigned';
      events.push({
        at: (v.actualStart ?? zonedTimeToUtc(date, fromTime(v.scheduledStart), tz)).toISOString(),
        kind: 'visit',
        title: v.status === 'completed' ? `Visit completed — ${human(v.visitType)}` : v.status === 'missed' ? 'Visit missed' : 'Visit cancelled',
        detail: v.status === 'completed' ? who : [who, v.missedReason ?? v.cancelReason].filter(Boolean).join(' · '),
        link: `/schedule/visits/${v.id}`,
        tone: v.status === 'completed' ? 'good' : v.status === 'missed' ? 'warning' : 'neutral',
      });
    }
    for (const n of notes) {
      const at = n.signedAt ?? n.submittedAt!;
      events.push({
        at: at.toISOString(),
        kind: 'note',
        title: `${n.status === 'signed' ? 'Note signed' : 'Note submitted'} — ${human(n.noteType)}`,
        detail: [`${n.author.firstName} ${n.author.lastName}`, n.incidentFlagType ? `flagged: possible ${human(n.incidentFlagType)}` : null].filter(Boolean).join(' · '),
        link: `/schedule/visits/${n.visitId}`,
        tone: n.incidentFlagType ? 'warning' : 'neutral',
      });
    }
    for (const r of evv) {
      events.push({
        at: (r.clockInTime ?? new Date(dayStart(fromDate(r.serviceDate)!))).toISOString(),
        kind: 'evv',
        title: r.status === 'rejected' ? 'EVV record rejected' : 'EVV flagged for review',
        detail: r.flags.map(human).join(', ') || null,
        link: `/evv/${r.id}`,
        tone: 'warning',
      });
    }
    for (const i of incidents) {
      events.push({
        at: dayStart(fromDate(i.incidentDate)!),
        kind: 'incident',
        title: `Incident — ${human(i.incidentType)}`,
        detail: `${i.severity} · ${human(i.status)}`,
        link: '/compliance',
        tone: 'warning',
      });
    }
    for (const c of careUpdates) {
      events.push({ at: c.createdAt.toISOString(), kind: 'care_update', title: 'Care update sent to family', detail: c.summary, link: `/schedule/visits/${c.visitId}`, tone: 'good' });
    }
    for (const d of documents) {
      events.push({ at: d.createdAt.toISOString(), kind: 'document', title: `Document added — ${d.title}`, detail: human(d.documentType), link: null, tone: 'neutral' });
    }

    events.sort((a, b) => b.at.localeCompare(a.at));
    return { from: start, to: end, events: events.slice(0, LIMIT) };
  }
}
