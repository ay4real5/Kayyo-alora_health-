import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MANDATORY_TWO_FACTOR_ROLES } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PatientsService } from '../patients/patients.service.js';
import type { AuditLogQueryDto, CreateIncidentDto, ListIncidentsQueryDto, UpdateIncidentDto } from './dto/compliance.dto.js';

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;
const INCIDENT_INCLUDE = {
  patient: PERSON,
  staff: { select: { id: true, user: PERSON } },
  reportedBy: PERSON,
  resolvedBy: PERSON,
} satisfies Prisma.IncidentReportInclude;
type IncidentRow = Prisma.IncidentReportGetPayload<{ include: typeof INCIDENT_INCLUDE }>;

type Person = { id: string; firstName: string; lastName: string };
export interface IncidentView {
  id: string;
  incidentType: string;
  severity: string;
  status: string;
  incidentDate: string;
  incidentTime: string | null;
  description: string;
  actionsTaken: string | null;
  followUpRequired: boolean;
  followUpNotes: string | null;
  patient: Person | null;
  staff: Person | null;
  visitId: string | null;
  reportedBy: Person;
  resolvedBy: Person | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface HipaaCheck {
  area: string;
  item: string;
  ok: boolean;
  detail: string;
}

/**
 * Compliance (DESIGN.md §6.12, DECISIONS D-062): the at-a-glance dashboard, incident reports, the audit-log search and a
 * HIPAA safeguards checklist computed from the running configuration. Credential expiry alerts run as a daily job.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly patients: PatientsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async dashboard(caller: AuthUser) {
    const agencyId = caller.agencyId;
    const today = await this.clock.todayString(agencyId);
    const monthAgo = toDate(addDays(today, -30))!;
    const activeStaff = { staffProfile: { agencyId, isActive: true } };
    const [
      credentialsExpired,
      credentialsExpiring,
      incidentsOpen,
      incidentsSerious,
      incidentsLast30,
      missedVisits30,
      evvToReview,
      ordersOverdue,
      carePlansEnding,
      assessmentsAwaitingApproval,
      adminsWithout2fa,
    ] = await Promise.all([
      this.prisma.staffCredential.count({ where: { ...activeStaff, expiryDate: { lt: toDate(today) } } }),
      this.prisma.staffCredential.count({ where: { ...activeStaff, expiryDate: { gte: toDate(today), lte: toDate(addDays(today, 30)) } } }),
      this.prisma.incidentReport.count({ where: { agencyId, status: { in: ['open', 'investigating'] } } }),
      this.prisma.incidentReport.count({ where: { agencyId, status: { in: ['open', 'investigating'] }, severity: { in: ['high', 'critical'] } } }),
      this.prisma.incidentReport.count({ where: { agencyId, incidentDate: { gte: monthAgo } } }),
      this.prisma.visit.count({ where: { agencyId, status: 'missed', scheduledDate: { gte: monthAgo } } }),
      this.prisma.evvRecord.count({ where: { agencyId, OR: [{ status: 'exception' }, { exceptions: { some: { status: 'pending' } } }] } }),
      this.prisma.physicianOrder.count({
        where: { patient: { agencyId }, status: { in: ['pending', 'sent'] }, orderedDate: { lt: toDate(addDays(today, -30)) } },
      }),
      this.prisma.carePlan.count({
        where: { patient: { agencyId, status: 'active' }, status: 'active', certificationPeriodEnd: { lte: toDate(addDays(today, 14)) } },
      }),
      this.prisma.assessment.count({ where: { patient: { agencyId }, status: 'completed' } }),
      this.prisma.user.count({
        where: { agencyId, isActive: true, is2faEnabled: false, userRoles: { some: { role: { name: { in: [...MANDATORY_TWO_FACTOR_ROLES] } } } } },
      }),
    ]);
    return {
      today,
      credentials: { expired: credentialsExpired, expiringWithin30Days: credentialsExpiring },
      incidents: { open: incidentsOpen, openHighOrCritical: incidentsSerious, last30Days: incidentsLast30 },
      visits: { missedLast30Days: missedVisits30, evvToReview },
      clinical: { ordersUnsignedOver30Days: ordersOverdue, carePlansEndingWithin14Days: carePlansEnding, assessmentsAwaitingApproval },
      security: { adminsWithout2fa },
    };
  }

  // ── Incidents ─────────────────────────────────────────────────────────────────────────────────────

  async listIncidents(caller: AuthUser, query: ListIncidentsQueryDto): Promise<Paginated<IncidentView>> {
    const where: Prisma.IncidentReportWhereInput = {
      agencyId: caller.agencyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.incidentReport.findMany({
        where,
        include: INCIDENT_INCLUDE,
        orderBy: [{ incidentDate: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.incidentReport.count({ where }),
    ]);
    return Paginated.of(rows.map(toIncident), total, query);
  }

  async getIncident(caller: AuthUser, id: string): Promise<IncidentView> {
    return toIncident(await this.findIncident(caller, id));
  }

  async createIncident(caller: AuthUser, dto: CreateIncidentDto): Promise<IncidentView> {
    const today = await this.clock.todayString(caller.agencyId);
    if (dto.incidentDate > today) throw new BadRequestException('The incident date can’t be in the future');
    if (dto.patientId) await this.patients.assertAccessible(caller, dto.patientId);
    if (dto.staffId) {
      const found = await this.prisma.staffProfile.count({ where: { id: dto.staffId, agencyId: caller.agencyId } });
      if (!found) throw new BadRequestException('staffId does not match a staff member in this agency');
    }
    if (dto.visitId) {
      const visit = await this.prisma.visit.findFirst({ where: { id: dto.visitId, agencyId: caller.agencyId }, select: { patientId: true } });
      if (!visit) throw new BadRequestException('visitId does not match a visit in this agency');
      if (dto.patientId && visit.patientId !== dto.patientId) throw new BadRequestException('The visit is for a different patient');
    }
    const row = await this.prisma.incidentReport.create({
      data: {
        agencyId: caller.agencyId,
        reportedById: caller.userId,
        incidentType: dto.incidentType,
        severity: dto.severity,
        incidentDate: toDate(dto.incidentDate)!,
        incidentTime: dto.incidentTime ?? null,
        description: dto.description,
        actionsTaken: dto.actionsTaken ?? null,
        followUpRequired: dto.followUpRequired ?? false,
        patientId: dto.patientId ?? null,
        staffId: dto.staffId ?? null,
        visitId: dto.visitId ?? null,
      },
      include: INCIDENT_INCLUDE,
    });
    // Serious incidents reach whoever handles compliance right away. No PHI in the alert.
    if (dto.severity === 'high' || dto.severity === 'critical') {
      await this.notifications.notify({
        agencyId: caller.agencyId,
        userIds: await this.usersWithPermission(caller.agencyId, 'compliance', 'update'),
        type: 'system',
        title: `New ${dto.severity} incident report`,
        body: 'Open Compliance → Incidents to review it.',
        data: { incidentId: row.id },
        actorUserId: caller.userId,
      });
    }
    return toIncident(row);
  }

  async updateIncident(caller: AuthUser, id: string, dto: UpdateIncidentDto): Promise<IncidentView> {
    const incident = await this.findIncident(caller, id);
    if (incident.status === 'closed') throw new ConflictException('A closed incident can’t be changed');
    const resolving = (dto.status === 'resolved' || dto.status === 'closed') && !incident.resolvedAt;
    const reopening = (dto.status === 'open' || dto.status === 'investigating') && Boolean(incident.resolvedAt);
    const row = await this.prisma.incidentReport.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
        ...(dto.actionsTaken !== undefined ? { actionsTaken: dto.actionsTaken || null } : {}),
        ...(dto.followUpRequired !== undefined ? { followUpRequired: dto.followUpRequired } : {}),
        ...(dto.followUpNotes !== undefined ? { followUpNotes: dto.followUpNotes || null } : {}),
        ...(resolving ? { resolvedAt: new Date(), resolvedById: caller.userId } : {}),
        ...(reopening ? { resolvedAt: null, resolvedById: null } : {}),
      },
      include: INCIDENT_INCLUDE,
    });
    return toIncident(row);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────────────────────────

  /** Who did what, newest first. Details never contain PHI (D-023), so they're returned as recorded. */
  async auditLogs(caller: AuthUser, query: AuditLogQueryDto) {
    if (query.from && query.to && query.to < query.from) throw new BadRequestException('to cannot be before from');
    const where: Prisma.AuditLogWhereInput = {
      agencyId: caller.agencyId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
              ...(query.to ? { lt: new Date(`${addDays(query.to, 1)}T00:00:00Z`) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.limit }),
      this.prisma.auditLog.count({ where }),
    ]);
    const userIds = [...new Set(rows.map((r) => r.userId).filter((u): u is string => Boolean(u)))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return Paginated.of(
      rows.map((r) => ({
        id: r.id.toString(),
        createdAt: r.createdAt,
        user: r.userId ? (byId.get(r.userId) ?? { id: r.userId, firstName: null, lastName: null, email: null }) : null,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        details: r.details,
        ipAddress: r.ipAddress,
      })),
      total,
      query,
    );
  }

