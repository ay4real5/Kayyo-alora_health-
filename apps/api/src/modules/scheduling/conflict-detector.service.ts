import { Injectable } from '@nestjs/common';
import { disciplineFits, OCCUPYING_VISIT_STATUSES, todayInTimeZone, type VisitType } from '@alora/shared';
import { fromDate, fromTime, toDate, toTime } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * blocking — the visit is not booked unless someone with visits:approve overrides.
 * warning  — booked, but the scheduler should look at it.
 */
export type ConflictSeverity = 'blocking' | 'warning';

export interface Conflict {
  code:
    | 'patient_not_active'
    | 'before_admission'
    | 'staff_inactive'
    | 'staff_double_booked'
    | 'staff_time_off'
    | 'staff_time_off_pending'
    | 'outside_availability'
    | 'discipline_mismatch'
    | 'staff_credentials_expired'
    | 'in_the_past';
  severity: ConflictSeverity;
  message: string;
  /** Ids of the other visits involved, for double-booking. */
  visitIds?: string[];
}

export interface ProposedVisit {
  agencyId: string;
  patientId: string;
  staffId?: string | null;
  visitType: VisitType;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  excludeVisitId?: string;
}

/**
 * All scheduling rules in one place (DECISIONS D-030) — used when creating, changing and pre-checking visits.
 * Dates/times are agency-local wall-clock values; "today" uses the agency's timezone.
 */
@Injectable()
export class ConflictDetectorService {
  constructor(private readonly prisma: PrismaService) {}

  async check(visit: ProposedVisit): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    const date = toDate(visit.scheduledDate)!;

    const [agency, patient] = await Promise.all([
      this.prisma.agency.findUniqueOrThrow({ where: { id: visit.agencyId }, select: { timezone: true } }),
      this.prisma.patient.findFirst({
        where: { id: visit.patientId, agencyId: visit.agencyId },
        select: { status: true, admissionDate: true },
      }),
    ]);

    if (visit.scheduledDate < todayInTimeZone(agency.timezone)) {
      conflicts.push({ code: 'in_the_past', severity: 'warning', message: 'The visit date is in the past' });
    }
    if (patient && patient.status !== 'active') {
      conflicts.push({ code: 'patient_not_active', severity: 'blocking', message: `The patient is ${patient.status}` });
    }
    if (patient?.admissionDate && date < patient.admissionDate) {
      conflicts.push({
        code: 'before_admission',
        severity: 'warning',
        message: `The visit is before the patient's admission on ${fromDate(patient.admissionDate)}`,
      });
    }

    if (visit.staffId) conflicts.push(...(await this.staffConflicts(visit, date)));
    return conflicts;
  }

  private async staffConflicts(visit: ProposedVisit, date: Date): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    const staff = await this.prisma.staffProfile.findFirst({
      where: { id: visit.staffId!, agencyId: visit.agencyId },
      select: {
        discipline: true,
        isActive: true,
        terminationDate: true,
        availability: { where: { isAvailable: true } },
        credentials: { where: { expiryDate: { lt: date } }, select: { credentialName: true } },
      },
    });
    if (!staff) return conflicts; // existence is validated by the caller

    if (!staff.isActive || (staff.terminationDate && staff.terminationDate <= date)) {
      conflicts.push({ code: 'staff_inactive', severity: 'blocking', message: 'The caregiver is not active on that date' });
    }

    const start = toTime(visit.scheduledStart);
    const end = toTime(visit.scheduledEnd);
    const overlapping = await this.prisma.visit.findMany({
      where: {
        staffId: visit.staffId!,
        scheduledDate: date,
        status: { in: [...OCCUPYING_VISIT_STATUSES] },
        scheduledStart: { lt: end },
        scheduledEnd: { gt: start },
        ...(visit.excludeVisitId ? { id: { not: visit.excludeVisitId } } : {}),
      },
      select: { id: true, scheduledStart: true, scheduledEnd: true },
    });
    if (overlapping.length) {
      conflicts.push({
        code: 'staff_double_booked',
        severity: 'blocking',
        message: `The caregiver already has ${overlapping.length === 1 ? 'a visit' : `${overlapping.length} visits`} at that time (${overlapping
          .map((v) => `${fromTime(v.scheduledStart)}-${fromTime(v.scheduledEnd)}`)
          .join(', ')})`,
        visitIds: overlapping.map((v) => v.id),
      });
    }

    const timeOff = await this.prisma.staffTimeOff.findMany({
      where: {
        staffProfileId: visit.staffId!,
        status: { in: ['approved', 'pending'] },
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { status: true },
    });
    if (timeOff.some((t) => t.status === 'approved')) {
      conflicts.push({ code: 'staff_time_off', severity: 'blocking', message: 'The caregiver has approved time off that day' });
    } else if (timeOff.length) {
      conflicts.push({
        code: 'staff_time_off_pending',
        severity: 'warning',
        message: 'The caregiver has requested time off that day (not yet decided)',
      });
    }

    // No availability on file means "not stated", not "never available".
    if (staff.availability.length) {
      const dayOfWeek = date.getUTCDay();
      const covered = staff.availability.some(
        (slot) => slot.dayOfWeek === dayOfWeek && slot.startTime <= start && slot.endTime >= end,
      );
      if (!covered) {
        conflicts.push({
          code: 'outside_availability',
          severity: 'warning',
          message: "The visit is outside the caregiver's stated availability",
        });
      }
    }

    if (!disciplineFits(visit.visitType, staff.discipline)) {
      conflicts.push({
        code: 'discipline_mismatch',
        severity: 'warning',
        message: `A ${staff.discipline} doesn't normally perform ${visit.visitType.replaceAll('_', ' ')} visits`,
      });
    }

    if (staff.credentials.length) {
      conflicts.push({
        code: 'staff_credentials_expired',
        severity: 'warning',
        message: `Expired by the visit date: ${staff.credentials.map((c) => c.credentialName).join(', ')}`,
      });
    }
    return conflicts;
  }
}
