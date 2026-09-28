import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Paginated } from '../../common/dto/pagination.dto.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BillingReadinessService, type BillableVisit } from './billing-readiness.service.js';
import type { CreateInvoicesDto, ListInvoicesQueryDto, RecordInvoicePaymentDto } from './dto/invoices.dto.js';
import { renderInvoicePdf } from './invoice-pdf.js';

/** Days from issue to due date. An agency setting can come later. */
export const INVOICE_TERMS_DAYS = 30;
const money = (n: number) => Math.round(n * 100) / 100;

const INVOICE_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
  payer: { select: { id: true, name: true } },
  lines: { orderBy: { lineNumber: 'asc' } },
  payments: {
    orderBy: { paidOn: 'asc' },
    include: { recordedBy: { select: { id: true, firstName: true, lastName: true } } },
  },
} satisfies Prisma.InvoiceInclude;
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  status: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  payer: { id: string; name: string };
  issueDate: string;
  dueDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  /** Sent and unpaid past the due date. */
  overdue: boolean;
  billTo: { name: string; addressLines: string[] };
  sentAt: Date | null;
  paidAt: Date | null;
  voidReason: string | null;
  notes: string | null;
  lines: { id: string; visitId: string | null; serviceDate: string; serviceCode: string | null; description: string; quantity: number; unitRate: number; total: number }[];
  payments: { id: string; amount: number; paidOn: string; method: string; reference: string | null; recordedBy: { id: string; firstName: string; lastName: string } }[];
  createdAt: Date;
}

export interface CreateInvoicesResult {
  created: InvoiceView[];
  skipped: { visitId: string; reasons: string[] }[];
}

