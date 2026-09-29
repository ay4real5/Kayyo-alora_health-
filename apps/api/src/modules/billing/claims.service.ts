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
import { billingUnits, claimFormatFor, memberIdFor } from './billing-readiness.js';
import { BillingReadinessService, type BillableVisit } from './billing-readiness.service.js';
import type { CreateClaimsDto, InstitutionalClaimDto, ListClaimsQueryDto } from './dto/claims.dto.js';

const CLAIM_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
  payer: { select: { id: true, name: true, payerType: true } },
  lines: { orderBy: { lineNumber: 'asc' } },
  appeals: { orderBy: { level: 'asc' }, include: { createdBy: { select: { id: true, firstName: true, lastName: true } } } },
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
  /** Why the clearinghouse (999) or payer (277CA) rejected it (D-076); fix, re-check, put it in a new file. */
  rejection: { reason: string; at: Date | null } | null;
  /** The 837 file it was last put in. */
  ediFileId: string | null;
  submittedAt: Date | null;
  payerClaimNumber: string | null;
  /** The claim this one replaces (frequency 7 rebill, D-063). */
  originalClaimId: string | null;
  denial: { code: string | null; reason: string | null; deniedAt: Date | null; appealDeadline: string | null } | null;
  appeals: {
    id: string;
    level: number;
    status: string;
    filedOn: string;
    reason: string;
    reference: string | null;
    outcomeNotes: string | null;
    decidedOn: string | null;
    createdBy: { id: string; firstName: string; lastName: string };
  }[];
  /** Institutional (837I) claims only (D-061). */
  institutional: { typeOfBill: string | null; patientStatus: string | null; hippsCode: string | null; cbsaCode: string | null } | null;
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

interface NewLine {
  visitId: string;
  serviceCode: string;
  serviceDate: Date;
  units: number;
  unitRate: number;
  chargeAmount: number;
  evvStart: Date | null;
  evvEnd: Date | null;
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

    // Private-pay patients get an invoice, not an insurance claim (D-059).
    const privatePay = evaluated.filter((e) => e.ready && e.payer?.payerType === 'private_pay');
    skipped.push(
      ...privatePay.map((v) => ({
        visitId: v.visitId,
        reasons: ['Private pay — bill it on an invoice (Billing → Invoices)'],
      })),
    );

    const groups = new Map<string, BillableVisit[]>();
    for (const v of evaluated.filter((e) => e.ready && e.payer?.payerType !== 'private_pay')) {
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
    if (!['draft', 'ready', 'rejected'].includes(claim.status))
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
  /** Type of bill, patient status, HIPPS and CBSA on an 837I claim that hasn't been sent (D-061). */
  async setInstitutional(caller: AuthUser, id: string, dto: InstitutionalClaimDto): Promise<ClaimView> {
    const claim = await this.find(caller, id);
    if (claim.claimType !== '837I') throw new ConflictException('Only institutional (837I) claims have these fields');
    if (!['draft', 'ready', 'rejected'].includes(claim.status)) throw new ConflictException(`A ${claim.status} claim can't be changed`);
    await this.prisma.claim.update({
      where: { id },
      data: {
        ...(dto.typeOfBill !== undefined ? { typeOfBill: dto.typeOfBill } : {}),
        ...(dto.patientStatus !== undefined ? { patientStatus: dto.patientStatus } : {}),
        ...(dto.hippsCode !== undefined ? { hippsCode: dto.hippsCode || null } : {}),
        ...(dto.cbsaCode !== undefined ? { cbsaCode: dto.cbsaCode || null } : {}),
      },
    });
    return this.get(caller, id);
  }

  async void(caller: AuthUser, id: string, reason: string): Promise<ClaimView> {
    const claim = await this.find(caller, id);
    if (!['draft', 'ready', 'rejected'].includes(claim.status)) {
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
          status: true,
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
        select: { id: true, payerType: true, claimFormat: true },
      }),
    ]);
    // One line per visit — or per day, for a Virginia shift that crosses midnight (D-069).
    const lines = visits.flatMap((v): NewLine[] =>
      v.lineSplits
        ? v.lineSplits.map((piece) => {
            const units = billingUnits(v.unitType ?? 'visit', piece.minutes);
            return {
              visitId: v.visitId,
              serviceCode: v.serviceCode!,
              serviceDate: toDate(piece.date)!,
              units,
              unitRate: v.rate!,
              chargeAmount: money(units * v.rate!),
              evvStart: piece.start,
              evvEnd: piece.end,
            };
          })
        : [
            {
              visitId: v.visitId,
              serviceCode: v.serviceCode!,
              serviceDate: toDate(v.serviceDate)!,
              units: v.units!,
              unitRate: v.rate!,
              chargeAmount: v.amount!,
              evvStart: null,
              evvEnd: null,
            },
          ],
    );
    const dates = lines.map((l) => fromDate(l.serviceDate)!).sort();
    const memberId = memberIdFor(payer.payerType, patient);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.claim.create({
          data: {
            agencyId: caller.agencyId,
            patientId: first.patient.id,
            payerId: payer.id,
            claimNumber: newClaimNumber(today),
            claimType: claimFormatFor(payer),
            // Institutional defaults: home health final claim; still a patient unless discharged (billing can edit).
            ...(claimFormatFor(payer) === '837I'
              ? { typeOfBill: '0329', patientStatus: patient.status === 'discharged' ? '01' : '30' }
              : {}),
            status: 'ready',
            billingPeriodStart: toDate(dates[0])!,
            billingPeriodEnd: toDate(dates[dates.length - 1])!,
            totalCharges: money(lines.reduce((sum, l) => sum + l.chargeAmount, 0)),
            memberId: memberId === 'n/a' ? null : memberId,
            diagnosisCodes: patient.diagnoses.map((d) => d.icd10Code),
            qaPassed: true,
            qaReviewedAt: new Date(),
            createdById: caller.userId,
            lines: { create: lines.map((l, i) => ({ ...l, lineNumber: i + 1 })) },
          },
          include: CLAIM_INCLUDE,
        });
      } catch (error) {
        const target =
          error instanceof Prisma.PrismaClientKnownRequestError
            ? `${JSON.stringify(error.meta ?? {})} ${error.message}`
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
    rejection: c.rejectionReason ? { reason: c.rejectionReason, at: c.rejectedAt } : null,
    ediFileId: c.ediFileId,
    submittedAt: c.submittedAt,
    payerClaimNumber: c.payerClaimNumber,
    originalClaimId: c.originalClaimId,
    denial:
      c.denialReasonCode || c.deniedAt
        ? { code: c.denialReasonCode, reason: c.denialReason, deniedAt: c.deniedAt, appealDeadline: fromDate(c.appealDeadline) }
        : null,
    appeals: c.appeals.map((a) => ({
      id: a.id,
      level: a.level,
      status: a.status,
      filedOn: fromDate(a.filedOn)!,
      reason: a.reason,
      reference: a.reference,
      outcomeNotes: a.outcomeNotes,
      decidedOn: fromDate(a.decidedOn),
      createdBy: a.createdBy,
    })),
    institutional:
      c.claimType === '837I'
        ? { typeOfBill: c.typeOfBill, patientStatus: c.patientStatus, hippsCode: c.hippsCode, cbsaCode: c.cbsaCode }
        : null,
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
