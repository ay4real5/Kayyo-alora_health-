import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { evaluate, type Readiness } from './billing-readiness.js';
import type { ReadinessQueryDto } from './dto/billing-setup.dto.js';

const VISIT_INCLUDE = {
  patient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      mrn: true,
      medicaidId: true,
      medicareBeneficiaryId: true,
      insuranceMemberId: true,
      payerPrimary: {
        select: {
          id: true,
          name: true,
          payerType: true,
          requiresAuthorization: true,
          timelyFilingDays: true,
          isActive: true,
        },
      },
      diagnoses: { where: { isPrimary: true }, select: { id: true }, take: 1 },
    },
  },
  staff: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  evvRecords: { select: { status: true } },
  visitNotes: { where: { status: { in: ['signed', 'submitted'] } }, select: { id: true }, take: 1 },
  authorization: {
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      authorizedVisits: true,
      authorizedHours: true,
    },
  },
} satisfies Prisma.VisitInclude;
type VisitRow = Prisma.VisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

export interface BillableVisit extends Readiness {
  visitId: string;
  serviceDate: string;
  serviceCode: string | null;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  staff: { id: string; firstName: string; lastName: string } | null;
  payer: { id: string; name: string } | null;
  minutes: number;
}

const minutesBetween = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
const MAX_RANGE_DAYS = 92;

/**
 * Pre-billing QA over completed visits (DESIGN.md §10.1, DECISIONS D-051): each visit with its checks, units, rate and
 * amount, so billing sees what's ready and exactly what blocks the rest. Read-only.
 */
