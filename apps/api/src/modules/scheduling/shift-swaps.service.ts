import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { zonedTimeToUtc, type VisitType } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { fromDate, fromTime } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import type { Conflict } from './conflict-detector.service.js';
import type {
  CreateShiftSwapDto,
  DecideShiftSwapDto,
  ListShiftSwapsQueryDto,
} from './dto/open-shifts.dto.js';
import { VisitsService } from './visits.service.js';

const STAFF_SELECT = {
  select: {
    id: true,
    userId: true,
    discipline: true,
    user: { select: { firstName: true, lastName: true } },
  },
} as const;
const SWAP_INCLUDE = {
  visit: {
    select: {
      id: true,
      status: true,
      staffId: true,
      patientId: true,
      visitType: true,
      scheduledDate: true,
      scheduledStart: true,
      scheduledEnd: true,
    },
  },
  requesting: STAFF_SELECT,
  target: STAFF_SELECT,
} satisfies Prisma.ShiftSwapRequestInclude;
type SwapRow = Prisma.ShiftSwapRequestGetPayload<{ include: typeof SWAP_INCLUDE }>;
type StaffRef = { id: string; firstName: string; lastName: string; discipline: string };

export interface ShiftSwapView {
  id: string;
  status: string;
  reason: string | null;
  decisionNote: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  visit: {
    id: string;
    visitType: string;
    scheduledDate: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
  requesting: StaffRef;
  /** null: back to the pool — approving turns the visit into an open shift. */
  target: StaffRef | null;
  createdAt: Date;
}

/**
 * Shift swaps (DESIGN.md §6.5, DECISIONS D-040). A caregiver asks to hand one of their upcoming visits to a colleague
 * or back to the pool; a scheduler with `visits:approve` decides. Approval re-checks the colleague's schedule (with
 * the usual override) or turns the visit into an open shift.
 */
@Injectable()
export class ShiftSwapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly visits: VisitsService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(caller: AuthUser, query: ListShiftSwapsQueryDto): Promise<Paginated<ShiftSwapView>> {
    const access = await this.permissions.forUser(caller);
    const where: Prisma.ShiftSwapRequestWhereInput = {
      agencyId: caller.agencyId,
      ...(query.status ? { status: query.status } : {}),
      ...(access.permissions.has('visits:read_all')
        ? {}
        : {
            OR: [{ requesting: { userId: caller.userId } }, { target: { userId: caller.userId } }],
          }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.shiftSwapRequest.findMany({
        where,
        include: SWAP_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.shiftSwapRequest.count({ where }),
    ]);
    return Paginated.of(rows.map(toView), total, query);
  }

  async create(caller: AuthUser, dto: CreateShiftSwapDto): Promise<ShiftSwapView> {
    const own = await this.prisma.staffProfile.findFirst({
      where: { userId: caller.userId, agencyId: caller.agencyId },
      select: { id: true },
    });
    const visit = own
      ? await this.prisma.visit.findFirst({
          where: { id: dto.visitId, agencyId: caller.agencyId, staffId: own.id },
        })
      : null;
    if (!own || !visit) throw new NotFoundException('Visit not found');
    if (visit.status !== 'scheduled') throw new ConflictException(`This visit is ${visit.status}`);
    if ((await this.startsAt(caller.agencyId, visit)) <= new Date()) {
      throw new ConflictException('This visit has already started');
    }
    if (dto.targetStaffId) {
      if (dto.targetStaffId === own.id)
        throw new BadRequestException("You can't swap a visit with yourself");
      const target = await this.prisma.staffProfile.count({
        where: { id: dto.targetStaffId, agencyId: caller.agencyId, isActive: true },
      });
      if (!target)
        throw new BadRequestException(
          'targetStaffId does not match an active staff member in this agency',
        );
    }
    // One pending request per visit (partial unique index → 409).
    const swap = await this.prisma.shiftSwapRequest.create({
      data: {
        agencyId: caller.agencyId,
        visitId: visit.id,
        requestingStaffId: own.id,
        targetStaffId: dto.targetStaffId ?? null,
        reason: dto.reason,
      },
      include: SWAP_INCLUDE,
    });
    return toView(swap);
  }

  /** The requester withdraws a pending request. */
  async cancel(caller: AuthUser, id: string): Promise<ShiftSwapView> {
    const swap = await this.find(caller, id);
    if (swap.requesting.userId !== caller.userId)
      throw new ForbiddenException('Only the requester can withdraw this');
    await this.settle(swap.id, { status: 'cancelled' });
    return toView(await this.find(caller, id));
  }

  async decide(
    caller: AuthUser,
    id: string,
    dto: DecideShiftSwapDto,
  ): Promise<ShiftSwapView & { warnings: Conflict[] }> {
    const swap = await this.find(caller, id);
    if (swap.requesting.userId === caller.userId)
      throw new ForbiddenException("You can't decide your own request");
    if (swap.status !== 'pending')
      throw new ConflictException(`This request is already ${swap.status}`);
    const decided = {
      decidedById: caller.userId,
      decidedAt: new Date(),
      decisionNote: dto.note ?? null,
    };
    let warnings: Conflict[] = [];

    if (dto.status === 'denied') {
      await this.settle(swap.id, { status: 'denied', ...decided });
    } else {
      const { visit } = swap;
      if (visit.status !== 'scheduled' || visit.staffId !== swap.requestingStaffId) {
        throw new ConflictException(
          'The visit has changed since the request; deny it and ask again if needed',
        );
      }
      if ((await this.startsAt(caller.agencyId, visit)) <= new Date()) {
        throw new ConflictException('This visit has already started');
      }
      if (swap.targetStaffId) {
        warnings = await this.visits.checkOrThrow(
          caller,
          {
            agencyId: caller.agencyId,
            patientId: visit.patientId,
            staffId: swap.targetStaffId,
            visitType: visit.visitType as VisitType,
            scheduledDate: fromDate(visit.scheduledDate)!,
            scheduledStart: fromTime(visit.scheduledStart),
            scheduledEnd: fromTime(visit.scheduledEnd),
            excludeVisitId: visit.id,
          },
          dto.override,
          visit.id,
        );
      }
      await this.prisma.$transaction(async (tx) => {
        const settled = await tx.shiftSwapRequest.updateMany({
          where: { id: swap.id, status: 'pending' },
          data: { status: 'approved', ...decided },
        });
        if (!settled.count) throw new ConflictException('This request was just decided');
        const moved = await tx.visit.updateMany({
          where: { id: visit.id, status: 'scheduled', staffId: swap.requestingStaffId },
          data: { staffId: swap.targetStaffId },
        });
        if (!moved.count) throw new ConflictException('The visit changed; reload it');
        if (!swap.targetStaffId) {
          await tx.openShift.create({
            data: {
              agencyId: caller.agencyId,
              visitId: visit.id,
              notes: 'Released by the caregiver (approved swap request)',
              createdById: caller.userId,
            },
          });
        }
      });
      if (swap.target) {
        await this.notifications.notify({
          agencyId: caller.agencyId,
          userIds: [swap.target.userId],
          actorUserId: caller.userId,
          type: 'shift_assigned',
          title: 'New visit assigned',
          body: `You have a visit on ${fromDate(visit.scheduledDate)} at ${fromTime(visit.scheduledStart)} (shift swap). Open the app for details.`,
          data: { visitId: visit.id },
        });
      }
    }

    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: [swap.requesting.userId],
      actorUserId: caller.userId,
      type: 'swap_decided',
      title: dto.status === 'approved' ? 'Shift swap approved' : 'Shift swap denied',
      body:
        dto.status === 'approved'
          ? `Your visit on ${fromDate(swap.visit.scheduledDate)} is no longer on your schedule.`
          : `Your visit on ${fromDate(swap.visit.scheduledDate)} stays on your schedule.`,
      data: { swapId: swap.id, visitId: swap.visitId },
    });
    return { ...toView(await this.find(caller, id)), warnings };
  }

