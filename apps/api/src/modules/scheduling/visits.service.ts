import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VisitType } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, fromTime, toDate, toTime } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationsService } from '../billing/authorizations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { ConflictDetectorService, type Conflict, type ProposedVisit } from './conflict-detector.service.js';
import type {
  CalendarQueryDto,
  ConflictCheckQueryDto,
  CreateVisitDto,
  ListVisitsQueryDto,
  UpdateVisitDto,
} from './dto/scheduling.dto.js';

const VISIT_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  staff: {
    select: { id: true, discipline: true, userId: true, user: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.VisitInclude;
type VisitRow = Prisma.VisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

export interface VisitView {
  id: string;
  patient: { id: string; firstName: string; lastName: string };
  staff: { id: string; firstName: string; lastName: string; discipline: string } | null;
  visitType: string;
  serviceCode: string | null;
  status: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: Date | null;
  actualEnd: Date | null;
  priority: string;
  notes: string | null;
  cancelReason: string | null;
  isRecurring: boolean;
  createdAt: Date;
}

/** Create/update responses: the visit plus any non-blocking warnings the scheduler should see. */
export interface VisitWithWarnings extends VisitView {
  warnings: Conflict[];
}

const MAX_CALENDAR_DAYS = 62;

/**
 * Visits (DESIGN.md §6.5). Access (DECISIONS D-030): agency-scoped; `visits:read_all` sees every visit,
 * otherwise only the caller's own. Only `scheduled` visits can be changed or cancelled here — clocking in/out
 * (EVV, P2-01) moves them on.
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conflicts: ConflictDetectorService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly authorizations: AuthorizationsService,
  ) {}

  async list(caller: AuthUser, query: ListVisitsQueryDto): Promise<Paginated<VisitView>> {
    const where: Prisma.VisitWhereInput = {
      AND: [
        await this.scope(caller),
        query.from ? { scheduledDate: { gte: toDate(query.from) } } : {},
        query.to ? { scheduledDate: { lte: toDate(query.to) } } : {},
        query.patientId ? { patientId: query.patientId } : {},
        query.staffId ? { staffId: query.staffId } : {},
        query.status ? { status: query.status } : {},
        query.unassigned ? { staffId: null } : {},
      ],
    };
    const [visits, total] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        include: VISIT_INCLUDE,
        orderBy: [{ scheduledDate: 'asc' }, { scheduledStart: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.visit.count({ where }),
    ]);
    return Paginated.of(visits.map(toView), total, query);
  }

  /** Visits grouped by day for a calendar (at most 62 days); every day in the range is present. */
  async calendar(caller: AuthUser, query: CalendarQueryDto): Promise<{ date: string; visits: VisitView[] }[]> {
    if (query.to < query.from) throw new BadRequestException('to cannot be before from');
    if (query.to > addDays(query.from, MAX_CALENDAR_DAYS - 1)) {
      throw new BadRequestException(`The calendar range can be at most ${MAX_CALENDAR_DAYS} days`);
    }
    const visits = await this.prisma.visit.findMany({
      where: {
        AND: [
          await this.scope(caller),
          { scheduledDate: { gte: toDate(query.from), lte: toDate(query.to) } },
          query.staffId ? { staffId: query.staffId } : {},
          query.patientId ? { patientId: query.patientId } : {},
          query.includeCancelled ? {} : { status: { not: 'cancelled' } },
        ],
      },
      include: VISIT_INCLUDE,
      orderBy: [{ scheduledDate: 'asc' }, { scheduledStart: 'asc' }],
      take: 5000,
    });
    const byDay = new Map<string, VisitView[]>();
    for (let day = query.from; day <= query.to; day = addDays(day, 1)) byDay.set(day, []);
    for (const visit of visits) byDay.get(fromDate(visit.scheduledDate)!)?.push(toView(visit));
    return [...byDay].map(([date, dayVisits]) => ({ date, visits: dayVisits }));
  }

  async get(caller: AuthUser, id: string): Promise<VisitView> {
    return toView(await this.find(caller, id));
  }

  async create(caller: AuthUser, dto: CreateVisitDto): Promise<VisitWithWarnings> {
    await this.assertReferences(caller, dto.patientId, dto.staffId);
    assertTimes(dto.scheduledStart, dto.scheduledEnd);
    const proposal = proposalFrom(caller, dto);
    const warnings = await this.checkOrThrow(caller, proposal, dto.override);
    const { authorizationId } = await this.authorizations.match(proposal);

    const visit = await this.prisma.visit.create({
      data: {
        agencyId: caller.agencyId,
        authorizationId,
        patientId: dto.patientId,
        staffId: dto.staffId ?? null,
        visitType: dto.visitType,
        serviceCode: dto.serviceCode ?? null,
        scheduledDate: toDate(dto.scheduledDate)!,
        scheduledStart: toTime(dto.scheduledStart),
        scheduledEnd: toTime(dto.scheduledEnd),
        priority: dto.priority ?? 'normal',
        notes: dto.notes ?? null,
        createdById: caller.userId,
      },
      include: VISIT_INCLUDE,
    });
    await this.notifyCaregiver(caller, visit, 'shift_assigned', 'New visit assigned');
    return { ...toView(visit), warnings };
  }

  /** Reschedule, reassign or edit a scheduled visit. Conflicts are re-checked against the merged result. */
  async update(caller: AuthUser, id: string, dto: UpdateVisitDto): Promise<VisitWithWarnings> {
    const existing = await this.find(caller, id);
    if (existing.status !== 'scheduled') {
      throw new ConflictException(`Only scheduled visits can be changed (this one is ${existing.status})`);
    }
    const merged = {
      patientId: existing.patientId,
      staffId: dto.staffId === undefined ? existing.staffId : dto.staffId,
      visitType: (dto.visitType ?? existing.visitType) as VisitType,
      scheduledDate: dto.scheduledDate ?? fromDate(existing.scheduledDate)!,
      scheduledStart: dto.scheduledStart ?? fromTime(existing.scheduledStart),
      scheduledEnd: dto.scheduledEnd ?? fromTime(existing.scheduledEnd),
      serviceCode: dto.serviceCode === undefined ? existing.serviceCode : dto.serviceCode,
    };
    if (dto.staffId) await this.assertReferences(caller, existing.patientId, dto.staffId);
    assertTimes(merged.scheduledStart, merged.scheduledEnd);
    const proposal = { ...merged, agencyId: caller.agencyId, excludeVisitId: id };
    const warnings = await this.checkOrThrow(caller, proposal, dto.override, id);
    // Date, time or code may have changed: re-link to the authorization that now covers it (D-050).
    const { authorizationId } = await this.authorizations.match(proposal);

    const data: Prisma.VisitUncheckedUpdateInput = {
      staffId: merged.staffId,
      visitType: merged.visitType,
      scheduledDate: toDate(merged.scheduledDate),
      scheduledStart: toTime(merged.scheduledStart),
      scheduledEnd: toTime(merged.scheduledEnd),
      authorizationId,
    };
    if (dto.serviceCode !== undefined) data.serviceCode = dto.serviceCode;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.notes !== undefined) data.notes = dto.notes;
    const visit = await this.prisma.visit.update({ where: { id }, data, include: VISIT_INCLUDE });

    const reassigned = existing.staffId !== visit.staffId;
    if (reassigned) await this.closeOffers(caller, id, visit.staffId ? 'filled' : null);
    const moved =
      fromDate(existing.scheduledDate) !== fromDate(visit.scheduledDate) ||
      fromTime(existing.scheduledStart) !== fromTime(visit.scheduledStart) ||
      fromTime(existing.scheduledEnd) !== fromTime(visit.scheduledEnd);
    if (reassigned) {
      await this.notifyCaregiver(caller, existing, 'shift_unassigned', 'A visit was reassigned');
      await this.notifyCaregiver(caller, visit, 'shift_assigned', 'New visit assigned');
    } else if (moved) {
      await this.notifyCaregiver(caller, visit, 'shift_updated', 'A visit was rescheduled');
    }
    return { ...toView(visit), warnings };
  }

  async cancel(caller: AuthUser, id: string, reason: string): Promise<VisitView> {
    const existing = await this.find(caller, id);
    if (existing.status !== 'scheduled') {
      throw new ConflictException(`Only scheduled visits can be cancelled (this one is ${existing.status})`);
    }
    const visit = await this.prisma.visit.update({
      where: { id },
      data: { status: 'cancelled', cancelReason: reason },
      include: VISIT_INCLUDE,
    });
    await this.closeOffers(caller, id, 'cancelled');
    await this.notifyCaregiver(caller, visit, 'shift_cancelled', 'A visit was cancelled');
    return toView(visit);
  }

  /**
   * Keeps open shifts and swap requests in step with direct edits (D-040): assigning the visit fills its open shift,
   * cancelling cancels it; any reassignment or cancellation withdraws pending swap requests.
   */
  private async closeOffers(caller: AuthUser, visitId: string, openShift: 'filled' | 'cancelled' | null): Promise<void> {
    if (openShift) {
      await this.prisma.openShift.updateMany({
        where: { visitId, status: 'open' },
        data:
          openShift === 'filled'
            ? { status: 'filled', assignedById: caller.userId, assignedAt: new Date() }
            : { status: 'cancelled' },
      });
    }
    await this.prisma.shiftSwapRequest.updateMany({
      where: { visitId, status: 'pending' },
      data: { status: 'cancelled', decisionNote: 'The visit was changed by the office' },
    });
  }

  /** Tells the visit's caregiver (if any, and not the person making the change). No PHI in the text. */
  private async notifyCaregiver(
    caller: AuthUser,
    visit: VisitRow,
    type: 'shift_assigned' | 'shift_unassigned' | 'shift_updated' | 'shift_cancelled',
    title: string,
  ): Promise<void> {
    if (!visit.staff) return;
    const when = `${fromDate(visit.scheduledDate)} at ${fromTime(visit.scheduledStart)}`;
    const body = {
      shift_assigned: `You have a visit on ${when}. Open the app for details.`,
      shift_unassigned: `Your visit on ${when} has been given to someone else.`,
      shift_updated: `Your visit is now on ${when}. Open the app for details.`,
      shift_cancelled: `Your visit on ${when} was cancelled.`,
    }[type];
    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: [visit.staff.userId],
      actorUserId: caller.userId,
      type,
      title,
      body,
      data: { visitId: visit.id },
    });
  }

  /** Pre-check a visit before saving it; nothing is written. */
  async checkConflicts(caller: AuthUser, query: ConflictCheckQueryDto): Promise<Conflict[]> {
    await this.assertReferences(caller, query.patientId, query.staffId);
    assertTimes(query.scheduledStart, query.scheduledEnd);
    return this.conflicts.check({ ...proposalFrom(caller, query), excludeVisitId: query.excludeVisitId });
  }

  /** Blocking conflicts stop the save unless overridden by someone with visits:approve (audited). Returns the warnings. Also used by open shifts and swaps. */
  async checkOrThrow(
    caller: AuthUser,
    proposal: Parameters<ConflictDetectorService['check']>[0],
    override: boolean | undefined,
    visitId?: string,
  ): Promise<Conflict[]> {
    const found = await this.conflicts.check(proposal);
    const blocking = found.filter((c) => c.severity === 'blocking');
    if (blocking.length && !override) {
      throw new ConflictException({
        message: 'The visit conflicts with the schedule',
        code: 'SCHEDULE_CONFLICT',
        details: blocking,
      });
    }
    if (blocking.length) {
      const access = await this.permissions.forUser(caller);
      if (!access.permissions.has('visits:approve')) {
        throw new ForbiddenException('Overriding schedule conflicts requires the visits:approve permission');
      }
      await this.audit.record({
        agencyId: caller.agencyId,
        userId: caller.userId,
        action: 'OVERRIDE_SCHEDULE_CONFLICT',
        resourceType: 'visits',
        resourceId: visitId,
        details: { conflicts: blocking.map((c) => c.code) },
      });
    }
    return found.filter((c) => c.severity === 'warning');
  }

  private async scope(caller: AuthUser): Promise<Prisma.VisitWhereInput> {
    const access = await this.permissions.forUser(caller);
    if (access.permissions.has('visits:read_all')) return { agencyId: caller.agencyId };
    return { agencyId: caller.agencyId, staff: { userId: caller.userId } };
  }

  private async find(caller: AuthUser, id: string): Promise<VisitRow> {
    const visit = await this.prisma.visit.findFirst({
      where: { AND: [{ id }, await this.scope(caller)] },
      include: VISIT_INCLUDE,
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  /** Patient and caregiver must belong to the caller's agency. */
  private async assertReferences(caller: AuthUser, patientId: string, staffId?: string | null): Promise<void> {
    const [patient, staff] = await Promise.all([
      this.prisma.patient.count({ where: { id: patientId, agencyId: caller.agencyId } }),
      staffId ? this.prisma.staffProfile.count({ where: { id: staffId, agencyId: caller.agencyId } }) : 1,
    ]);
    if (!patient) throw new BadRequestException('patientId does not match a patient in this agency');
    if (!staff) throw new BadRequestException('staffId does not match a staff member in this agency');
  }
}

/** The fields the conflict detector needs, copied explicitly from a request. */
function proposalFrom(
  caller: AuthUser,
  source: Pick<CreateVisitDto, 'patientId' | 'staffId' | 'visitType' | 'scheduledDate' | 'scheduledStart' | 'scheduledEnd'> & {
    serviceCode?: string | null;
  },
): ProposedVisit {
  return {
    agencyId: caller.agencyId,
    patientId: source.patientId,
    staffId: source.staffId ?? null,
    visitType: source.visitType,
    scheduledDate: source.scheduledDate,
    scheduledStart: source.scheduledStart,
    scheduledEnd: source.scheduledEnd,
    serviceCode: source.serviceCode ?? null,
  };
}

function assertTimes(start: string, end: string): void {
  if (end <= start) throw new BadRequestException('scheduledEnd must be after scheduledStart');
}

function toView(visit: VisitRow): VisitView {
  return {
    id: visit.id,
    patient: visit.patient,
    staff: visit.staff
      ? {
          id: visit.staff.id,
          firstName: visit.staff.user.firstName,
          lastName: visit.staff.user.lastName,
          discipline: visit.staff.discipline,
        }
      : null,
    visitType: visit.visitType,
    serviceCode: visit.serviceCode,
    status: visit.status,
    scheduledDate: fromDate(visit.scheduledDate)!,
    scheduledStart: fromTime(visit.scheduledStart),
    scheduledEnd: fromTime(visit.scheduledEnd),
    actualStart: visit.actualStart,
    actualEnd: visit.actualEnd,
    priority: visit.priority,
    notes: visit.notes,
    cancelReason: visit.cancelReason,
    isRecurring: visit.isRecurring,
    createdAt: visit.createdAt,
  };
}