/**
 * Private-pay invoices (DESIGN.md §10, DECISIONS D-059). Made from completed visits of patients whose primary payer
 * is private pay and that pass the same pre-billing checks as claims; one invoice per patient per run, amounts frozen.
 * A visit is on at most one active invoice (database-enforced) and never on both a claim and an invoice.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly readiness: BillingReadinessService,
  ) {}

  async list(caller: AuthUser, query: ListInvoicesQueryDto): Promise<Paginated<InvoiceView>> {
    const where: Prisma.InvoiceWhereInput = {
      agencyId: caller.agencyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
    };
    const today = await this.clock.todayString(caller.agencyId);
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({ where, include: INVOICE_INCLUDE, orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.limit }),
      this.prisma.invoice.count({ where }),
    ]);
    return Paginated.of(rows.map((r) => toView(r, today)), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<InvoiceView> {
    return toView(await this.find(caller, id), await this.clock.todayString(caller.agencyId));
  }

  async create(caller: AuthUser, dto: CreateInvoicesDto): Promise<CreateInvoicesResult> {
    if (dto.to < dto.from) throw new BadRequestException('to cannot be before from');
    if (dto.to > addDays(dto.from, 92)) throw new BadRequestException('The range can be at most 92 days');
    const visits = await this.prisma.visit.findMany({
      where: {
        agencyId: caller.agencyId,
        status: 'completed',
        scheduledDate: { gte: toDate(dto.from), lte: toDate(dto.to) },
        claimLines: { none: { active: true } },
        invoiceLines: { none: { active: true } },
        patient: { payerPrimary: { payerType: 'private_pay' }, ...(dto.patientId ? { id: dto.patientId } : {}) },
      },
      select: { id: true },
      take: 2000,
    });
    if (!visits.length) return { created: [], skipped: [] };

    const evaluated = await this.readiness.evaluateVisits(caller.agencyId, visits.map((v) => v.id));
    const skipped = evaluated
      .filter((v) => !v.ready)
      .map((v) => ({ visitId: v.visitId, reasons: v.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.message) }));
    const byPatient = new Map<string, BillableVisit[]>();
    for (const v of evaluated.filter((e) => e.ready)) byPatient.set(v.patient.id, [...(byPatient.get(v.patient.id) ?? []), v]);

    const today = await this.clock.todayString(caller.agencyId);
    const descriptions = await this.codeDescriptions(caller.agencyId);
    const created: InvoiceView[] = [];
    for (const group of byPatient.values()) {
      try {
        created.push(toView(await this.createOne(caller, group, today, descriptions, dto.notes), today));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && `${JSON.stringify(error.meta ?? {})} ${error.message}`.includes('visit')) {
          skipped.push(...group.map((v) => ({ visitId: v.visitId, reasons: ['Billed on another invoice just now'] })));
          continue;
        }
        throw error;
      }
    }
    return { created, skipped };
  }

  /** The invoice as a PDF (made on request, never stored). */
  async pdf(caller: AuthUser, id: string): Promise<{ fileName: string; content: Buffer }> {
    const inv = await this.find(caller, id);
    const agency = await this.prisma.agency.findUniqueOrThrow({
      where: { id: caller.agencyId },
      select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, zip: true, phone: true, email: true, taxId: true },
    });
    const view = toView(inv, await this.clock.todayString(caller.agencyId));
    const content = await renderInvoicePdf({
      agency: {
        name: agency.name,
        addressLines: addressLines(agency),
        phone: agency.phone,
        email: agency.email,
        taxId: agency.taxId,
      },
      invoiceNumber: view.invoiceNumber,
      issueDate: view.issueDate,
      dueDate: view.dueDate,
      periodStart: view.billingPeriodStart,
      periodEnd: view.billingPeriodEnd,
      billTo: view.billTo,
      patientName: `${view.patient.firstName} ${view.patient.lastName}`,
      lines: view.lines,
      subtotal: view.subtotal,
      tax: view.taxAmount,
      total: view.totalAmount,
      paid: view.paidAmount,
      balance: view.balanceDue,
      status: view.status,
      notes: view.notes,
    });
    return { fileName: `${view.invoiceNumber}.pdf`, content };
  }

  /** Marks a draft as sent (printed, mailed, or handed over — emailing waits for an email provider). */
  async markSent(caller: AuthUser, id: string): Promise<InvoiceView> {
    await this.find(caller, id);
    const updated = await this.prisma.invoice.updateMany({ where: { id, status: 'draft' }, data: { status: 'sent', sentAt: new Date() } });
    if (!updated.count) throw new ConflictException('Only a draft invoice can be marked as sent');
    return this.get(caller, id);
  }

  async recordPayment(caller: AuthUser, id: string, dto: RecordInvoicePaymentDto): Promise<InvoiceView> {
    const inv = await this.find(caller, id);
    if (!['sent', 'partially_paid'].includes(inv.status)) {
      throw new ConflictException(inv.status === 'draft' ? 'Mark the invoice as sent first' : `A ${inv.status} invoice can't take payments`);
    }
    const paid = Number(inv.paidAmount);
    const balance = money(Number(inv.totalAmount) - paid);
    if (dto.amount > balance + 0.001) throw new BadRequestException(`That is more than the balance due ($${balance.toFixed(2)})`);
    const newPaid = money(paid + dto.amount);
    const fullyPaid = newPaid >= Number(inv.totalAmount) - 0.001;
    await this.prisma.$transaction(async (tx) => {
      // Guarded: a payment recorded meanwhile changes paid_amount → this one is refused, not double-counted.
      const updated = await tx.invoice.updateMany({
        where: { id, paidAmount: inv.paidAmount, status: { in: ['sent', 'partially_paid'] } },
        data: { paidAmount: newPaid, status: fullyPaid ? 'paid' : 'partially_paid', paidAt: fullyPaid ? new Date() : null },
      });
      if (!updated.count) throw new ConflictException('The invoice changed meanwhile — reload and try again');
      await tx.invoicePayment.create({
        data: { invoiceId: id, amount: dto.amount, paidOn: toDate(dto.paidOn)!, method: dto.method, reference: dto.reference ?? null, recordedById: caller.userId },
      });
    });
    return this.get(caller, id);
  }

  /** Voids an invoice with no payments; its visits can be billed again. */
  async void(caller: AuthUser, id: string, reason: string): Promise<InvoiceView> {
    const inv = await this.find(caller, id);
    if (inv.status === 'void') throw new ConflictException('Already void');
    if (Number(inv.paidAmount) > 0) throw new ConflictException('This invoice has payments — it can’t be voided');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: { id, status: { not: 'void' }, paidAmount: 0 },
        data: { status: 'void', voidReason: reason },
      });
      if (!updated.count) throw new ConflictException('The invoice changed meanwhile — reload and try again');
      await tx.invoiceLine.updateMany({ where: { invoiceId: id }, data: { active: false } });
    });
    return this.get(caller, id);
  }

  private async createOne(
    caller: AuthUser,
    visits: BillableVisit[],
    today: string,
    descriptions: Map<string, string>,
    notes?: string,
  ): Promise<InvoiceRow> {
    const first = visits[0]!;
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: first.patient.id },
      select: { firstName: true, lastName: true, addressLine1: true, addressLine2: true, city: true, state: true, zip: true },
    });
    const sorted = [...visits].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
    const subtotal = money(sorted.reduce((sum, v) => sum + (v.amount ?? 0), 0));
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.invoice.create({
          data: {
            agencyId: caller.agencyId,
            patientId: first.patient.id,
            payerId: first.payer!.id,
            invoiceNumber: await this.nextNumber(caller.agencyId),
            issueDate: toDate(today)!,
            dueDate: toDate(addDays(today, INVOICE_TERMS_DAYS))!,
            billingPeriodStart: toDate(sorted[0]!.serviceDate)!,
            billingPeriodEnd: toDate(sorted[sorted.length - 1]!.serviceDate)!,
            subtotal,
            totalAmount: subtotal,
            billTo: { name: `${patient.firstName} ${patient.lastName}`, addressLines: addressLines(patient) },
            notes: notes || null,
            createdById: caller.userId,
            lines: {
              create: sorted.map((v, i) => ({
                visitId: v.visitId,
                lineNumber: i + 1,
                serviceCode: v.serviceCode,
                description: `${descriptions.get(v.serviceCode ?? '') ?? v.serviceCode ?? 'Home care visit'}${v.staff ? ` (${v.staff.firstName})` : ''}`,
                serviceDate: toDate(v.serviceDate)!,
                quantity: v.units!,
                unitRate: v.rate!,
                total: v.amount!,
              })),
            },
          },
          include: INVOICE_INCLUDE,
        });
      } catch (error) {
        // Two invoices numbered at once: take the next number. A visit invoiced meanwhile bubbles up.
        const target = error instanceof Prisma.PrismaClientKnownRequestError ? `${JSON.stringify(error.meta ?? {})} ${error.message}` : '';
        if (attempt < 5 && target.includes('invoice_number')) continue;
        throw error;
      }
    }
  }

  /** INV-000001, INV-000002, … per agency. */
  private async nextNumber(agencyId: string): Promise<string> {
    const last = await this.prisma.invoice.findFirst({
      where: { agencyId, invoiceNumber: { startsWith: 'INV-' } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });
    const n = last ? Number(last.invoiceNumber.slice(4)) + 1 : 1;
    return `INV-${String(n).padStart(6, '0')}`;
  }

  private async codeDescriptions(agencyId: string): Promise<Map<string, string>> {
    const codes = await this.prisma.serviceCode.findMany({ where: { agencyId }, select: { code: true, description: true } });
    return new Map(codes.filter((c) => c.description).map((c) => [c.code, c.description!]));
  }

  private async find(caller: AuthUser, id: string): Promise<InvoiceRow> {
    const inv = await this.prisma.invoice.findFirst({ where: { id, agencyId: caller.agencyId }, include: INVOICE_INCLUDE });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }
}

