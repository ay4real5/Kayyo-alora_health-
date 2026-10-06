import { VISIT_TYPE_DISCIPLINES, type VisitType } from '@alora/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, fromTime, toDate } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import { milesBetween, scoreCaregiver } from './caregiver-match.js';
import { ConflictDetectorService, type ProposedVisit } from './conflict-detector.service.js';

/** How many ranked suggestions to return (the excluded list has its own cap). */
export const SUGGESTION_LIMIT = 10;
const EXCLUDED_LIMIT = 20;

export interface CaregiverSuggestion {
  staff: { id: string; firstName: string; lastName: string; discipline: string };
  score: number;
  reasons: { text: string; good: boolean }[];
}

export interface CaregiverSuggestions {
  visit: { patientId: string; visitType: string; scheduledDate: string; scheduledStart: string; scheduledEnd: string };
  suggestions: CaregiverSuggestion[];
  /** Who could not take it, and why (blocking scheduling rules, or declined by the patient). */
  excluded: { staff: { id: string; firstName: string; lastName: string }; reason: string }[];
  /** Caregivers of the right discipline considered. */
  considered: number;
}

const hoursOf = (start: Date, end: Date) => {
  let h = (end.getTime() - start.getTime()) / 3_600_000;
  if (h <= 0) h += 24; // overnight
  return h;
};
const zip5 = (z: string | null | undefined) => (z ?? '').slice(0, 5);

/** Monday of the visit's week (the overtime week), YYYY-MM-DD. */
function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

/**
 * Who should take this visit (D-094): every active caregiver of a fitting discipline, minus those the scheduling rules
 * block (double booked, time off, expired credentials, …) or the patient declined, ranked by `scoreCaregiver` with
 * plain-language reasons. Read-only — assigning is the normal visit update.
 */
