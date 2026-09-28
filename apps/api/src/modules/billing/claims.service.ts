import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { memberIdFor } from './billing-readiness.js';
import { BillingReadinessService, type BillableVisit } from './billing-readiness.service.js';
import type { CreateClaimsDto, ListClaimsQueryDto } from './dto/claims.dto.js';

const CLAIM_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
  payer: { select: { id: true, name: true, payerType: true } },
  lines: { orderBy: { lineNumber: 'asc' } },
} satisfies Prisma.ClaimInclude;
type ClaimRow = Prisma.ClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

export interface ClaimView {
  id: string;
  claimNumber: string;
  claimType: string;
  status: string;
  frequencyCode: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  payer: { id: string; name: string; payerType: string };
  memberId: string | null;
  diagnosisCodes: string[];
  billingPeriodStart: string;
  billingPeriodEnd: string;
  totalCharges: number;
  totalPaid: number;
  qaPassed: boolean | null;
  qaErrors: unknown;
  voidReason: string | null;
  lines: {
    id: string;
    lineNumber: number;
    visitId: string | null;
    serviceCode: string;
    modifier1: string | null;
    serviceDate: string;
    units: number;
    unitRate: number;
    chargeAmount: number;
    placeOfService: string;
    active: boolean;
  }[];
  createdAt: Date;
}

export interface CreateClaimsResult {
  created: ClaimView[];
  /** Visits in the range that weren't billed, and why. */
  skipped: { visitId: string; reasons: string[] }[];
}

const MAX_DIAGNOSES = 12; // X12 837 HI segment
const money = (n: number) => Math.round(n * 100) / 100;

/** 12 characters: date (yymmdd) + 6 random base-32 — short enough for X12 CLM01 (max 20), unique per agency. */
function newClaimNumber(today: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  return `${today.slice(2).replaceAll('-', '')}${random}`;
}

