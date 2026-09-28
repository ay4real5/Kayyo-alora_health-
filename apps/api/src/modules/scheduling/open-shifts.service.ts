import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  disciplineFits,
  VISIT_TYPE_DISCIPLINES,
  VISIT_TYPES,
  zonedTimeToUtc,
  type VisitType,
} from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { fromDate, fromTime, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { ConflictDetectorService, type Conflict } from './conflict-detector.service.js';
import type {
  AssignOpenShiftDto,
  CreateOpenShiftDto,
  ListOpenShiftsQueryDto,
} from './dto/open-shifts.dto.js';
import { VisitsService } from './visits.service.js';

const SHIFT_INCLUDE = {
  visit: {
    select: {
      id: true,
      status: true,
      staffId: true,
      visitType: true,
      scheduledDate: true,
      scheduledStart: true,
      scheduledEnd: true,
      priority: true,
      staff: {
        select: {
          id: true,
          discipline: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
      patient: { select: { id: true, firstName: true, lastName: true, city: true, zip: true } },
    },
  },
} satisfies Prisma.OpenShiftInclude;
type ShiftRow = Prisma.OpenShiftGetPayload<{ include: typeof SHIFT_INCLUDE }>;

export interface OpenShiftView {
  id: string;
  status: string;
  /** `open` past its expiry reads as expired; it can't be claimed. */
  expired: boolean;
  notes: string | null;
  expiresAt: Date | null;
  broadcastAt: Date | null;
  visit: {
    id: string;
    visitType: string;
    scheduledDate: string;
    scheduledStart: string;
    scheduledEnd: string;
    priority: string;
    /** Disciplines that can take it. */
    disciplines: readonly string[];
  };
  /** Where, roughly — all a caregiver sees before claiming. */
  area: { city: string | null; zip: string | null };
  /** Only for schedulers (`visits:read_all`); caregivers see the patient once the visit is theirs. */
  patient: { id: string; firstName: string; lastName: string } | null;
  filledBy: {
    staffId: string;
    firstName: string;
    lastName: string;
    discipline: string;
    how: 'claimed' | 'assigned';
  } | null;
  createdAt: Date;
}

/**
 * Open shifts (DESIGN.md §6.5, DECISIONS D-040): an unassigned visit offered to caregivers. Eligible caregivers
 * (right discipline, no blocking conflict, credentials current) claim it first-come-first-served; schedulers can
 * assign it directly. Offers carry no PHI to caregivers: area and time only.
 */
@Injectable()
export class OpenShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly conflicts: ConflictDetectorService,
    private readonly visits: VisitsService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(caller: AuthUser, query: ListOpenShiftsQueryDto): Promise<Paginated<OpenShiftView>> {
    const scheduler = await this.isScheduler(caller);
    const today = await this.clock.todayString(caller.agencyId);
    let where: Prisma.OpenShiftWhereInput;
    if (scheduler) {
      where = {
        agencyId: caller.agencyId,
        ...(query.status ? { status: query.status } : {}),
        visit: {
          scheduledDate: {
            ...(query.from ? { gte: toDate(query.from) } : {}),
            ...(query.to ? { lte: toDate(query.to) } : {}),
          },
        },
      };
    } else {
      // Caregivers: what they could claim right now.
      const staff = await this.ownStaff(caller);
      const types = staff ? VISIT_TYPES.filter((t) => disciplineFits(t, staff.discipline)) : [];
      where = {
        agencyId: caller.agencyId,
        status: 'open',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        visit: {
          status: 'scheduled',
          staffId: null,
          visitType: { in: types },
          scheduledDate: {
            gte: toDate(query.from && query.from > today ? query.from : today),
            ...(query.to ? { lte: toDate(query.to) } : {}),
          },
        },
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.openShift.findMany({
        where,
        include: SHIFT_INCLUDE,
        orderBy: [{ visit: { scheduledDate: 'asc' } }, { visit: { scheduledStart: 'asc' } }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.openShift.count({ where }),
    ]);
    return Paginated.of(
      rows.map((r) => toView(r, scheduler)),
      total,
      query,
    );
  }

  async get(caller: AuthUser, id: string): Promise<OpenShiftView> {
    const scheduler = await this.isScheduler(caller);
    const shift = await this.find(caller, id);
    if (
      !scheduler &&
      shift.status !== 'open' &&
      shift.claimedById !== (await this.ownStaff(caller))?.id
    ) {
      throw new NotFoundException('Open shift not found');
    }
    return toView(shift, scheduler);
  }

  /** Offers a scheduled visit. An assigned caregiver is taken off it (and told), e.g. after a call-out. */
  async create(caller: AuthUser, dto: CreateOpenShiftDto): Promise<OpenShiftView> {
    const visit = await this.prisma.visit.findFirst({
      where: { id: dto.visitId, agencyId: caller.agencyId },
      include: { staff: { select: { userId: true } } },
    });
    if (!visit) throw new BadRequestException('visitId does not match a visit in this agency');
    if (visit.status !== 'scheduled') throw new ConflictException(`This visit is ${visit.status}`);
    if ((await this.startsAt(caller.agencyId, visit)) <= new Date()) {
      throw new ConflictException('This visit has already started');
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date())
      throw new BadRequestException('expiresAt must be in the future');

    const shift = await this.prisma.$transaction(async (tx) => {
      if (visit.staffId) {
        await tx.visit.update({ where: { id: visit.id }, data: { staffId: null } });
        await tx.shiftSwapRequest.updateMany({
          where: { visitId: visit.id, status: 'pending' },
          data: { status: 'cancelled', decisionNote: 'The visit became an open shift' },
        });
      }
      return tx.openShift.create({
        data: {
          agencyId: caller.agencyId,
          visitId: visit.id,
          notes: dto.notes ?? null,
          expiresAt,
          createdById: caller.userId,
        },
        include: SHIFT_INCLUDE,
      });
    });
    if (visit.staff) {
      await this.notifications.notify({
        agencyId: caller.agencyId,
        userIds: [visit.staff.userId],
        actorUserId: caller.userId,
        type: 'shift_unassigned',
        title: 'A visit was taken off your schedule',
        body: `Your visit on ${fromDate(visit.scheduledDate)} at ${fromTime(visit.scheduledStart)} is now an open shift.`,
        data: { visitId: visit.id },
      });
    }
    return toView(shift, true);
  }

  /** Notifies every caregiver who could take it (right discipline, active, no blocking conflict). */
  async broadcast(caller: AuthUser, id: string): Promise<{ notified: number }> {
    const shift = await this.openShift(caller, id);
    const visitType = shift.visit.visitType as VisitType;
    const candidates = await this.prisma.staffProfile.findMany({
      where: {
        agencyId: caller.agencyId,
        isActive: true,
        discipline: { in: [...VISIT_TYPE_DISCIPLINES[visitType]] },
        user: { isActive: true },
      },
      select: { id: true, userId: true },
    });
    // Conflict checks in small parallel batches: fast enough for an agency's staff list, gentle on the pool.
    const eligible: string[] = [];
    for (let i = 0; i < candidates.length; i += 5) {
      const batch = candidates.slice(i, i + 5);
      const checked = await Promise.all(
        batch.map(async (staff) => ({
          staff,
          blocked: (await this.conflicts.check(this.proposal(caller, shift, staff.id))).some(
            (c) => c.severity === 'blocking',
          ),
        })),
      );
      eligible.push(...checked.filter((c) => !c.blocked).map((c) => c.staff.userId));
    }
    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: eligible,
      actorUserId: caller.userId,
      type: 'open_shift',
      title: 'Open shift available',
      body: `A ${shift.visit.visitType.replaceAll('_', ' ')} visit on ${fromDate(shift.visit.scheduledDate)} at ${fromTime(shift.visit.scheduledStart)} needs a caregiver. Open the app to claim it.`,
      data: { openShiftId: shift.id },
    });
    await this.prisma.openShift.update({
      where: { id: shift.id },
      data: { broadcastAt: new Date() },
    });
    return { notified: eligible.length };
  }

  /** A caregiver takes the shift. First come, first served; the schedule rules are re-checked for them. */
  async claim(caller: AuthUser, id: string): Promise<OpenShiftView> {
    const staff = await this.ownStaff(caller);
    if (!staff) throw new ForbiddenException('Only caregivers can claim open shifts');
    const shift = await this.openShift(caller, id);
    if (!disciplineFits(shift.visit.visitType as VisitType, staff.discipline)) {
      throw new ForbiddenException(`A ${staff.discipline} can't take this visit`);
    }
    const found = await this.conflicts.check(this.proposal(caller, shift, staff.id));
    const refusing = found.filter(
      (c) => c.severity === 'blocking' || c.code === 'staff_credentials_expired',
    );
    if (refusing.length) {
      throw new ConflictException({
        message: "You can't take this shift",
        code: 'SCHEDULE_CONFLICT',
        details: refusing,
      });
    }
    await this.fill(shift, staff.id, { claimedById: staff.id, claimedAt: new Date() });
    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: [shift.createdById],
      actorUserId: caller.userId,
      type: 'open_shift',
      title: 'Open shift claimed',
      body: `The ${fromDate(shift.visit.scheduledDate)} ${fromTime(shift.visit.scheduledStart)} open shift has been claimed.`,
      data: { openShiftId: shift.id, visitId: shift.visitId },
    });
    return toView(await this.find(caller, id), await this.isScheduler(caller));
  }

  /** A scheduler gives the shift to a caregiver, with the usual conflict rules and override. */
  async assign(
    caller: AuthUser,
    id: string,
    dto: AssignOpenShiftDto,
  ): Promise<OpenShiftView & { warnings: Conflict[] }> {
    const shift = await this.openShift(caller, id, { allowExpired: true });
    const staff = await this.prisma.staffProfile.findFirst({
      where: { id: dto.staffId, agencyId: caller.agencyId },
      select: { id: true, userId: true },
    });
    if (!staff)
      throw new BadRequestException('staffId does not match a staff member in this agency');
    const warnings = await this.visits.checkOrThrow(
      caller,
      this.proposal(caller, shift, staff.id),
      dto.override,
      shift.visitId,
    );
    await this.fill(shift, staff.id, { assignedById: caller.userId, assignedAt: new Date() });
    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: [staff.userId],
      actorUserId: caller.userId,
      type: 'shift_assigned',
      title: 'New visit assigned',
      body: `You have a visit on ${fromDate(shift.visit.scheduledDate)} at ${fromTime(shift.visit.scheduledStart)}. Open the app for details.`,
      data: { visitId: shift.visitId },
    });
    return { ...toView(await this.find(caller, id), true), warnings };
  }

  /** Withdraws the offer; the visit stays unassigned. */
  async cancel(caller: AuthUser, id: string): Promise<OpenShiftView> {
    await this.find(caller, id);
    const done = await this.prisma.openShift.updateMany({
      where: { id, agencyId: caller.agencyId, status: 'open' },
      data: { status: 'cancelled' },
    });
    if (!done.count) throw new ConflictException('Only open shifts can be cancelled');
    return toView(await this.find(caller, id), true);
  }

  /** Marks the shift filled and puts the caregiver on the visit — atomically, so two claims can't both win. */
  private async fill(
    shift: ShiftRow,
    staffId: string,
    who: Pick<
      Prisma.OpenShiftUncheckedUpdateInput,
      'claimedById' | 'claimedAt' | 'assignedById' | 'assignedAt'
    >,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const filled = await tx.openShift.updateMany({
        where: { id: shift.id, status: 'open' },
        data: { status: 'filled', ...who },
      });
      if (!filled.count) throw new ConflictException('Someone else just took this shift');
      const moved = await tx.visit.updateMany({
        where: { id: shift.visitId, status: 'scheduled', staffId: null },
        data: { staffId },
      });
      if (!moved.count) throw new ConflictException('The visit changed; reload it');
    });
  }

  private proposal(caller: AuthUser, shift: ShiftRow, staffId: string) {
    return {
      agencyId: caller.agencyId,
      patientId: shift.visit.patient.id,
      staffId,
      visitType: shift.visit.visitType as VisitType,
      scheduledDate: fromDate(shift.visit.scheduledDate)!,
      scheduledStart: fromTime(shift.visit.scheduledStart),
      scheduledEnd: fromTime(shift.visit.scheduledEnd),
      excludeVisitId: shift.visitId,
    };
  }

  /** An offer that can still be taken: open, not expired, visit still scheduled, unassigned and not yet started. */
  private async openShift(
    caller: AuthUser,
    id: string,
    opts: { allowExpired?: boolean } = {},
  ): Promise<ShiftRow> {
    const shift = await this.find(caller, id);
    if (shift.status !== 'open') throw new ConflictException(`This shift is ${shift.status}`);
    if (!opts.allowExpired && shift.expiresAt && shift.expiresAt <= new Date()) {
      throw new ConflictException('This offer has expired');
    }
    if (shift.visit.status !== 'scheduled' || shift.visit.staffId) {
      throw new ConflictException('The visit is no longer open');
    }
    if ((await this.startsAt(caller.agencyId, shift.visit)) <= new Date()) {
      throw new ConflictException('This visit has already started');
    }
    return shift;
  }

  private async find(caller: AuthUser, id: string): Promise<ShiftRow> {
    const shift = await this.prisma.openShift.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: SHIFT_INCLUDE,
    });
    if (!shift) throw new NotFoundException('Open shift not found');
    return shift;
  }

  private async startsAt(
    agencyId: string,
    visit: { scheduledDate: Date; scheduledStart: Date },
  ): Promise<Date> {
    const zone = await this.clock.timezone(agencyId);
    return zonedTimeToUtc(fromDate(visit.scheduledDate)!, fromTime(visit.scheduledStart), zone);
  }

  private async isScheduler(caller: AuthUser): Promise<boolean> {
    return (await this.permissions.forUser(caller)).permissions.has('visits:read_all');
  }

  private ownStaff(caller: AuthUser) {
    return this.prisma.staffProfile.findFirst({
      where: { userId: caller.userId, agencyId: caller.agencyId, isActive: true },
      select: { id: true, discipline: true },
    });
  }
}

