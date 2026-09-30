import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { MAX_TIME_OFF_DAYS, type DecideTimeOffDto, type ListTimeOffQueryDto, type RequestTimeOffDto } from './dto/time-off.dto.js';

const INCLUDE = {
  staffProfile: { select: { id: true, discipline: true, user: { select: { id: true, firstName: true, lastName: true } } } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.StaffTimeOffInclude;
type Row = Prisma.StaffTimeOffGetPayload<{ include: typeof INCLUDE }>;

export interface TimeOffView {
  id: string;
  staff: { id: string; userId: string; firstName: string; lastName: string; discipline: string };
  startDate: string;
  endDate: string;
  days: number;
  type: string;
  status: string;
  notes: string | null;
  decidedBy: { id: string; firstName: string; lastName: string } | null;
  createdAt: Date;
  /** For approvers: the person's visits already booked in those days, which need another caregiver if approved. */
  bookedVisits?: number;
}

/** "Sep 3" — alerts carry dates only, never patient details. */
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const inclusiveDays = (start: string, end: string) => Math.round((toDate(end)!.getTime() - toDate(start)!.getTime()) / 86_400_000) + 1;

/**
 * Time off (D-090): staff ask for days off from the app or dashboard, supervisors approve or deny (`visits:approve`,
 * like shift swaps). Approved time off blocks scheduling on those days and pending time off warns (conflict
 * detector). The requester is told the decision; they can withdraw a request that is pending or hasn't started yet.
 */
@Injectable()
export class TimeOffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(caller: AuthUser, query: ListTimeOffQueryDto): Promise<Paginated<TimeOffView>> {
    const approver = await this.isApprover(caller);
    const own = approver ? null : await this.ownStaffId(caller);
    if (!approver && !own) return Paginated.of([], 0, query);
    const where: Prisma.StaffTimeOffWhereInput = {
      staffProfile: { agencyId: caller.agencyId },
      ...(own ? { staffProfileId: own } : query.staffId ? { staffProfileId: query.staffId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.staffTimeOff.findMany({
        where,
        include: INCLUDE,
        // Pending first (what needs a decision), then soonest.
        orderBy: [{ status: 'desc' }, { startDate: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.staffTimeOff.count({ where }),
    ]);
    const views = rows.map(toView);
    if (approver) {
      for (const v of views.filter((x) => x.status === 'pending')) v.bookedVisits = await this.bookedVisits(caller.agencyId, v);
    }
    return Paginated.of(views, total, query);
  }

  async request(caller: AuthUser, dto: RequestTimeOffDto): Promise<TimeOffView> {
    const staffId = await this.ownStaffId(caller);
    if (!staffId) throw new ForbiddenException('Only staff members can request time off');
    if (dto.endDate < dto.startDate) throw new BadRequestException('The last day must be on or after the first day');
    const today = await this.clock.todayString(caller.agencyId);
    if (dto.startDate < today) throw new BadRequestException('Time off can’t start in the past');
    if (inclusiveDays(dto.startDate, dto.endDate) > MAX_TIME_OFF_DAYS) {
      throw new BadRequestException(`Ask for at most ${MAX_TIME_OFF_DAYS} days at a time — speak to the office about longer leave`);
    }
    const overlapping = await this.prisma.staffTimeOff.count({
      where: {
        staffProfileId: staffId,
        status: { in: ['pending', 'approved'] },
        startDate: { lte: toDate(dto.endDate)! },
        endDate: { gte: toDate(dto.startDate)! },
      },
    });
    if (overlapping) throw new ConflictException('You already have time off requested for some of those days');
    const row = await this.prisma.staffTimeOff.create({
      data: {
        staffProfileId: staffId,
        startDate: toDate(dto.startDate)!,
        endDate: toDate(dto.endDate)!,
        type: dto.type,
        notes: dto.notes || null,
      },
      include: INCLUDE,
    });
    return toView(row);
  }

  /** The requester withdraws a request that is pending, or approved but not started yet. */
  async cancel(caller: AuthUser, id: string): Promise<TimeOffView> {
    const row = await this.find(caller, id);
    if (row.staffProfile.user.id !== caller.userId) throw new NotFoundException('Time off request not found');
    const today = await this.clock.todayString(caller.agencyId);
    const started = fromDate(row.startDate)! <= today;
    if (!(row.status === 'pending' || (row.status === 'approved' && !started))) {
      throw new ConflictException(row.status === 'approved' ? 'This time off has already started' : `This request is ${row.status}`);
    }
    const updated = await this.prisma.staffTimeOff.updateMany({ where: { id, status: row.status }, data: { status: 'cancelled' } });
    if (!updated.count) throw new ConflictException('This request just changed — reload and try again');
    return toView(await this.find(caller, id));
  }

  async decide(caller: AuthUser, id: string, dto: DecideTimeOffDto): Promise<TimeOffView> {
    const row = await this.find(caller, id);
    if (row.staffProfile.user.id === caller.userId) throw new ForbiddenException('Someone else must decide your own request');
    if (row.status !== 'pending') throw new ConflictException(`This request is already ${row.status}`);
    const updated = await this.prisma.staffTimeOff.updateMany({
      where: { id, status: 'pending' },
      data: { status: dto.status, approvedById: caller.userId },
    });
    if (!updated.count) throw new ConflictException('This request was just decided by someone else');
    const view = toView(await this.find(caller, id));
    const range = view.startDate === view.endDate ? shortDate(view.startDate) : `${shortDate(view.startDate)} – ${shortDate(view.endDate)}`;
    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: [view.staff.userId],
      actorUserId: caller.userId,
      type: 'time_off_decided',
      title: dto.status === 'approved' ? 'Time off approved' : 'Time off not approved',
      body: dto.status === 'approved' ? `${range} is approved.` : `${range} was not approved. Contact the office if you have questions.`,
      data: { timeOffId: id },
    });
    if (dto.status === 'approved') view.bookedVisits = await this.bookedVisits(caller.agencyId, view);
    return view;
  }

  private async bookedVisits(agencyId: string, v: TimeOffView): Promise<number> {
    return this.prisma.visit.count({
      where: {
        agencyId,
        staffId: v.staff.id,
        status: { in: ['scheduled', 'in_progress'] },
        scheduledDate: { gte: toDate(v.startDate)!, lte: toDate(v.endDate)! },
      },
    });
  }

  private async find(caller: AuthUser, id: string): Promise<Row> {
    const row = await this.prisma.staffTimeOff.findFirst({
      where: { id, staffProfile: { agencyId: caller.agencyId } },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Time off request not found');
    if (row.staffProfile.user.id !== caller.userId && !(await this.isApprover(caller))) {
      throw new NotFoundException('Time off request not found');
    }
    return row;
  }

  private async isApprover(caller: AuthUser): Promise<boolean> {
    return (await this.permissions.forUser(caller)).permissions.has('visits:approve');
  }

  private async ownStaffId(caller: AuthUser): Promise<string | null> {
    const own = await this.prisma.staffProfile.findFirst({ where: { userId: caller.userId, agencyId: caller.agencyId }, select: { id: true } });
    return own?.id ?? null;
  }
}

function toView(r: Row): TimeOffView {
  const startDate = fromDate(r.startDate)!;
  const endDate = fromDate(r.endDate)!;
  return {
    id: r.id,
    staff: {
      id: r.staffProfile.id,
      userId: r.staffProfile.user.id,
      firstName: r.staffProfile.user.firstName,
      lastName: r.staffProfile.user.lastName,
      discipline: r.staffProfile.discipline,
    },
    startDate,
    endDate,
    days: inclusiveDays(startDate, endDate),
    type: r.type,
    status: r.status,
    notes: r.notes,
    decidedBy: r.approvedBy,
    createdAt: r.createdAt,
  };
}