@Injectable()
export class BillingReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
  ) {}

  async list(
    caller: AuthUser,
    query: ReadinessQueryDto,
  ): Promise<{
    summary: ReadinessSummary;
    visits: BillableVisit[];
    meta: { page: number; limit: number; total: number };
  }> {
    const today = await this.clock.todayString(caller.agencyId);
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -30);
    if (to < from) throw new BadRequestException('to cannot be before from');
    if (to > addDays(from, MAX_RANGE_DAYS))
      throw new BadRequestException(`The range can be at most ${MAX_RANGE_DAYS} days`);

    const visits = await this.prisma.visit.findMany({
      where: {
        agencyId: caller.agencyId,
        status: 'completed',
        scheduledDate: { gte: toDate(from), lte: toDate(to) },
        ...(query.payerId ? { patient: { payerPrimaryId: query.payerId } } : {}),
      },
      include: VISIT_INCLUDE,
      orderBy: [{ scheduledDate: 'asc' }, { scheduledStart: 'asc' }],
      take: 2000,
    });
    const evaluated = await this.evaluateAll(caller.agencyId, visits, today);
    const filtered =
      query.readyOnly === undefined
        ? evaluated
        : evaluated.filter((v) => v.ready === query.readyOnly);
    return {
      summary: summarise(evaluated),
      visits: filtered.slice(query.skip, query.skip + query.limit),
      meta: { page: query.page, limit: query.limit, total: filtered.length },
    };
  }

  private async evaluateAll(
    agencyId: string,
    visits: VisitRow[],
    today: string,
  ): Promise<BillableVisit[]> {
    const [agency, codes] = await Promise.all([
      this.prisma.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { npi: true } }),
      this.prisma.serviceCode.findMany({ where: { agencyId, isActive: true } }),
    ]);
    const codeByName = new Map(codes.map((c) => [c.code, c]));
    const payerIds = [
      ...new Set(
        visits.map((v) => v.patient.payerPrimary?.id).filter((id): id is string => Boolean(id)),
      ),
    ];
    const rates = payerIds.length
      ? await this.prisma.payerRate.findMany({
          where: { payerId: { in: payerIds }, modifier1: null, modifier2: null },
        })
      : [];
    const overLimit = await this.overLimitVisits(visits);

    return visits.map((v) => {
      const date = fromDate(v.scheduledDate)!;
      const code = v.serviceCode ? codeByName.get(v.serviceCode) : undefined;
      const payer = v.patient.payerPrimary;
      const rate =
        code && payer
          ? rates.find(
              (r) =>
                r.payerId === payer.id &&
                r.serviceCodeId === code.id &&
                fromDate(r.effectiveDate)! <= date &&
                (!r.endDate || fromDate(r.endDate)! >= date),
            )
          : undefined;
      const minutes =
        v.actualStart && v.actualEnd
          ? minutesBetween(v.actualStart, v.actualEnd)
          : minutesBetween(v.scheduledStart, v.scheduledEnd);
      const auth = v.authorization;
      const readiness = evaluate({
        visitStatus: v.status,
        serviceDate: date,
        minutes,
        evvStatus: v.evvRecords[0]?.status ?? null,
        hasFinalNote: v.visitNotes.length > 0,
        serviceCode: code
          ? {
              code: code.code,
              unitType: code.unitType,
              defaultRate: code.defaultRate === null ? null : Number(code.defaultRate),
              requiresAuth: code.requiresAuth,
            }
          : null,
        visitServiceCode: v.serviceCode,
        payer: payer
          ? {
              payerType: payer.payerType,
              requiresAuthorization: payer.requiresAuthorization,
              timelyFilingDays: payer.timelyFilingDays,
              isActive: payer.isActive,
            }
          : null,
        memberIds: {
          medicaidId: v.patient.medicaidId,
          medicareBeneficiaryId: v.patient.medicareBeneficiaryId,
          insuranceMemberId: v.patient.insuranceMemberId,
        },
        hasPrimaryDiagnosis: v.patient.diagnoses.length > 0,
        authorization: auth
          ? {
              state: auth.status,
              coversDate: fromDate(auth.startDate)! <= date && fromDate(auth.endDate)! >= date,
              overLimit: overLimit.has(v.id),
            }
          : null,
        payerRate: rate ? Number(rate.rate) : null,
        agencyNpi: agency.npi,
        today,
      });
      return {
        visitId: v.id,
        serviceDate: date,
        serviceCode: v.serviceCode,
        patient: {
          id: v.patient.id,
          firstName: v.patient.firstName,
          lastName: v.patient.lastName,
          mrn: v.patient.mrn,
        },
        staff: v.staff
          ? { id: v.staff.id, firstName: v.staff.user.firstName, lastName: v.staff.user.lastName }
          : null,
        payer: payer ? { id: payer.id, name: payer.name } : null,
        minutes,
        ...readiness,
      };
    });
  }

  /**
   * Visits past their authorization's limit, in service order: the first N completed visits (or hours) are covered,
   * later ones are over.
   */
  private async overLimitVisits(visits: VisitRow[]): Promise<Set<string>> {
    const auths = new Map(
      visits.filter((v) => v.authorization).map((v) => [v.authorization!.id, v.authorization!]),
    );
    const over = new Set<string>();
    if (!auths.size) return over;
    const linked = await this.prisma.visit.findMany({
      where: {
        authorizationId: { in: [...auths.keys()] },
        status: { in: ['completed', 'in_progress'] },
      },
      select: {
        id: true,
        authorizationId: true,
        scheduledStart: true,
        scheduledEnd: true,
        actualStart: true,
        actualEnd: true,
      },
      orderBy: [{ scheduledDate: 'asc' }, { scheduledStart: 'asc' }],
    });
    const running = new Map<string, { visits: number; hours: number }>();
    for (const v of linked) {
      const auth = auths.get(v.authorizationId!)!;
      const sum = running.get(auth.id) ?? { visits: 0, hours: 0 };
      sum.visits += 1;
      sum.hours +=
        (v.actualStart && v.actualEnd
          ? minutesBetween(v.actualStart, v.actualEnd)
          : minutesBetween(v.scheduledStart, v.scheduledEnd)) / 60;
      running.set(auth.id, sum);
      if (
        (auth.authorizedVisits !== null && sum.visits > auth.authorizedVisits) ||
        (auth.authorizedHours !== null && sum.hours > Number(auth.authorizedHours) + 1e-9)
      ) {
        over.add(v.id);
      }
    }
    return over;
  }
}

export interface ReadinessSummary {
  visits: number;
  ready: number;
  blocked: number;
  readyAmount: number;
  /** How many visits fail each check — where to start fixing. */
  blockers: Record<string, number>;
}

function summarise(visits: BillableVisit[]): ReadinessSummary {
  const blockers: Record<string, number> = {};
  for (const v of visits) {
    for (const c of v.checks)
      if (!c.ok && c.severity === 'error') blockers[c.code] = (blockers[c.code] ?? 0) + 1;
  }
  const ready = visits.filter((v) => v.ready);
  return {
    visits: visits.length,
    ready: ready.length,
    blocked: visits.length - ready.length,
    readyAmount: Math.round(ready.reduce((sum, v) => sum + (v.amount ?? 0), 0) * 100) / 100,
    blockers,
  };
}