  private async settle(
    id: string,
    data: Prisma.ShiftSwapRequestUncheckedUpdateManyInput,
  ): Promise<void> {
    const done = await this.prisma.shiftSwapRequest.updateMany({
      where: { id, status: 'pending' },
      data,
    });
    if (!done.count) throw new ConflictException('Only pending requests can change');
  }

  /** Schedulers see every request; caregivers only the ones they made or are named in. */
  private async find(caller: AuthUser, id: string): Promise<SwapRow> {
    const swap = await this.prisma.shiftSwapRequest.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: SWAP_INCLUDE,
    });
    const access = swap ? await this.permissions.forUser(caller) : null;
    const involved = swap && [swap.requesting.userId, swap.target?.userId].includes(caller.userId);
    if (!swap || (!involved && !access!.permissions.has('visits:read_all'))) {
      throw new NotFoundException('Shift swap request not found');
    }
    return swap;
  }

  private async startsAt(
    agencyId: string,
    visit: { scheduledDate: Date; scheduledStart: Date },
  ): Promise<Date> {
    const zone = await this.clock.timezone(agencyId);
    return zonedTimeToUtc(fromDate(visit.scheduledDate)!, fromTime(visit.scheduledStart), zone);
  }
}

function staffRef(s: SwapRow['requesting']): StaffRef {
  return {
    id: s.id,
    firstName: s.user.firstName,
    lastName: s.user.lastName,
    discipline: s.discipline,
  };
}

function toView(swap: SwapRow): ShiftSwapView {
  return {
    id: swap.id,
    status: swap.status,
    reason: swap.reason,
    decisionNote: swap.decisionNote,
    decidedById: swap.decidedById,
    decidedAt: swap.decidedAt,
    visit: {
      id: swap.visit.id,
      visitType: swap.visit.visitType,
      scheduledDate: fromDate(swap.visit.scheduledDate)!,
      scheduledStart: fromTime(swap.visit.scheduledStart),
      scheduledEnd: fromTime(swap.visit.scheduledEnd),
    },
    requesting: staffRef(swap.requesting),
    target: swap.target ? staffRef(swap.target) : null,
    createdAt: swap.createdAt,
  };
}