function addressLines(a: { addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; zip: string | null }): string[] {
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.addressLine1, a.addressLine2, cityLine].filter((l): l is string => Boolean(l));
}

function toView(r: InvoiceRow, today: string): InvoiceView {
  const total = Number(r.totalAmount);
  const paid = Number(r.paidAmount);
  const dueDate = fromDate(r.dueDate)!;
  const balance = r.status === 'void' ? 0 : money(total - paid);
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    status: r.status,
    patient: r.patient,
    payer: r.payer,
    issueDate: fromDate(r.issueDate)!,
    dueDate,
    billingPeriodStart: fromDate(r.billingPeriodStart)!,
    billingPeriodEnd: fromDate(r.billingPeriodEnd)!,
    subtotal: Number(r.subtotal),
    taxAmount: Number(r.taxAmount),
    totalAmount: total,
    paidAmount: paid,
    balanceDue: balance,
    overdue: ['sent', 'partially_paid'].includes(r.status) && dueDate < today && balance > 0,
    billTo: r.billTo as InvoiceView['billTo'],
    sentAt: r.sentAt,
    paidAt: r.paidAt,
    voidReason: r.voidReason,
    notes: r.notes,
    lines: r.lines.map((l) => ({
      id: l.id,
      visitId: l.visitId,
      serviceDate: fromDate(l.serviceDate)!,
      serviceCode: l.serviceCode,
      description: l.description,
      quantity: Number(l.quantity),
      unitRate: Number(l.unitRate),
      total: Number(l.total),
    })),
    payments: r.payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      paidOn: fromDate(p.paidOn)!,
      method: p.method,
      reference: p.reference,
      recordedBy: p.recordedBy,
    })),
    createdAt: r.createdAt,
  };
}