  // ── HIPAA checklist ───────────────────────────────────────────────────────────────────────────────

  /**
   * Technical safeguards the system can verify about itself (45 CFR 164.312) — not a substitute for the agency's risk
   * assessment, policies, training and BAAs, which are listed as reminders.
   */
  async hipaaChecklist(caller: AuthUser): Promise<HipaaCheck[]> {
    const env = (k: keyof EnvironmentVariables) => this.config.get(k, { infer: true });
    const production = env('APP_ENV') === 'production';
    const [admins, adminsWith2fa, auditToday] = await Promise.all([
      this.prisma.user.count({ where: { agencyId: caller.agencyId, isActive: true, userRoles: { some: { role: { name: { in: [...MANDATORY_TWO_FACTOR_ROLES] } } } } } }),
      this.prisma.user.count({
        where: { agencyId: caller.agencyId, isActive: true, is2faEnabled: true, userRoles: { some: { role: { name: { in: [...MANDATORY_TWO_FACTOR_ROLES] } } } } },
      }),
      this.prisma.auditLog.count({ where: { agencyId: caller.agencyId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    const idle = Number(env('SESSION_IDLE_TIMEOUT_MINUTES'));
    return [
      { area: 'Access control', item: 'Unique user sign-in, role-based permissions', ok: true, detail: 'Every request is authenticated; permissions checked per route (D-020, D-022).' },
      { area: 'Access control', item: 'Two-factor authentication for administrators', ok: admins === adminsWith2fa, detail: `${adminsWith2fa} of ${admins} active administrators have it on.` },
      { area: 'Access control', item: 'Automatic sign-out when idle', ok: idle <= 30, detail: `Sessions end after ${idle} minutes without activity.` },
      { area: 'Audit controls', item: 'Access to patient data is logged', ok: auditToday > 0, detail: `${auditToday} audit entries in the last 24 hours.` },
      { area: 'Integrity', item: 'Documents checked against their upload fingerprint', ok: true, detail: 'SHA-256 verified on every download and before signing (D-056).' },
      { area: 'Encryption', item: 'Sensitive fields and files encrypted at rest', ok: Boolean(env('PHI_ENCRYPTION_KEY')), detail: 'AES-256-GCM for SSNs, 2FA secrets, messages and documents (D-017).' },
      { area: 'Encryption', item: 'Encryption in transit', ok: production, detail: production ? 'Production must be served over HTTPS only.' : 'Development environment — HTTPS is set up with hosting (P4-10).' },
      { area: 'Availability', item: 'Rate limiting on sign-in', ok: !env('RATE_LIMITS_DISABLED'), detail: 'Brute-force protection plus account lockout after 5 wrong passwords.' },
      { area: 'Administrative (agency)', item: 'Business Associate Agreements signed', ok: false, detail: 'Hosting, email/SMS and clearinghouse BAAs — to confirm before going live.' },
      { area: 'Administrative (agency)', item: 'Risk assessment, policies and staff HIPAA training', ok: false, detail: 'Agency responsibility; record completion dates in your compliance binder.' },
    ];
  }

  private async findIncident(caller: AuthUser, id: string): Promise<IncidentRow> {
    const row = await this.prisma.incidentReport.findFirst({ where: { id, agencyId: caller.agencyId }, include: INCIDENT_INCLUDE });
    if (!row) throw new NotFoundException('Incident not found');
    return row;
  }

  /** Active users in the agency whose role (built-in or this agency's) grants the permission. */
  async usersWithPermission(agencyId: string, resource: string, action: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        agencyId,
        isActive: true,
        userRoles: {
          some: { role: { OR: [{ agencyId: null }, { agencyId }], rolePermissions: { some: { permission: { resource, action } } } } },
        },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}

function toIncident(r: IncidentRow): IncidentView {
  return {
    id: r.id,
    incidentType: r.incidentType,
    severity: r.severity,
    status: r.status,
    incidentDate: fromDate(r.incidentDate)!,
    incidentTime: r.incidentTime,
    description: r.description,
    actionsTaken: r.actionsTaken,
    followUpRequired: r.followUpRequired,
    followUpNotes: r.followUpNotes,
    patient: r.patient,
    staff: r.staff ? { id: r.staff.id, firstName: r.staff.user.firstName, lastName: r.staff.user.lastName } : null,
    visitId: r.visitId,
    reportedBy: r.reportedBy,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
  };
}