function toView(shift: ShiftRow, scheduler: boolean): OpenShiftView {
  const v = shift.visit;
  return {
    id: shift.id,
    status: shift.status,
    expired: shift.status === 'open' && shift.expiresAt !== null && shift.expiresAt <= new Date(),
    notes: shift.notes,
    expiresAt: shift.expiresAt,
    broadcastAt: shift.broadcastAt,
    visit: {
      id: v.id,
      visitType: v.visitType,
      scheduledDate: fromDate(v.scheduledDate)!,
      scheduledStart: fromTime(v.scheduledStart),
      scheduledEnd: fromTime(v.scheduledEnd),
      priority: v.priority,
      disciplines: VISIT_TYPE_DISCIPLINES[v.visitType as VisitType] ?? [],
    },
    area: { city: v.patient.city, zip: v.patient.zip },
    patient: scheduler
      ? { id: v.patient.id, firstName: v.patient.firstName, lastName: v.patient.lastName }
      : null,
    filledBy:
      shift.status === 'filled' && v.staff
        ? {
            staffId: v.staff.id,
            firstName: v.staff.user.firstName,
            lastName: v.staff.user.lastName,
            discipline: v.staff.discipline,
            how: shift.claimedById ? 'claimed' : 'assigned',
          }
        : null,
    createdAt: shift.createdAt,
  };
}
