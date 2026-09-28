import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { distanceMeters, EVV_RULES, type EvvFlag, zonedTimeToUtc } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { fromDate, fromTime, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { ClockDto, CreateEvvExceptionDto, ListEvvQueryDto } from './dto/evv.dto.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const RECORD_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  staff: {
    select: {
      id: true,
      discipline: true,
      userId: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  visit: {
    select: {
      id: true,
      visitType: true,
      scheduledDate: true,
      scheduledStart: true,
      scheduledEnd: true,
    },
  },
  exceptions: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.EvvRecordInclude;
type RecordRow = Prisma.EvvRecordGetPayload<{ include: typeof RECORD_INCLUDE }>;
type ExceptionRow = RecordRow['exceptions'][number];

export interface EvvExceptionView {
  id: string;
  exceptionType: string;
  originalValue: string | null;
  correctedValue: string | null;
  reason: string;
  requestedById: string;
  status: string;
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface EvvRecordView {
  id: string;
  visit: {
    id: string;
    visitType: string;
    scheduledDate: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
  patient: { id: string; firstName: string; lastName: string };
  staff: { id: string; firstName: string; lastName: string; discipline: string };
  serviceDate: string;
  status: string;
  flags: string[];
  clockIn: ClockView;
  clockOut: ClockView | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  verificationNote: string | null;
  exceptions: EvvExceptionView[];
  createdAt: Date;
}

interface ClockView {
  time: Date | null;
  method: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  withinGeofence: boolean | null;
  distanceMeters: number | null;
}

type PersonRef = { id: string; firstName: string; lastName: string };

export interface LiveSnapshot {
  date: string;
  counts: {
    scheduled: number;
    inProgress: number;
    completed: number;
    missed: number;
    late: number;
    noShow: number;
    unassigned: number;
    needsReview: number;
  };
  active: {
    visitId: string;
    evvRecordId: string;
    clockInTime: Date | null;
    scheduledEnd: string;
    flags: string[];
    withinGeofence: boolean | null;
    clockIn: { latitude: number | null; longitude: number | null };
    home: { latitude: number | null; longitude: number | null };
    staff: PersonRef & { discipline: string };
    patient: PersonRef;
  }[];
  late: {
    visitId: string;
    scheduledStart: string;
    minutesLate: number;
    noShow: boolean;
    staff: PersonRef;
    patient: PersonRef;
  }[];
  unassigned: { visitId: string; visitType: string; scheduledStart: string; patient: PersonRef }[];
}

/** What a caregiver gets back after clocking in or out: enough to show "you're clocked in" and any warnings. */
export interface ClockResult {
  /** The EVV record id. */
  id: string;
  visitId: string;
  status: string;
  flags: string[];
  clockInTime: Date | null;
  clockOutTime: Date | null;
  distanceMeters: number | null;
  withinGeofence: boolean | null;
}

/**
 * Electronic Visit Verification (DESIGN.md §6.6, §15.1; DECISIONS D-038). Caregivers clock in/out of their own
 * visits with GPS; anything unusual is flagged (never blocked) for a supervisor, who verifies or rejects the record
 * and approves time corrections. Corrections always go through a two-person exception, never a direct edit.
 */
@Injectable()
export class EvvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async clockIn(caller: AuthUser, dto: ClockDto): Promise<ClockResult> {
    const at = parseClockTime(dto.timestamp);
    const visit = await this.ownVisit(caller, dto.visitId);
    if (visit.status !== 'scheduled') {
      throw new ConflictException(
        `This visit is ${visit.status.replace('_', ' ')} and can't be clocked into`,
      );
    }
    const window = await this.window(caller.agencyId, visit);
    assertNearWindow(at, window);

    const open = await this.prisma.evvRecord.findFirst({
      where: { agencyId: caller.agencyId, staffId: visit.staffId!, status: 'in_progress' },
      select: { id: true },
    });
    if (open)
      throw new ConflictException('Clock out of your current visit before starting another');

    const flags: EvvFlag[] = [];
    const geo = geofence(visit.patient, dto);
    if (geo.distance === null) flags.push('no_patient_location');
    else if (!geo.within) flags.push('outside_geofence_in');
    if (
      at.getTime() < window.start - EVV_RULES.earlyClockInMinutes * MINUTE ||
      at.getTime() > window.end
    ) {
      flags.push('outside_time_window_in');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      // Guarded update: two devices clocking in at once can't both win.
      const moved = await tx.visit.updateMany({
        where: { id: visit.id, status: 'scheduled' },
        data: { status: 'in_progress', actualStart: at },
      });
      if (!moved.count) throw new ConflictException('This visit was just clocked into');
      return tx.evvRecord.create({
        data: {
          visitId: visit.id,
          agencyId: caller.agencyId,
          staffId: visit.staffId!,
          patientId: visit.patientId,
          serviceType: visit.visitType,
          serviceDate: visit.scheduledDate,
          clockInTime: at,
          clockInMethod: 'gps',
          clockInLatitude: dto.latitude,
          clockInLongitude: dto.longitude,
          clockInAccuracyMeters: dto.accuracyMeters ?? null,
          clockInWithinGeofence: geo.within,
          clockInDistanceMeters: geo.distance,
          flags,
          deviceId: dto.deviceId ?? null,
          deviceModel: dto.deviceModel ?? null,
          appVersion: dto.appVersion ?? null,
        },
      });
    });
    this.emit(caller.agencyId, 'visit:clock-in', visit, record, geo, {
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
    return toClockResult(record, geo);
  }

  async clockOut(caller: AuthUser, dto: ClockDto): Promise<ClockResult> {
    const at = parseClockTime(dto.timestamp);
    const visit = await this.ownVisit(caller, dto.visitId);
    const record = await this.prisma.evvRecord.findUnique({ where: { visitId: visit.id } });
    if (!record || record.status !== 'in_progress' || !record.clockInTime) {
      throw new ConflictException('You are not clocked into this visit');
    }
    if (at <= record.clockInTime) throw new BadRequestException('Clock-out must be after clock-in');
    const window = await this.window(caller.agencyId, visit);

    const flags = new Set(record.flags as EvvFlag[]);
    const geo = geofence(visit.patient, dto);
    if (geo.distance === null) flags.add('no_patient_location');
    else if (!geo.within) flags.add('outside_geofence_out');
    if (at.getTime() > window.end + EVV_RULES.lateClockOutMinutes * MINUTE)
      flags.add('outside_time_window_out');
    if (
      at.getTime() - record.clockInTime.getTime() <
      (window.end - window.start) * EVV_RULES.shortVisitFraction
    ) {
      flags.add('very_short_visit');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.evvRecord.updateMany({
        where: { id: record.id, status: 'in_progress' },
        data: {
          clockOutTime: at,
          clockOutMethod: 'gps',
          clockOutLatitude: dto.latitude,
          clockOutLongitude: dto.longitude,
          clockOutAccuracyMeters: dto.accuracyMeters ?? null,
          clockOutWithinGeofence: geo.within,
          clockOutDistanceMeters: geo.distance,
          flags: [...flags],
          status: flags.size ? 'exception' : 'completed',
        },
      });
      if (!closed.count) throw new ConflictException('This visit was just clocked out of');
      await tx.visit.update({
        where: { id: visit.id },
        data: { status: 'completed', actualEnd: at },
      });
      return tx.evvRecord.findUniqueOrThrow({ where: { id: record.id } });
    });
    this.emit(caller.agencyId, 'visit:clock-out', visit, updated, geo, {
      latitude: dto.latitude,
      longitude: dto.longitude,
      durationMinutes: Math.round((at.getTime() - record.clockInTime.getTime()) / 60_000),
    });
    return toClockResult(updated, geo);
  }

  async list(caller: AuthUser, query: ListEvvQueryDto): Promise<Paginated<EvvRecordView>> {
    if (query.from && query.to && query.to < query.from)
      throw new BadRequestException('to cannot be before from');
    const where: Prisma.EvvRecordWhereInput = {
      AND: [
        { agencyId: caller.agencyId },
        query.from ? { serviceDate: { gte: toDate(query.from) } } : {},
        query.to ? { serviceDate: { lte: toDate(query.to) } } : {},
        query.staffId ? { staffId: query.staffId } : {},
        query.status ? { status: query.status } : {},
        query.needsReview
          ? { OR: [{ status: 'exception' }, { exceptions: { some: { status: 'pending' } } }] }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.evvRecord.findMany({
        where,
        include: RECORD_INCLUDE,
        orderBy: [{ serviceDate: 'desc' }, { clockInTime: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.evvRecord.count({ where }),
    ]);
    return Paginated.of(rows.map(toView), total, query);
  }

  /**
   * The live monitor's snapshot for the agency's today (D-041): who is on a visit now, who is late, what's unassigned,
   * and the day's counts. Socket events say "something changed"; clients refetch this.
   */
  async live(caller: AuthUser): Promise<LiveSnapshot> {
    const today = await this.clock.todayString(caller.agencyId);
    const zone = await this.clock.timezone(caller.agencyId);
    const now = Date.now();
    const [active, todays, needsReview] = await Promise.all([
      this.prisma.evvRecord.findMany({
        where: { agencyId: caller.agencyId, status: 'in_progress' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, latitude: true, longitude: true } },
          staff: { select: { id: true, discipline: true, user: { select: { firstName: true, lastName: true } } } },
          visit: { select: { scheduledEnd: true } },
        },
        orderBy: { clockInTime: 'asc' },
        take: 500,
      }),
      this.prisma.visit.findMany({
        where: { agencyId: caller.agencyId, scheduledDate: toDate(today) },
        select: {
          id: true,
          status: true,
          staffId: true,
          visitType: true,
          scheduledStart: true,
          scheduledEnd: true,
          patient: { select: { id: true, firstName: true, lastName: true } },
          staff: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { scheduledStart: 'asc' },
        take: 2000,
      }),
      this.prisma.evvRecord.count({ where: { agencyId: caller.agencyId, status: 'exception' } }),
    ]);

    const late: LiveSnapshot['late'] = [];
    const unassigned: LiveSnapshot['unassigned'] = [];
    for (const v of todays) {
      if (v.status !== 'scheduled') continue;
      const start = fromTime(v.scheduledStart);
      if (!v.staff) {
        unassigned.push({ visitId: v.id, visitType: v.visitType, scheduledStart: start, patient: v.patient });
        continue;
      }
      const minutesLate = Math.floor((now - zonedTimeToUtc(today, start, zone).getTime()) / MINUTE);
      if (minutesLate >= 15) {
        late.push({
          visitId: v.id,
          scheduledStart: start,
          minutesLate,
          noShow: minutesLate >= 30,
          staff: { id: v.staff.id, firstName: v.staff.user.firstName, lastName: v.staff.user.lastName },
          patient: v.patient,
        });
      }
    }
    const count = (status: string) => todays.filter((v) => v.status === status).length;
    return {
      date: today,
      counts: {
        scheduled: todays.filter((v) => v.status !== 'cancelled').length,
        inProgress: active.length,
        completed: count('completed'),
        missed: count('missed'),
        late: late.filter((l) => !l.noShow).length,
        noShow: late.filter((l) => l.noShow).length,
        unassigned: unassigned.length,
        needsReview,
      },
      active: active.map((r) => ({
        visitId: r.visitId,
        evvRecordId: r.id,
        clockInTime: r.clockInTime,
        scheduledEnd: fromTime(r.visit.scheduledEnd),
        flags: r.flags,
        withinGeofence: r.clockInWithinGeofence,
        clockIn: { latitude: num(r.clockInLatitude), longitude: num(r.clockInLongitude) },
        home: { latitude: num(r.patient.latitude), longitude: num(r.patient.longitude) },
        staff: {
          id: r.staff.id,
          firstName: r.staff.user.firstName,
          lastName: r.staff.user.lastName,
          discipline: r.staff.discipline,
        },
        patient: { id: r.patient.id, firstName: r.patient.firstName, lastName: r.patient.lastName },
      })),
      late,
      unassigned,
    };
  }

  async get(caller: AuthUser, id: string): Promise<EvvRecordView> {
    return toView(await this.find(caller, id));
  }

  async verify(caller: AuthUser, id: string, note?: string): Promise<EvvRecordView> {
    return this.review(caller, id, 'verified', note ?? null);
  }

  async reject(caller: AuthUser, id: string, note: string): Promise<EvvRecordView> {
    return this.review(caller, id, 'rejected', note);
  }

  /** Files a time correction ("forgot to clock out"). It changes nothing until someone else approves it. */
  async createException(
    caller: AuthUser,
    id: string,
    dto: CreateEvvExceptionDto,
  ): Promise<EvvRecordView> {
    const record = await this.find(caller, id);
    if (!['in_progress', 'completed', 'exception'].includes(record.status)) {
      throw new ConflictException(`A ${record.status} record can't be corrected`);
    }
    if (
      record.exceptions.some((e) => e.status === 'pending' && e.exceptionType === dto.exceptionType)
    ) {
      throw new ConflictException('A correction to this time is already waiting for a decision');
    }
    const corrected = parseCorrection(dto.correctedValue);
    assertConsistent(record, dto.exceptionType, corrected);
    const original =
      dto.exceptionType === 'clock_in_time' ? record.clockInTime : record.clockOutTime;
    await this.prisma.evvException.create({
      data: {
        evvRecordId: record.id,
        exceptionType: dto.exceptionType,
        originalValue: original?.toISOString() ?? null,
        correctedValue: corrected.toISOString(),
        reason: dto.reason,
        requestedById: caller.userId,
      },
    });
    return this.get(caller, id);
  }

  /**
   * Approves or denies a correction; the requester can't decide their own. Approving applies the time to the record
   * and the visit, adds `manual_correction`, and leaves the record as `exception` so it's verified with that in view.
   */
  async decideException(
    caller: AuthUser,
    exceptionId: string,
    status: 'approved' | 'denied',
  ): Promise<EvvRecordView> {
    const exception = await this.prisma.evvException.findFirst({
      where: { id: exceptionId, evvRecord: { agencyId: caller.agencyId } },
    });
    if (!exception) throw new NotFoundException('Correction not found');
    if (exception.status !== 'pending')
      throw new ConflictException(`This correction was already ${exception.status}`);
    if (exception.requestedById === caller.userId) {
      throw new ForbiddenException('Someone else must decide a correction you filed');
    }
    const record = await this.find(caller, exception.evvRecordId);
    if (status === 'approved') {
      if (!['in_progress', 'completed', 'exception'].includes(record.status)) {
        throw new ConflictException(`A ${record.status} record can't be corrected`);
      }
      assertConsistent(
        record,
        exception.exceptionType as CreateEvvExceptionDto['exceptionType'],
        new Date(exception.correctedValue!),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.evvException.updateMany({
        where: { id: exception.id, status: 'pending' },
        data: { status, decidedById: caller.userId, decidedAt: new Date() },
      });
      if (!decided.count) throw new ConflictException('This correction was just decided');
      if (status === 'denied') return;

      const time = new Date(exception.correctedValue!);
      const flags = [...new Set([...record.flags, 'manual_correction'])];
      if (exception.exceptionType === 'clock_in_time') {
        await tx.evvRecord.update({
          where: { id: record.id },
          data: {
            clockInTime: time,
            flags,
            status: record.status === 'in_progress' ? 'in_progress' : 'exception',
          },
        });
        await tx.visit.update({ where: { id: record.visitId }, data: { actualStart: time } });
      } else {
        await tx.evvRecord.update({
          where: { id: record.id },
          data: {
            clockOutTime: time,
            clockOutMethod: record.clockOutMethod ?? 'manual',
            flags,
            status: 'exception',
          },
        });
        await tx.visit.update({
          where: { id: record.visitId },
          data: { status: 'completed', actualEnd: time },
        });
      }
    });

    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: [exception.requestedById],
      type: 'evv_correction_decided',
      title: status === 'approved' ? 'EVV correction approved' : 'EVV correction denied',
      data: { evvRecordId: record.id, exceptionId: exception.id },
      actorUserId: caller.userId,
    });
    return this.get(caller, record.id);
  }

  /** Live monitor events (D-041): the clock event, plus a geofence violation when it was away from the home. */
  private emit(
    agencyId: string,
    event: 'visit:clock-in' | 'visit:clock-out',
    visit: { id: string; patient: { firstName: string; lastName: string }; staff: { user: { firstName: string; lastName: string } } | null },
    record: { id: string; status: string; flags: string[] },
    geo: { distance: number | null; within: boolean | null },
    extra: Record<string, unknown>,
  ): void {
    const payload = {
      visitId: visit.id,
      evvRecordId: record.id,
      status: record.status,
      flags: record.flags,
      staffName: visit.staff ? `${visit.staff.user.firstName} ${visit.staff.user.lastName}` : null,
      patientName: `${visit.patient.firstName} ${visit.patient.lastName}`,
      withinGeofence: geo.within,
      distanceMeters: geo.distance,
      ...extra,
    };
    this.realtime.toMonitor(agencyId, event, payload);
    if (geo.within === false) {
      this.realtime.toMonitor(agencyId, 'visit:geofence-violation', {
        visitId: visit.id,
        evvRecordId: record.id,
        stage: event === 'visit:clock-in' ? 'clock-in' : 'clock-out',
        distanceMeters: geo.distance,
        staffName: payload.staffName,
      });
    }
  }

  private async review(
    caller: AuthUser,
    id: string,
    status: 'verified' | 'rejected',
    note: string | null,
  ) {
    const record = await this.find(caller, id);
    if (!['completed', 'exception'].includes(record.status)) {
      throw new ConflictException(
        record.status === 'in_progress'
          ? 'The caregiver is still clocked in'
          : `This record is already ${record.status}`,
      );
    }
    if (record.exceptions.some((e) => e.status === 'pending')) {
      throw new ConflictException('Decide the pending corrections first');
    }
    if (record.staff.userId === caller.userId)
      throw new ForbiddenException("You can't review your own visit");
    const done = await this.prisma.evvRecord.updateMany({
      where: { id, agencyId: caller.agencyId, status: record.status },
      data: { status, verifiedById: caller.userId, verifiedAt: new Date(), verificationNote: note },
    });
    if (!done.count) throw new ConflictException('This record was just changed; reload it');
    return this.get(caller, id);
  }

  private async find(caller: AuthUser, id: string): Promise<RecordRow> {
    const record = await this.prisma.evvRecord.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: RECORD_INCLUDE,
    });
    if (!record) throw new NotFoundException('EVV record not found');
    return record;
  }

  /** A visit assigned to the caller. Anyone else's visit is "not found", not "forbidden" (don't confirm it exists). */
  private async ownVisit(caller: AuthUser, visitId: string) {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, agencyId: caller.agencyId, staff: { userId: caller.userId } },
      include: {
        patient: {
          select: { firstName: true, lastName: true, latitude: true, longitude: true, geoFenceRadiusMeters: true },
        },
        staff: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!visit || !visit.staffId) throw new NotFoundException('Visit not found');
    return visit;
  }

  /** The scheduled start/end as instants, in the agency's timezone. */
  private async window(
    agencyId: string,
    visit: { scheduledDate: Date; scheduledStart: Date; scheduledEnd: Date },
  ): Promise<{ start: number; end: number }> {
    const zone = await this.clock.timezone(agencyId);
    const date = fromDate(visit.scheduledDate)!;
    return {
      start: zonedTimeToUtc(date, fromTime(visit.scheduledStart), zone).getTime(),
      end: zonedTimeToUtc(date, fromTime(visit.scheduledEnd), zone).getTime(),
    };
  }
}

function parseClockTime(value: string): Date {
  const at = new Date(value);
  const now = Date.now();
  if (at.getTime() > now + EVV_RULES.maxClockSkewMinutes * MINUTE) {
    throw new BadRequestException('timestamp is in the future; check the device clock');
  }
  if (at.getTime() < now - EVV_RULES.maxBackdateHours * HOUR) {
    throw new BadRequestException(
      `timestamp is more than ${EVV_RULES.maxBackdateHours} hours old; ask the office to record it`,
    );
  }
  return at;
}

function parseCorrection(value: string): Date {
  const at = new Date(value);
  if (at.getTime() > Date.now() + EVV_RULES.maxClockSkewMinutes * MINUTE) {
    throw new BadRequestException('correctedValue cannot be in the future');
  }
  return at;
}

function assertNearWindow(at: Date, window: { start: number; end: number }): void {
  const slack = EVV_RULES.refuseOutsideWindowHours * HOUR;
  if (at.getTime() < window.start - slack || at.getTime() > window.end + slack) {
    throw new BadRequestException("This visit isn't scheduled around this time");
  }
}

/** A corrected time must keep clock-in before clock-out. */
function assertConsistent(
  record: { clockInTime: Date | null; clockOutTime: Date | null },
  type: 'clock_in_time' | 'clock_out_time',
  time: Date,
): void {
  if (type === 'clock_in_time' && record.clockOutTime && time >= record.clockOutTime) {
    throw new BadRequestException('The corrected clock-in must be before the clock-out');
  }
  if (type === 'clock_out_time' && record.clockInTime && time <= record.clockInTime) {
    throw new BadRequestException('The corrected clock-out must be after the clock-in');
  }
}

function geofence(
  patient: {
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    geoFenceRadiusMeters: number;
  },
  at: { latitude: number; longitude: number },
): { distance: number | null; within: boolean | null } {
  if (patient.latitude === null || patient.longitude === null)
    return { distance: null, within: null };
  const distance = Math.round(
    distanceMeters(
      { lat: Number(patient.latitude), lng: Number(patient.longitude) },
      { lat: at.latitude, lng: at.longitude },
    ),
  );
  return { distance, within: distance <= patient.geoFenceRadiusMeters };
}

function toClockResult(
  record: {
    id: string;
    visitId: string;
    status: string;
    flags: string[];
    clockInTime: Date | null;
    clockOutTime: Date | null;
  },
  geo: { distance: number | null; within: boolean | null },
): ClockResult {
  return {
    id: record.id,
    visitId: record.visitId,
    status: record.status,
    flags: record.flags,
    clockInTime: record.clockInTime,
    clockOutTime: record.clockOutTime,
    distanceMeters: geo.distance,
    withinGeofence: geo.within,
  };
}

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

function toView(record: RecordRow): EvvRecordView {
  return {
    id: record.id,
    visit: {
      id: record.visit.id,
      visitType: record.visit.visitType,
      scheduledDate: fromDate(record.visit.scheduledDate)!,
      scheduledStart: fromTime(record.visit.scheduledStart),
      scheduledEnd: fromTime(record.visit.scheduledEnd),
    },
    patient: record.patient,
    staff: {
      id: record.staff.id,
      firstName: record.staff.user.firstName,
      lastName: record.staff.user.lastName,
      discipline: record.staff.discipline,
    },
    serviceDate: fromDate(record.serviceDate)!,
    status: record.status,
    flags: record.flags,
    clockIn: {
      time: record.clockInTime,
      method: record.clockInMethod,
      latitude: num(record.clockInLatitude),
      longitude: num(record.clockInLongitude),
      accuracyMeters: record.clockInAccuracyMeters,
      withinGeofence: record.clockInWithinGeofence,
      distanceMeters: record.clockInDistanceMeters,
    },
    clockOut: record.clockOutTime
      ? {
          time: record.clockOutTime,
          method: record.clockOutMethod,
          latitude: num(record.clockOutLatitude),
          longitude: num(record.clockOutLongitude),
          accuracyMeters: record.clockOutAccuracyMeters,
          withinGeofence: record.clockOutWithinGeofence,
          distanceMeters: record.clockOutDistanceMeters,
        }
      : null,
    verifiedById: record.verifiedById,
    verifiedAt: record.verifiedAt,
    verificationNote: record.verificationNote,
    exceptions: record.exceptions.map(toExceptionView),
    createdAt: record.createdAt,
  };
}

function toExceptionView(e: ExceptionRow): EvvExceptionView {
  return {
    id: e.id,
    exceptionType: e.exceptionType,
    originalValue: e.originalValue,
    correctedValue: e.correctedValue,
    reason: e.reason,
    requestedById: e.requestedById,
    status: e.status,
    decidedById: e.decidedById,
    decidedAt: e.decidedAt,
    createdAt: e.createdAt,
  };
}