@Injectable()
export class CaregiverMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conflicts: ConflictDetectorService,
  ) {}

  async forVisit(caller: AuthUser, visitId: string): Promise<CaregiverSuggestions> {
    const visit = await this.prisma.visit.findFirst({ where: { id: visitId, agencyId: caller.agencyId } });
    if (!visit) throw new NotFoundException('Visit not found');
    return this.suggest(caller, {
      agencyId: caller.agencyId,
      patientId: visit.patientId,
      visitType: visit.visitType as VisitType,
      scheduledDate: fromDate(visit.scheduledDate)!,
      scheduledStart: fromTime(visit.scheduledStart),
      scheduledEnd: fromTime(visit.scheduledEnd),
      serviceCode: visit.serviceCode,
      excludeVisitId: visit.id,
    });
  }

  async suggest(caller: AuthUser, proposal: Omit<ProposedVisit, 'staffId'>): Promise<CaregiverSuggestions> {
    const disciplines = VISIT_TYPE_DISCIPLINES[proposal.visitType];
    if (!disciplines) throw new BadRequestException('Unknown visit type');
    const patient = await this.prisma.patient.findFirst({
      where: { id: proposal.patientId, agencyId: caller.agencyId },
      select: {
        zip: true,
        latitude: true,
        longitude: true,
        preferredLanguage: true,
        preferredCaregiverGender: true,
        caregiverPreferences: { select: { staffProfileId: true, kind: true } },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const candidates = await this.prisma.staffProfile.findMany({
      where: { agencyId: caller.agencyId, isActive: true, user: { isActive: true }, discipline: { in: [...disciplines] } },
      select: {
        id: true,
        discipline: true,
        gender: true,
        languages: true,
        zip: true,
        latitude: true,
        longitude: true,
        serviceAreaZipCodes: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    const ids = candidates.map((c) => c.id);
    const declined = new Set(patient.caregiverPreferences.filter((p) => p.kind === 'declined').map((p) => p.staffProfileId));
    const preferred = new Set(patient.caregiverPreferences.filter((p) => p.kind === 'preferred').map((p) => p.staffProfileId));

    const date = proposal.scheduledDate;
    const monday = weekStart(date);
    const [history, week, recent, missed, late] = await Promise.all([
      this.prisma.visit.groupBy({
        by: ['staffId'],
        where: { staffId: { in: ids }, patientId: proposal.patientId, status: 'completed', scheduledDate: { gte: toDate(addDays(date, -180))! } },
        _count: { _all: true },
      }),
      this.prisma.visit.findMany({
        where: {
          staffId: { in: ids },
          status: { in: ['scheduled', 'in_progress', 'completed'] },
          scheduledDate: { gte: toDate(monday)!, lte: toDate(addDays(monday, 6))! },
          ...(proposal.excludeVisitId ? { id: { not: proposal.excludeVisitId } } : {}),
        },
        select: { staffId: true, scheduledStart: true, scheduledEnd: true },
      }),
      this.prisma.visit.groupBy({
        by: ['staffId'],
        where: { staffId: { in: ids }, status: 'completed', scheduledDate: { gte: toDate(addDays(date, -90))!, lt: toDate(date)! } },
        _count: { _all: true },
      }),
      this.prisma.visit.groupBy({
        by: ['staffId'],
        where: { staffId: { in: ids }, status: 'missed', scheduledDate: { gte: toDate(addDays(date, -90))!, lt: toDate(date)! } },
        _count: { _all: true },
      }),
      this.prisma.visit.groupBy({
        by: ['staffId'],
        where: { staffId: { in: ids }, status: 'completed', lateAlertedAt: { not: null }, scheduledDate: { gte: toDate(addDays(date, -90))!, lt: toDate(date)! } },
        _count: { _all: true },
      }),
    ]);
    const count = (rows: { staffId: string | null; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.staffId, r._count._all]));
    const historyBy = count(history);
    const recentBy = count(recent);
    const missedBy = count(missed);
    const lateBy = count(late);
    const weekHours = new Map<string, number>();
    for (const v of week) weekHours.set(v.staffId!, (weekHours.get(v.staffId!) ?? 0) + hoursOf(v.scheduledStart, v.scheduledEnd));
    const [sh, sm] = proposal.scheduledStart.split(':').map(Number);
    const [eh, em] = proposal.scheduledEnd.split(':').map(Number);
    let visitHours = (eh! * 60 + em! - (sh! * 60 + sm!)) / 60;
    if (visitHours <= 0) visitHours += 24;

    const excluded: CaregiverSuggestions['excluded'] = [];
    const suggestions: CaregiverSuggestion[] = [];
    const eligible = candidates.filter((c) => {
      if (!declined.has(c.id)) return true;
      excluded.push({ staff: { id: c.id, firstName: c.user.firstName, lastName: c.user.lastName }, reason: 'Declined by the patient' });
      return false;
    });
    // The scheduling rules, a few at a time (gentle on the connection pool).
    for (let i = 0; i < eligible.length; i += 5) {
      const batch = eligible.slice(i, i + 5);
      const checked = await Promise.all(batch.map(async (c) => ({ c, conflicts: await this.conflicts.check({ ...proposal, staffId: c.id }) })));
      for (const { c, conflicts } of checked) {
        const name = { firstName: c.user.firstName, lastName: c.user.lastName };
        const blocking = conflicts.find((x) => x.severity === 'blocking');
        if (blocking) {
          excluded.push({ staff: { id: c.id, ...name }, reason: blocking.message });
          continue;
        }
        const hasCoords = c.latitude !== null && c.longitude !== null && patient.latitude !== null && patient.longitude !== null;
        const { score, reasons } = scoreCaregiver({
          visitsWithPatient: historyBy.get(c.id) ?? 0,
          preferredByPatient: preferred.has(c.id),
          genderPreference: patient.preferredCaregiverGender,
          gender: c.gender,
          languagePreference: patient.preferredLanguage,
          languages: c.languages,
          miles: hasCoords
            ? milesBetween({ lat: Number(c.latitude), lng: Number(c.longitude) }, { lat: Number(patient.latitude), lng: Number(patient.longitude) })
            : null,
          sameZip: Boolean(zip5(patient.zip)) && zip5(c.zip) === zip5(patient.zip),
          inServiceArea: Boolean(zip5(patient.zip)) && c.serviceAreaZipCodes.some((z) => zip5(z) === zip5(patient.zip)),
          weekHours: weekHours.get(c.id) ?? 0,
          visitHours,
          recentVisits: recentBy.get(c.id) ?? 0,
          missed: missedBy.get(c.id) ?? 0,
          late: lateBy.get(c.id) ?? 0,
          warnings: conflicts.filter((x) => x.severity !== 'blocking').map((x) => x.message),
        });
        suggestions.push({ staff: { id: c.id, ...name, discipline: c.discipline }, score, reasons });
      }
    }
    suggestions.sort((a, b) => b.score - a.score || a.staff.lastName.localeCompare(b.staff.lastName));
    return {
      visit: {
        patientId: proposal.patientId,
        visitType: proposal.visitType,
        scheduledDate: proposal.scheduledDate,
        scheduledStart: proposal.scheduledStart,
        scheduledEnd: proposal.scheduledEnd,
      },
      suggestions: suggestions.slice(0, SUGGESTION_LIMIT),
      excluded: excluded.slice(0, EXCLUDED_LIMIT),
      considered: candidates.length,
    };
  }
}
