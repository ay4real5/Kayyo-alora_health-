import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  EndPayerRateDto,
  ListActiveQueryDto,
  PayerDto,
  PayerRateDto,
  ServiceCodeDto,
  UpdatePayerDto,
  UpdateServiceCodeDto,
} from './dto/billing-setup.dto.js';

const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

export interface PayerView {
  id: string;
  name: string;
  payerType: string;
  payerIdCode: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  timelyFilingDays: number;
  requiresAuthorization: boolean;
  isActive: boolean;
}

export interface ServiceCodeView {
  id: string;
  code: string;
  codeType: string;
  description: string | null;
  defaultRate: number | null;
  unitType: string;
  requiresAuth: boolean;
  isActive: boolean;
}

export interface PayerRateView {
  id: string;
  payerId: string;
  serviceCode: { id: string; code: string; unitType: string };
  rate: number;
  effectiveDate: string;
  endDate: string | null;
  modifier1: string | null;
  modifier2: string | null;
}

/**
 * Billing setup (DESIGN.md §6.8, DECISIONS D-050): payers, service codes and payer rate schedules. Rates for the same
 * payer, code and modifiers never overlap, so "the rate on a date" always has one answer.
 */
@Injectable()
export class BillingSetupService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Payers ─────────────────────────────────────────────────────────────────────────────────────────

  async listPayers(caller: AuthUser, query: ListActiveQueryDto): Promise<Paginated<PayerView>> {
    const where: Prisma.PayerWhereInput = {
      agencyId: caller.agencyId,
      isActive: query.isActive ?? true,
    };
    const [rows, total] = await Promise.all([
      this.prisma.payer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.payer.count({ where }),
    ]);
    return Paginated.of(rows.map(toPayerView), total, query);
  }

  async getPayer(caller: AuthUser, id: string): Promise<PayerView> {
    return toPayerView(await this.payer(caller, id));
  }

  async createPayer(caller: AuthUser, dto: PayerDto): Promise<PayerView> {
    return toPayerView(
      await this.prisma.payer.create({ data: { agencyId: caller.agencyId, ...dto } }),
    );
  }

  async updatePayer(caller: AuthUser, id: string, dto: UpdatePayerDto): Promise<PayerView> {
    await this.payer(caller, id);
    return toPayerView(await this.prisma.payer.update({ where: { id }, data: dto }));
  }

  // ── Service codes ──────────────────────────────────────────────────────────────────────────────────

  async listServiceCodes(
    caller: AuthUser,
    query: ListActiveQueryDto,
  ): Promise<Paginated<ServiceCodeView>> {
    const where: Prisma.ServiceCodeWhereInput = {
      agencyId: caller.agencyId,
      isActive: query.isActive ?? true,
    };
    const [rows, total] = await Promise.all([
      this.prisma.serviceCode.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.serviceCode.count({ where }),
    ]);
    return Paginated.of(rows.map(toCodeView), total, query);
  }

  /** Duplicate code + type in the agency → 409 (unique index). */
  async createServiceCode(caller: AuthUser, dto: ServiceCodeDto): Promise<ServiceCodeView> {
    return toCodeView(
      await this.prisma.serviceCode.create({ data: { agencyId: caller.agencyId, ...dto } }),
    );
  }

  async updateServiceCode(
    caller: AuthUser,
    id: string,
    dto: UpdateServiceCodeDto,
  ): Promise<ServiceCodeView> {
    const found = await this.prisma.serviceCode.count({ where: { id, agencyId: caller.agencyId } });
    if (!found) throw new NotFoundException('Service code not found');
    return toCodeView(await this.prisma.serviceCode.update({ where: { id }, data: dto }));
  }

  // ── Rates ──────────────────────────────────────────────────────────────────────────────────────────

  async listRates(caller: AuthUser, payerId: string): Promise<PayerRateView[]> {
    await this.payer(caller, payerId);
    const rows = await this.prisma.payerRate.findMany({
      where: { payerId },
      include: { serviceCode: { select: { id: true, code: true, unitType: true } } },
      orderBy: [{ serviceCode: { code: 'asc' } }, { effectiveDate: 'desc' }],
    });
    return rows.map(toRateView);
  }

  async createRate(caller: AuthUser, payerId: string, dto: PayerRateDto): Promise<PayerRateView> {
    await this.payer(caller, payerId);
    const code = await this.prisma.serviceCode.count({
      where: { id: dto.serviceCodeId, agencyId: caller.agencyId },
    });
    if (!code)
      throw new BadRequestException('serviceCodeId does not match a service code in this agency');
    if (dto.endDate && dto.endDate < dto.effectiveDate)
      throw new BadRequestException('endDate cannot be before effectiveDate');
    await this.assertNoOverlap(
      payerId,
      dto.serviceCodeId,
      dto.modifier1 ?? null,
      dto.modifier2 ?? null,
      dto.effectiveDate,
      dto.endDate ?? null,
    );
    const rate = await this.prisma.payerRate.create({
      data: {
        payerId,
        serviceCodeId: dto.serviceCodeId,
        rate: dto.rate,
        effectiveDate: toDate(dto.effectiveDate)!,
        endDate: toDate(dto.endDate) ?? null,
        modifier1: dto.modifier1 ?? null,
        modifier2: dto.modifier2 ?? null,
      },
      include: { serviceCode: { select: { id: true, code: true, unitType: true } } },
    });
    return toRateView(rate);
  }

  /** Rates are history: they're ended, not edited, so claims already billed keep their rate. */
  async endRate(caller: AuthUser, rateId: string, dto: EndPayerRateDto): Promise<PayerRateView> {
    const rate = await this.prisma.payerRate.findFirst({
      where: { id: rateId, payer: { agencyId: caller.agencyId } },
    });
    if (!rate) throw new NotFoundException('Rate not found');
    if (dto.endDate < fromDate(rate.effectiveDate)!)
      throw new BadRequestException('endDate cannot be before the effective date');
    if (rate.endDate && dto.endDate > fromDate(rate.endDate)!) {
      throw new BadRequestException(
        'A rate can be ended earlier, not extended — add a new rate instead',
      );
    }
    const updated = await this.prisma.payerRate.update({
      where: { id: rateId },
      data: { endDate: toDate(dto.endDate)! },
      include: { serviceCode: { select: { id: true, code: true, unitType: true } } },
    });
    return toRateView(updated);
  }

  /** The rate a payer pays for a code on a date (for claims, P3-03); null if none is set. */
  async rateOn(
    payerId: string,
    serviceCodeId: string,
    date: string,
    modifier1: string | null = null,
  ): Promise<number | null> {
    const rate = await this.prisma.payerRate.findFirst({
      where: {
        payerId,
        serviceCodeId,
        modifier1,
        effectiveDate: { lte: toDate(date) },
        OR: [{ endDate: null }, { endDate: { gte: toDate(date) } }],
      },
    });
    return rate ? Number(rate.rate) : null;
  }

  private async assertNoOverlap(
    payerId: string,
    serviceCodeId: string,
    modifier1: string | null,
    modifier2: string | null,
    start: string,
    end: string | null,
  ): Promise<void> {
    const clash = await this.prisma.payerRate.findFirst({
      where: {
        payerId,
        serviceCodeId,
        modifier1,
        modifier2,
        // Existing [s, e] overlaps new [start, end] when s <= end and (e is open or e >= start).
        ...(end ? { effectiveDate: { lte: toDate(end) } } : {}),
        OR: [{ endDate: null }, { endDate: { gte: toDate(start) } }],
      },
    });
    if (clash) {
      const openEnded = !clash.endDate;
      throw new ConflictException(
        openEnded
          ? `A rate from ${fromDate(clash.effectiveDate)} is still open — end it (e.g. on ${addDays(start, -1)}) before adding this one`
          : `This overlaps the rate from ${fromDate(clash.effectiveDate)} to ${fromDate(clash.endDate)}`,
      );
    }
  }

  private async payer(caller: AuthUser, id: string) {
    const payer = await this.prisma.payer.findFirst({ where: { id, agencyId: caller.agencyId } });
    if (!payer) throw new NotFoundException('Payer not found');
    return payer;
  }
}

