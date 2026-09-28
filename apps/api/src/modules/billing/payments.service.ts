import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { Edi835Error, parse835, type Adjustment, type RemitClaim } from './edi/edi-835.js';

const PAYMENT_INCLUDE = {
  payer: { select: { id: true, name: true } },
  ediFile: { select: { id: true, fileName: true, interchangeControlNumber: true } },
  details: {
    orderBy: { claimNumber: 'asc' },
    include: {
      claim: {
        select: {
          id: true,
          status: true,
          patient: { select: { firstName: true, lastName: true } },
        },
      },
    },
  },
} satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

export interface PaymentView {
  id: string;
  status: string;
  payer: { id: string; name: string } | null;
  paymentAmount: number;
  paymentMethod: string | null;
  paymentDate: string | null;
  checkNumber: string | null;
  file: { id: string; fileName: string | null; controlNumber: string | null } | null;
  providerAdjustments: unknown;
  postedAt: Date | null;
  details: {
    id: string;
    claimNumber: string;
    claim: { id: string; status: string; patientName: string } | null;
    statusCode: string;
    chargeAmount: number;
    paidAmount: number;
    adjustmentAmount: number;
    patientResponsibility: number;
    payerClaimNumber: string | null;
    adjustmentReasonCodes: unknown;
    remarkCodes: unknown;
  }[];
  /** Claim numbers in the file that don't match a claim of this agency. */
  unmatched: string[];
  createdAt: Date;
}

const MAX_FILE = 5 * 1024 * 1024;
const money = (n: number) => Math.round(n * 100) / 100;
/** Everything except patient responsibility (PR) is an adjustment to the provider's balance. */
const providerAdjustment = (adjs: Adjustment[]) =>
  money(adjs.filter((a) => a.group !== 'PR').reduce((s, a) => s + a.amount, 0));

/**
 * Payments and 835 remittances (DESIGN.md §10.1, DECISIONS D-054): upload → parse and store (matched to claims by
 * claim number) → review → post (applies amounts to claims and lines; sets paid / partially paid / denied). Posting
 * happens once. The same file can't be loaded twice.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
  ) {}

  async upload835(caller: AuthUser, fileName: string, content: string): Promise<PaymentView> {
    if (Buffer.byteLength(content) > MAX_FILE)
      throw new BadRequestException('The file is larger than 5 MB');
    let remit;
    try {
      remit = parse835(content);
    } catch (error) {
      if (error instanceof Edi835Error) throw new BadRequestException(error.message);
      throw error;
    }
    const hash = createHash('sha256').update(content).digest('hex');
    const [payer, claims] = await Promise.all([
      remit.payer.id
        ? this.prisma.payer.findFirst({
            where: { agencyId: caller.agencyId, payerIdCode: remit.payer.id },
            select: { id: true },
          })
        : null,
      this.prisma.claim.findMany({
        where: {
          agencyId: caller.agencyId,
          claimNumber: { in: remit.claims.map((c) => c.claimNumber) },
        },
        select: { id: true, claimNumber: true },
      }),
    ]);
    const claimIds = new Map(claims.map((c) => [c.claimNumber, c.id]));

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const file = await tx.ediFile.create({
          data: {
            agencyId: caller.agencyId,
            fileType: '835',
            direction: 'inbound',
            fileName: fileName.slice(0, 255),
            content,
            contentHash: hash,
            interchangeControlNumber: remit.controlNumber,
            recordCount: remit.claims.length,
            status: 'parsed',
            processedAt: new Date(),
            uploadedById: caller.userId,
          },
        });
        return tx.payment.create({
          data: {
            agencyId: caller.agencyId,
            payerId: payer?.id ?? null,
            ediFileId: file.id,
            checkNumber: remit.payment.traceNumber,
            paymentDate: toDate(remit.payment.date ?? undefined) ?? null,
            paymentAmount: remit.payment.amount,
            paymentMethod: remit.payment.method || null,
            providerAdjustments: remit.providerAdjustments.length
              ? remit.providerAdjustments
              : Prisma.JsonNull,
            details: {
              create: remit.claims.map((c) => detailData(c, claimIds.get(c.claimNumber) ?? null)),
            },
          },
          include: PAYMENT_INCLUDE,
        });
      });
      return toView(payment);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This file was already loaded');
      }
      throw error;
    }
  }

  async list(caller: AuthUser, query: PaginationQueryDto): Promise<Paginated<PaymentView>> {
    const where = { agencyId: caller.agencyId };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return Paginated.of(rows.map(toView), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<PaymentView> {
    return toView(await this.find(caller, id));
  }

  /** Applies the payment to its matched claims — once. Void claims and unmatched claim numbers are left alone. */
  async post(caller: AuthUser, id: string): Promise<PaymentView> {
    const payment = await this.find(caller, id);
    if (payment.status !== 'received')
      throw new ConflictException('This payment was already posted');
    const today = await this.clock.todayString(caller.agencyId);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id, status: 'received' },
        data: { status: 'posted', postedAt: new Date(), postedById: caller.userId },
      });
      if (!claimed.count) throw new ConflictException('This payment was just posted');

      for (const d of payment.details) {
        if (!d.claimId || d.claim?.status === 'void') continue;
        const claim = await tx.claim.findUniqueOrThrow({
          where: { id: d.claimId },
          include: { lines: { where: { active: true } }, payer: { select: { appealWindowDays: true } } },
        });
        const totalPaid = money(Number(claim.totalPaid) + Number(d.paidAmount));
        const totalAdjustments = money(Number(claim.totalAdjustments) + Number(d.adjustmentAmount));
        const patientResponsibility = money(
          Number(claim.patientResponsibility) + Number(d.patientResponsibility),
        );
        const balance = money(
          Number(claim.totalCharges) - totalPaid - totalAdjustments - patientResponsibility,
        );
        const reasons = (d.adjustmentReasonCodes ?? []) as unknown as Adjustment[];
        const status =
          d.statusCode === '4' || (totalPaid <= 0 && d.statusCode !== '22')
            ? 'denied'
            : d.statusCode === '22'
              ? 'submitted'
              : balance <= 0.005
                ? 'paid'
                : 'partially_paid';
        await tx.claim.update({
          where: { id: claim.id },
          data: {
            totalPaid,
            totalAdjustments,
            patientResponsibility,
            status,
            payerClaimNumber: d.payerClaimNumber ?? claim.payerClaimNumber,
            // A new denial starts the appeal clock (D-063).
            ...(status === 'denied' && claim.status !== 'denied'
              ? { deniedAt: new Date(), appealDeadline: toDate(addDays(today, claim.payer.appealWindowDays)) }
              : {}),
            ...(status === 'denied' && reasons[0]
              ? {
                  denialReasonCode: reasons[0].reason,
                  denialReason: `${reasons[0].group}-${reasons[0].reason}`,
                }
              : {}),
          },
        });
        // Service lines: matched on code, date and modifiers.
        for (const svc of (d.lines ?? []) as unknown as RemitClaim['lines']) {
          const line = claim.lines.find(
            (l) =>
              l.serviceCode === svc.serviceCode &&
              fromDate(l.serviceDate) === svc.serviceDate &&
              (l.modifier1 ?? '') === (svc.modifiers[0] ?? ''),
          );
          if (!line) continue;
          await tx.claimLine.update({
            where: { id: line.id },
            data: {
              paidAmount: money(Number(line.paidAmount) + svc.paidAmount),
              adjustmentAmount: money(
                Number(line.adjustmentAmount) + providerAdjustment(svc.adjustments),
              ),
            },
          });
        }
      }
    });
    return this.get(caller, id);
  }

  private async find(caller: AuthUser, id: string): Promise<PaymentRow> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }
}

