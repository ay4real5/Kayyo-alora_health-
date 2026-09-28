import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ClaimsService, type ClaimView } from './claims.service.js';
import type { AgingQueryDto, DecideAppealDto, FileAppealDto } from './dto/claims.dto.js';

/** Claims with money still expected from the payer. */
const OUTSTANDING = ['submitted', 'acknowledged', 'partially_paid', 'denied', 'appealed'];
const BUCKETS = ['0-30', '31-60', '61-90', '91-120', '120+'] as const;
const money = (n: number) => Math.round(n * 100) / 100;
const bucketOf = (days: number) => (days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : days <= 120 ? 3 : 4);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export interface AgingRow {
  id: string;
  name: string;
  buckets: number[];
  total: number;
}

/**
 * After a claim leaves the building (DECISIONS D-063): marking it submitted (until the clearinghouse does it, P3-09),
 * appeals of denials, corrected claims (frequency 7), and the accounts-receivable aging report.
 */
@Injectable()
export class ClaimWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly claims: ClaimsService,
  ) {}

  /** Staff sent the file through the clearinghouse portal: ready → submitted. Starts the aging clock. */
  async markSubmitted(caller: AuthUser, id: string): Promise<ClaimView> {
    await this.claims.get(caller, id);
    const updated = await this.prisma.claim.updateMany({
      where: { id, agencyId: caller.agencyId, status: 'ready' },
      data: { status: 'submitted', submittedAt: new Date(), submittedById: caller.userId },
    });
    if (!updated.count) throw new ConflictException('Only a ready claim can be marked as submitted');
    return this.claims.get(caller, id);
  }

  /** Files the next-level appeal of a denied claim. */
  async fileAppeal(caller: AuthUser, id: string, dto: FileAppealDto): Promise<ClaimView> {
    const claim = await this.claims.get(caller, id);
    if (claim.status !== 'denied' && claim.status !== 'partially_paid') {
      throw new ConflictException('Only a denied or partly paid claim can be appealed');
    }
    const today = await this.clock.todayString(caller.agencyId);
    const filedOn = dto.filedOn ?? today;
    if (filedOn > today) throw new ConflictException('The filing date can’t be in the future');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.claim.updateMany({ where: { id, status: claim.status }, data: { status: 'appealed' } });
      if (!moved.count) throw new ConflictException('The claim changed meanwhile — reload and try again');
      await tx.claimAppeal.create({
        data: {
          claimId: id,
          level: claim.appeals.length + 1,
          filedOn: toDate(filedOn)!,
          reason: dto.reason,
          reference: dto.reference ?? null,
          createdById: caller.userId,
        },
      });
    });
    return this.claims.get(caller, id);
  }

  /** Records the payer's decision. Won → back to submitted, awaiting the corrected payment; lost/withdrawn → denied. */
  async decideAppeal(caller: AuthUser, id: string, appealId: string, dto: DecideAppealDto): Promise<ClaimView> {
    const claim = await this.claims.get(caller, id);
    const appeal = claim.appeals.find((a) => a.id === appealId);
    if (!appeal) throw new NotFoundException('Appeal not found');
    if (appeal.status !== 'filed') throw new ConflictException('This appeal was already decided');
    const decidedOn = dto.decidedOn ?? (await this.clock.todayString(caller.agencyId));
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.claimAppeal.updateMany({
        where: { id: appealId, status: 'filed' },
        data: { status: dto.outcome, decidedOn: toDate(decidedOn)!, outcomeNotes: dto.notes ?? null },
      });
      if (!done.count) throw new ConflictException('This appeal was already decided');
      await tx.claim.update({ where: { id }, data: { status: dto.outcome === 'won' ? 'submitted' : 'denied' } });
    });
    return this.claims.get(caller, id);
  }

  /**
   * A corrected claim (frequency 7) replacing one the payer already has: same visits and amounts, a new claim number,
   * `original_claim_id` pointing back; the original becomes `replaced` and its lines release to the new claim.
   */
  async rebill(caller: AuthUser, id: string, reason: string): Promise<ClaimView> {
    const original = await this.prisma.claim.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: { lines: { where: { active: true }, orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) throw new NotFoundException('Claim not found');
    if (!['submitted', 'acknowledged', 'denied', 'partially_paid', 'paid'].includes(original.status)) {
      throw new ConflictException(`A ${original.status} claim can't be replaced — void or resubmit it instead`);
    }
    const today = await this.clock.todayString(caller.agencyId);
    const created = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.claim.updateMany({ where: { id, status: original.status }, data: { status: 'replaced' } });
      if (!moved.count) throw new ConflictException('The claim changed meanwhile — reload and try again');
      await tx.claimLine.updateMany({ where: { claimId: id }, data: { active: false } });
      return tx.claim.create({
        data: {
          agencyId: original.agencyId,
          patientId: original.patientId,
          payerId: original.payerId,
          claimNumber: `${today.slice(2).replaceAll('-', '')}${Array.from(randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')}`,
          claimType: original.claimType,
          status: 'ready',
          frequencyCode: '7',
          originalClaimId: original.id,
          payerClaimNumber: original.payerClaimNumber,
          billingPeriodStart: original.billingPeriodStart,
          billingPeriodEnd: original.billingPeriodEnd,
          totalCharges: original.totalCharges,
          memberId: original.memberId,
          diagnosisCodes: original.diagnosisCodes,
          typeOfBill: original.typeOfBill ? `${original.typeOfBill.slice(0, 3)}7` : null,
          patientStatus: original.patientStatus,
          hippsCode: original.hippsCode,
          cbsaCode: original.cbsaCode,
          notes: `Replaces claim ${original.claimNumber}: ${reason}`,
          createdById: caller.userId,
          lines: {
            create: original.lines.map((l, i) => ({
              visitId: l.visitId,
              lineNumber: i + 1,
              serviceCode: l.serviceCode,
              modifier1: l.modifier1,
              modifier2: l.modifier2,
              serviceDate: l.serviceDate,
              units: l.units,
              unitRate: l.unitRate,
              chargeAmount: l.chargeAmount,
              placeOfService: l.placeOfService,
            })),
          },
        },
        select: { id: true },
      });
    });
    return this.claims.get(caller, created.id);
  }

  /**
   * Accounts receivable by age (DESIGN.md §12): claims by days since submission (or creation), per payer; private-pay
   * invoices by days since issue. Balance = charges − paid − adjustments − patient responsibility, except that denial
   * adjustments still count as owed while the denial is open (denied, appealed, or won and awaiting payment).
   */
  async aging(caller: AuthUser, query: AgingQueryDto) {
    const asOf = query.asOf ?? (await this.clock.todayString(caller.agencyId));
    const [claims, invoices] = await Promise.all([
      this.prisma.claim.findMany({
        where: { agencyId: caller.agencyId, status: { in: OUTSTANDING }, createdAt: { lt: new Date(`${addDays(asOf, 1)}T00:00:00Z`) } },
        select: {
          totalCharges: true,
          totalPaid: true,
          totalAdjustments: true,
          patientResponsibility: true,
          submittedAt: true,
          createdAt: true,
          status: true,
          deniedAt: true,
          payer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.invoice.findMany({
        where: { agencyId: caller.agencyId, status: { in: ['sent', 'partially_paid'] }, issueDate: { lte: toDate(asOf) } },
        select: { totalAmount: true, paidAmount: true, issueDate: true },
      }),
    ]);
    const byPayer = new Map<string, AgingRow>();
    for (const c of claims) {
      // A denial's adjustment isn't a write-off while it can be appealed or was overturned (won, awaiting payment).
      const denialOpen = c.status === 'denied' || c.status === 'appealed' || (c.status === 'submitted' && c.deniedAt);
      const adjustments = denialOpen ? 0 : Number(c.totalAdjustments);
      const balance = money(Number(c.totalCharges) - Number(c.totalPaid) - adjustments - Number(c.patientResponsibility));
      if (balance <= 0.005) continue;
      const from = (c.submittedAt ?? c.createdAt).toISOString().slice(0, 10);
      const row = byPayer.get(c.payer.id) ?? { id: c.payer.id, name: c.payer.name, buckets: [0, 0, 0, 0, 0], total: 0 };
      const b = bucketOf(Math.max(0, daysBetween(from, asOf)));
      row.buckets[b] = money(row.buckets[b]! + balance);
      row.total = money(row.total + balance);
      byPayer.set(c.payer.id, row);
    }
    const invoiceRow: AgingRow = { id: 'private_pay', name: 'Private pay (invoices)', buckets: [0, 0, 0, 0, 0], total: 0 };
    for (const inv of invoices) {
      const balance = money(Number(inv.totalAmount) - Number(inv.paidAmount));
      if (balance <= 0.005) continue;
      const b = bucketOf(Math.max(0, daysBetween(fromDate(inv.issueDate)!, asOf)));
      invoiceRow.buckets[b] = money(invoiceRow.buckets[b]! + balance);
      invoiceRow.total = money(invoiceRow.total + balance);
    }
    const rows = [...byPayer.values()].sort((a, b) => b.total - a.total);
    if (invoiceRow.total > 0) rows.push(invoiceRow);
    const totals = BUCKETS.map((_, i) => money(rows.reduce((sum, r) => sum + r.buckets[i]!, 0)));
    return { asOf, buckets: BUCKETS, rows, totals, total: money(totals.reduce((a, b) => a + b, 0)) };
  }
}

