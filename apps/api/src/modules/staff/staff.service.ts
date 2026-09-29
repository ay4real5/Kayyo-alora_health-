import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Permission } from '@alora/shared';
import { PhiContext, PhiCryptoService } from '../../common/crypto/phi-crypto.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { fromDate, fromTime, toDate, toTime } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import type {
  CreateStaffDto,
  CreateTimeOffDto,
  ListStaffQueryDto,
  SetAvailabilityDto,
  UpdateStaffDto,
} from './dto/staff.dto.js';

const PROFILE_INCLUDE = {
  user: { select: { firstName: true, lastName: true, email: true, phone: true } },
} satisfies Prisma.StaffProfileInclude;
type Profile = Prisma.StaffProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

export interface StaffSummary {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  employeeId: string | null;
  discipline: string;
  employmentType: string;
  isActive: boolean;
  skills: string[];
  languages: string[];
}

export interface StaffDetail extends StaffSummary {
  email: string;
  phone: string | null;
  /** Whether a phone check-in (IVR) code is set; the code itself is never returned (D-073). */
  hasPhoneCheckInCode: boolean;
  hireDate: string | null;
  terminationDate: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  serviceAreaZipCodes: string[];
  maxPatients: number | null;
  notes: string | null;
  /** Only for payroll roles and the staff member themselves. Money as decimal strings, e.g. "32.50". */
  pay?: {
    hourlyRate: string | null;
    perVisitRate: string | null;
    overtimeRate: string | null;
    mileageRate: string | null;
    taxFilingStatus: string | null;
    ssnLast4: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface AvailabilitySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface TimeOffView {
  id: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
  notes: string | null;
  approvedById: string | null;
  createdAt: Date;
}

/**
 * Staff profiles, weekly availability and time off (DESIGN.md §6.4). Scoped to the caller's agency.
 * "Self" rules: staff members may read their own profile (incl. pay), set their own availability, and request
 * or cancel their own time off without staff-management permissions (DECISIONS D-029).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PhiCryptoService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly clock: AgencyClockService,
  ) {}

  async list(caller: AuthUser, query: ListStaffQueryDto): Promise<Paginated<StaffSummary>> {
    const where: Prisma.StaffProfileWhereInput = {
      agencyId: caller.agencyId,
      ...(query.discipline ? { discipline: query.discipline } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.zip ? { serviceAreaZipCodes: { has: query.zip } } : {}),
      ...(query.search
        ? {
            OR: [
              { employeeId: { equals: query.search, mode: 'insensitive' } },
              { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
              { user: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [profiles, total] = await Promise.all([
      this.prisma.staffProfile.findMany({
        where,
        include: PROFILE_INCLUDE,
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.staffProfile.count({ where }),
    ]);
    return Paginated.of(profiles.map(toSummary), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<StaffDetail> {
    const profile = await this.find(caller, id);
    await this.assertSelfOr(caller, profile, 'staff:read');
    return this.toDetail(caller, profile);
  }

  async me(caller: AuthUser): Promise<StaffDetail> {
    const profile = await this.prisma.staffProfile.findFirst({
      where: { userId: caller.userId, agencyId: caller.agencyId },
      include: PROFILE_INCLUDE,
    });
    if (!profile) throw new NotFoundException('You do not have a staff profile');
    return this.toDetail(caller, profile);
  }

  /** Active users of the agency who don't have a staff profile yet — who a new profile can be created for. */
  async candidates(caller: AuthUser): Promise<{ id: string; firstName: string; lastName: string; email: string }[]> {
    return this.prisma.user.findMany({
      where: { agencyId: caller.agencyId, isActive: true, staffProfile: null },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    });
  }

  async create(caller: AuthUser, dto: CreateStaffDto): Promise<StaffDetail> {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, agencyId: caller.agencyId } });
    if (!user) throw new BadRequestException('userId does not match a user in this agency');
    if (await this.prisma.staffProfile.count({ where: { userId: dto.userId } })) {
      throw new ConflictException('This user already has a staff profile');
    }
    const profile = await this.saveOrConflict(() =>
      this.prisma.staffProfile.create({
        data: {
          ...(this.fields(dto) as { discipline: string }),
          userId: dto.userId,
          agencyId: caller.agencyId,
        },
        include: PROFILE_INCLUDE,
      }),
    );
    return this.toDetail(caller, profile);
  }

  async update(caller: AuthUser, id: string, dto: UpdateStaffDto): Promise<StaffDetail> {
    await this.find(caller, id);
    const profile = await this.saveOrConflict(() =>
      this.prisma.staffProfile.update({ where: { id }, data: this.fields(dto), include: PROFILE_INCLUDE }),
    );
    return this.toDetail(caller, profile);
  }

  /** Ends employment (the login account is managed separately in /users). */
  async terminate(caller: AuthUser, id: string, terminationDate?: string): Promise<StaffDetail> {
    const profile = await this.find(caller, id);
    if (!profile.isActive) throw new ConflictException('Staff member is already inactive');
    const date = toDate(terminationDate) ?? (await this.clock.today(caller.agencyId));
    if (profile.hireDate && date < profile.hireDate) {
      throw new BadRequestException('Termination date cannot be before the hire date');
    }
    return this.toDetail(
      caller,
      await this.prisma.staffProfile.update({
        where: { id },
        data: { isActive: false, terminationDate: date },
        include: PROFILE_INCLUDE,
      }),
    );
  }

  async getAvailability(caller: AuthUser, id: string): Promise<AvailabilitySlot[]> {
    await this.assertSelfOr(caller, await this.find(caller, id), 'staff:read');
    const slots = await this.prisma.staffAvailability.findMany({
      where: { staffProfileId: id, isAvailable: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return slots.map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: fromTime(s.startTime), endTime: fromTime(s.endTime) }));
  }

  /** Replaces the weekly schedule. Slots must be start < end and must not overlap on the same day. */
  async setAvailability(caller: AuthUser, id: string, dto: SetAvailabilityDto): Promise<AvailabilitySlot[]> {
    await this.assertSelfOr(caller, await this.find(caller, id), 'staff:update');
    const sorted = [...dto.slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
    for (const [i, slot] of sorted.entries()) {
      if (slot.startTime >= slot.endTime) throw new BadRequestException('Each slot must end after it starts');
      const prev = sorted[i - 1];
      if (prev && prev.dayOfWeek === slot.dayOfWeek && slot.startTime < prev.endTime) {
        throw new BadRequestException('Availability slots on the same day must not overlap');
      }
    }
    await this.prisma.$transaction([
      this.prisma.staffAvailability.deleteMany({ where: { staffProfileId: id } }),
      this.prisma.staffAvailability.createMany({
        data: sorted.map((slot) => ({
          staffProfileId: id,
          dayOfWeek: slot.dayOfWeek,
          startTime: toTime(slot.startTime),
          endTime: toTime(slot.endTime),
        })),
      }),
    ]);
    return sorted.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime }));
  }

  async listTimeOff(caller: AuthUser, id: string): Promise<TimeOffView[]> {
    await this.assertSelfOr(caller, await this.find(caller, id), 'staff:read');
    const requests = await this.prisma.staffTimeOff.findMany({
      where: { staffProfileId: id },
      orderBy: { startDate: 'desc' },
    });
    return requests.map(toTimeOff);
  }

  async requestTimeOff(caller: AuthUser, id: string, dto: CreateTimeOffDto): Promise<TimeOffView> {
    await this.assertSelfOr(caller, await this.find(caller, id), 'staff:update');
    if (dto.endDate < dto.startDate) throw new BadRequestException('endDate cannot be before startDate');
    const overlapping = await this.prisma.staffTimeOff.count({
      where: {
        staffProfileId: id,
        status: { in: ['pending', 'approved'] },
        startDate: { lte: toDate(dto.endDate) },
        endDate: { gte: toDate(dto.startDate) },
      },
    });
    if (overlapping) throw new ConflictException('This overlaps an existing time-off request');
    return toTimeOff(
      await this.prisma.staffTimeOff.create({
        data: {
          staffProfileId: id,
          startDate: toDate(dto.startDate)!,
          endDate: toDate(dto.endDate)!,
          type: dto.type,
          notes: dto.notes ?? null,
        },
      }),
    );
  }

  /** approved/denied: an approver, never for their own request. cancelled: the requester (or a manager). */
  async decideTimeOff(
    caller: AuthUser,
    id: string,
    timeOffId: string,
    status: 'approved' | 'denied' | 'cancelled',
  ): Promise<TimeOffView> {
    const profile = await this.find(caller, id);
    const request = await this.prisma.staffTimeOff.findFirst({ where: { id: timeOffId, staffProfileId: id } });
    if (!request) throw new NotFoundException('Time-off request not found');
    if (request.status !== 'pending') throw new ConflictException(`This request is already ${request.status}`);

    if (status === 'cancelled') {
      await this.assertSelfOr(caller, profile, 'staff:update');
    } else {
      if (profile.userId === caller.userId) throw new ForbiddenException('You cannot approve your own time off');
      await this.assertPermission(caller, 'time_off:approve');
    }
    const updated = await this.prisma.staffTimeOff.update({
      where: { id: timeOffId },
      data: { status, approvedById: status === 'cancelled' ? null : caller.userId },
    });
    if (status !== 'cancelled') {
      const range = `${fromDate(updated.startDate)} to ${fromDate(updated.endDate)}`;
      await this.notifications.notify({
        agencyId: caller.agencyId,
        userIds: [profile.userId],
        actorUserId: caller.userId,
        type: 'time_off_decided',
        title: status === 'approved' ? 'Time off approved' : 'Time off denied',
        body: `Your time-off request for ${range} was ${status}.`,
        data: { timeOffId: updated.id },
      });
    }
    return toTimeOff(updated);
  }

  /** Finds a profile in the caller's agency (404 otherwise). */
  async find(caller: AuthUser, id: string): Promise<Profile> {
    const profile = await this.prisma.staffProfile.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: PROFILE_INCLUDE,
    });
    if (!profile) throw new NotFoundException('Staff member not found');
    return profile;
  }

  /** The staff member themselves, or someone holding `permission`. */
  async assertSelfOr(caller: AuthUser, profile: { userId: string }, permission: Permission): Promise<void> {
    if (profile.userId === caller.userId) return;
    await this.assertPermission(caller, permission);
  }

  private async assertPermission(caller: AuthUser, permission: Permission): Promise<void> {
    const access = await this.permissions.forUser(caller);
    if (!access.permissions.has(permission)) throw new ForbiddenException('You do not have permission to do this');
  }

  private async toDetail(caller: AuthUser, profile: Profile): Promise<StaffDetail> {
    const access = await this.permissions.forUser(caller);
    const showPay = profile.userId === caller.userId || access.permissions.has('payroll:read');
    const ssn = showPay && profile.ssnEncrypted ? this.crypto.decrypt(profile.ssnEncrypted, PhiContext.StaffSsn) : null;
    return {
      ...toSummary(profile),
      email: profile.user.email,
      phone: profile.user.phone,
      // The code itself is never sent back (it's a PIN); only whether one is set.
      hasPhoneCheckInCode: profile.ivrCode !== null,
      hireDate: fromDate(profile.hireDate),
      terminationDate: fromDate(profile.terminationDate),
      addressLine1: profile.addressLine1,
      city: profile.city,
      state: profile.state,
      zip: profile.zip,
      serviceAreaZipCodes: profile.serviceAreaZipCodes,
      maxPatients: profile.maxPatients,
      notes: profile.notes,
      ...(showPay
        ? {
            pay: {
              hourlyRate: profile.hourlyRate?.toFixed(2) ?? null,
              perVisitRate: profile.perVisitRate?.toFixed(2) ?? null,
              overtimeRate: profile.overtimeRate?.toFixed(2) ?? null,
              mileageRate: profile.mileageRate?.toFixed(4) ?? null,
              taxFilingStatus: profile.taxFilingStatus,
              ssnLast4: ssn ? ssn.slice(-4) : null,
            },
          }
        : {}),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private fields(dto: UpdateStaffDto): Prisma.StaffProfileUncheckedUpdateInput {
    const data: Record<string, unknown> = {};
    const copy = [
      'employeeId', 'ivrCode', 'discipline', 'employmentType', 'hourlyRate', 'perVisitRate', 'overtimeRate', 'mileageRate',
      'taxFilingStatus', 'addressLine1', 'city', 'state', 'zip', 'serviceAreaZipCodes', 'maxPatients', 'skills',
      'languages', 'notes',
    ] as const;
    for (const key of copy) if (dto[key] !== undefined) data[key] = dto[key];
    if (dto.hireDate !== undefined) data.hireDate = toDate(dto.hireDate);
    if (dto.ssn !== undefined) data.ssnEncrypted = this.crypto.encrypt(dto.ssn.replaceAll('-', ''), PhiContext.StaffSsn);
    return data;
  }

  private async saveOrConflict<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another staff member in this agency already has this employee ID or phone check-in code');
      }
      throw error;
    }
  }
}

function toSummary(profile: Profile): StaffSummary {
  return {
    id: profile.id,
    userId: profile.userId,
    firstName: profile.user.firstName,
    lastName: profile.user.lastName,
    employeeId: profile.employeeId,
    discipline: profile.discipline,
    employmentType: profile.employmentType,
    isActive: profile.isActive,
    skills: profile.skills,
    languages: profile.languages,
  };
}

function toTimeOff(r: {
  id: string;
  startDate: Date;
  endDate: Date;
  type: string;
  status: string;
  notes: string | null;
  approvedById: string | null;
  createdAt: Date;
}): TimeOffView {
  return {
    id: r.id,
    startDate: fromDate(r.startDate)!,
    endDate: fromDate(r.endDate)!,
    type: r.type,
    status: r.status,
    notes: r.notes,
    approvedById: r.approvedById,
    createdAt: r.createdAt,
  };
}