function toPayerView(p: Prisma.PayerGetPayload<object>): PayerView {
  return {
    id: p.id,
    name: p.name,
    payerType: p.payerType,
    payerIdCode: p.payerIdCode,
    addressLine1: p.addressLine1,
    city: p.city,
    state: p.state,
    zip: p.zip,
    phone: p.phone,
    timelyFilingDays: p.timelyFilingDays,
    requiresAuthorization: p.requiresAuthorization,
    isActive: p.isActive,
  };
}

function toCodeView(c: Prisma.ServiceCodeGetPayload<object>): ServiceCodeView {
  return {
    id: c.id,
    code: c.code,
    codeType: c.codeType,
    description: c.description,
    defaultRate: num(c.defaultRate),
    unitType: c.unitType,
    requiresAuth: c.requiresAuth,
    isActive: c.isActive,
  };
}

function toRateView(
  r: Prisma.PayerRateGetPayload<{
    include: { serviceCode: { select: { id: true; code: true; unitType: true } } };
  }>,
): PayerRateView {
  return {
    id: r.id,
    payerId: r.payerId,
    serviceCode: r.serviceCode,
    rate: Number(r.rate),
    effectiveDate: fromDate(r.effectiveDate)!,
    endDate: fromDate(r.endDate),
    modifier1: r.modifier1,
    modifier2: r.modifier2,
  };
}