/**
 * Claims (DESIGN.md §10.1, DECISIONS D-052). Made from visits that pass pre-billing QA (D-051): one claim per patient
 * and payer, one line per visit, amounts and codes frozen at creation. A visit is on at most one active claim — the
 * database enforces it, so two people creating claims at once can't double-bill. Voiding releases the visits.
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly readiness: BillingReadinessService,
  ) {}

  async list(caller: AuthUser, query: ListClaimsQueryDto): Promise<Paginated<ClaimView>> {
    const where: Prisma.ClaimWhereInput = {
      agencyId: caller.agencyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.payerId ? { payerId: query.payerId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        include: CLAIM_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.claim.count({ where }),
    ]);
    return Paginated.of(rows.map(toView), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<ClaimView> {
    return toView(await this.find(caller, id));
  }

  /** Bills every ready, unbilled completed visit in the range (or just the given visits). */
  async create(caller: AuthUser, dto: CreateClaimsDto): Promise<CreateClaimsResult> {
    const visitIds = dto.visitIds ?? (await this.completedVisitIds(caller, dto));
    if (!visitIds.length) return { created: [], skipped: [] };
    const evaluated = await this.readiness.evaluateVisits(caller.agencyId, visitIds);
    const skipped = evaluated
      .filter((v) => !v.ready)
      .map((v) => ({
        visitId: v.visitId,
        reasons: v.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.message),
      }));
    const missing = visitIds.filter((id) => !evaluated.some((v) => v.visitId === id));
    skipped.push(...missing.map((visitId) => ({ visitId, reasons: ['Visit not found'] })));

    const groups = new Map<string, BillableVisit[]>();
    for (const v of evaluated.filter((e) => e.ready)) {
      const key = `${v.patient.id}|${v.payer!.id}`;
      groups.set(key, [...(groups.get(key) ?? []), v]);
    }

    const today = await this.clock.todayString(caller.agencyId);
    const created: ClaimView[] = [];
    for (const visits of groups.values()) {
      try {
        created.push(toView(await this.createOne(caller, visits, today)));
      } catch (error) {
        // Someone billed one of these visits a moment ago (one active line per visit).
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          skipped.push(
            ...visits.map((v) => ({
              visitId: v.visitId,
              reasons: ['Billed on another claim just now'],
            })),
          );
          continue;
        }
        throw error;
      }
    }
    return { created, skipped };
  }

  /** Re-runs pre-billing QA on the claim's visits: ready if they all still pass, back to draft with the reasons if not. */
  async qa(caller: AuthUser, id: string): Promise<ClaimView> {
    const claim = await this.find(caller, id);
    if (!['draft', 'ready'].includes(claim.status))
      throw new ConflictException(`A ${claim.status} claim can't be re-checked`);
    const visitIds = claim.lines.filter((l) => l.visitId).map((l) => l.visitId!);
    const results = await this.readiness.evaluateVisits(caller.agencyId, visitIds, claim.id);
    const errors = results
      .filter((r) => !r.ready)
      .map((r) => ({
        visitId: r.visitId,
        messages: r.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.message),
      }));
    const updated = await this.prisma.claim.update({
      where: { id },
      data: {
        qaPassed: errors.length === 0,
        qaErrors: errors.length ? errors : Prisma.JsonNull,
        qaReviewedAt: new Date(),
        status: errors.length ? 'draft' : 'ready',
      },
      include: CLAIM_INCLUDE,
    });
    return toView(updated);
  }

  /**
   * Voids a claim that hasn't been sent: its visits can be billed again. (A claim already submitted to a payer needs a
   * void/replacement claim to the payer — frequency code 8/7 — which comes with submission, P3-09.)
   */
  async void(caller: AuthUser, id: string, reason: string): Promise<ClaimView> {
    const claim = await this.find(caller, id);
    if (!['draft', 'ready'].includes(claim.status)) {
      throw new ConflictException(
        `A ${claim.status} claim can't be voided here — it was sent to the payer`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.claimLine.updateMany({ where: { claimId: id }, data: { active: false } }),
      this.prisma.claim.update({ where: { id }, data: { status: 'void', voidReason: reason } }),
    ]);
    return this.get(caller, id);
  }

  private async createOne(
    caller: AuthUser,
    visits: BillableVisit[],
    today: string,
  ): Promise<ClaimRow> {
    const first = visits[0]!;
    const [patient, payer] = await Promise.all([
      this.prisma.patient.findUniqueOrThrow({
        where: { id: first.patient.id },
        select: {
          medicaidId: true,
          medicareBeneficiaryId: true,
          insuranceMemberId: true,
          diagnoses: {
            orderBy: [{ isPrimary: 'desc' }, { sequenceOrder: 'asc' }],
            select: { icd10Code: true },
            take: MAX_DIAGNOSES,
          },
        },
      }),
      this.prisma.payer.findUniqueOrThrow({
        where: { id: first.payer!.id },
        select: { id: true, payerType: true },
      }),
    ]);
    const dates = visits.map((v) => v.serviceDate).sort();
    const memberId = memberIdFor(payer.payerType, patient);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.claim.create({
          data: {
            agencyId: caller.agencyId,
            patientId: first.patient.id,
            payerId: payer.id,
            claimNumber: newClaimNumber(today),
            claimType: payer.payerType === 'medicare' ? '837I' : '837P',
            status: 'ready',
            billingPeriodStart: toDate(dates[0])!,
            billingPeriodEnd: toDate(dates[dates.length - 1])!,
            totalCharges: money(visits.reduce((sum, v) => sum + (v.amount ?? 0), 0)),
            memberId: memberId === 'n/a' ? null : memberId,
            diagnosisCodes: patient.diagnoses.map((d) => d.icd10Code),
            qaPassed: true,
            qaReviewedAt: new Date(),
            createdById: caller.userId,
            lines: {
              create: visits.map((v, i) => ({
                visitId: v.visitId,
                lineNumber: i + 1,
                serviceCode: v.serviceCode!,
                serviceDate: toDate(v.serviceDate)!,
                units: v.units!,
                unitRate: v.rate!,
                chargeAmount: v.amount!,
              })),
            },
          },
          include: CLAIM_INCLUDE,
        });
      } catch (error) {
        const target =
          error instanceof Prisma.PrismaClientKnownRequestError
            ? String(error.meta?.target ?? '')
            : '';
        // A claim-number collision (vanishingly rare): pick another. Anything else (e.g. a visit billed meanwhile) bubbles.
        if (
          attempt < 3 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          target.includes('claim_number')
        )
          continue;
        throw error;
      }
    }
  }

  private async completedVisitIds(caller: AuthUser, dto: CreateClaimsDto): Promise<string[]> {
    if (!dto.from || !dto.to) throw new BadRequestException('Give visitIds, or from and to');
    if (dto.to < dto.from) throw new BadRequestException('to cannot be before from');
    if (dto.to > addDays(dto.from, 92))
      throw new BadRequestException('The range can be at most 92 days');
    const visits = await this.prisma.visit.findMany({
      where: {
        agencyId: caller.agencyId,
        status: 'completed',
        scheduledDate: { gte: toDate(dto.from), lte: toDate(dto.to) },
        claimLines: { none: { active: true } },
        ...(dto.payerId ? { patient: { payerPrimaryId: dto.payerId } } : {}),
      },
      select: { id: true },
      take: 2000,
    });
    return visits.map((v) => v.id);
  }

  private async find(caller: AuthUser, id: string): Promise<ClaimRow> {
    const claim = await this.prisma.claim.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: CLAIM_INCLUDE,
    });
    if (!claim) throw new NotFoundException('Claim not found');
    return claim;
  }
}

function toView(c: ClaimRow): ClaimView {
  return {
    id: c.id,
    claimNumber: c.claimNumber,
    claimType: c.claimType,
    status: c.status,
    frequencyCode: c.frequencyCode,
    patient: c.patient,
    payer: c.payer,
    memberId: c.memberId,
    diagnosisCodes: c.diagnosisCodes,
    billingPeriodStart: fromDate(c.billingPeriodStart)!,
    billingPeriodEnd: fromDate(c.billingPeriodEnd)!,
    totalCharges: Number(c.totalCharges),
    totalPaid: Number(c.totalPaid),
    qaPassed: c.qaPassed,
    qaErrors: c.qaErrors,
    voidReason: c.voidReason,
    lines: c.lines.map((l) => ({
      id: l.id,
      lineNumber: l.lineNumber,
      visitId: l.visitId,
      serviceCode: l.serviceCode,
      modifier1: l.modifier1,
      serviceDate: fromDate(l.serviceDate)!,
      units: Number(l.units),
      unitRate: Number(l.unitRate),
      chargeAmount: Number(l.chargeAmount),
      placeOfService: l.placeOfService,
      active: l.active,
    })),
    createdAt: c.createdAt,
  };
}