function detailData(
  c: RemitClaim,
  claimId: string | null,
): Prisma.PaymentDetailCreateWithoutPaymentInput {
  const lineAdjustments = c.lines.flatMap((l) => l.adjustments);
  const all = [...c.adjustments, ...lineAdjustments];
  return {
    claim: claimId ? { connect: { id: claimId } } : undefined,
    claimNumber: c.claimNumber.slice(0, 38),
    statusCode: c.statusCode.slice(0, 3),
    chargeAmount: c.chargeAmount,
    paidAmount: c.paidAmount,
    adjustmentAmount: providerAdjustment(all),
    patientResponsibility: c.patientResponsibility,
    payerClaimNumber: c.payerClaimNumber,
    adjustmentReasonCodes: all.length ? (all as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    remarkCodes: c.lines.some((l) => l.remarks.length)
      ? [...new Set(c.lines.flatMap((l) => l.remarks))]
      : Prisma.JsonNull,
    lines: c.lines.length ? (c.lines as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
  };
}

function toView(p: PaymentRow): PaymentView {
  return {
    id: p.id,
    status: p.status,
    payer: p.payer,
    paymentAmount: Number(p.paymentAmount),
    paymentMethod: p.paymentMethod,
    paymentDate: fromDate(p.paymentDate),
    checkNumber: p.checkNumber,
    file: p.ediFile
      ? {
          id: p.ediFile.id,
          fileName: p.ediFile.fileName,
          controlNumber: p.ediFile.interchangeControlNumber,
        }
      : null,
    providerAdjustments: p.providerAdjustments,
    postedAt: p.postedAt,
    details: p.details.map((d) => ({
      id: d.id,
      claimNumber: d.claimNumber,
      claim: d.claim
        ? {
            id: d.claim.id,
            status: d.claim.status,
            patientName: `${d.claim.patient.firstName} ${d.claim.patient.lastName}`,
          }
        : null,
      statusCode: d.statusCode,
      chargeAmount: Number(d.chargeAmount),
      paidAmount: Number(d.paidAmount),
      adjustmentAmount: Number(d.adjustmentAmount),
      patientResponsibility: Number(d.patientResponsibility),
      payerClaimNumber: d.payerClaimNumber,
      adjustmentReasonCodes: d.adjustmentReasonCodes,
      remarkCodes: d.remarkCodes,
    })),
    unmatched: p.details.filter((d) => !d.claimId).map((d) => d.claimNumber),
    createdAt: p.createdAt,
  };
}
