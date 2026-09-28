import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import type { AdjustPayStubDto, CreatePayPeriodDto, DecideMileageDto, ListMileageQueryDto, LogMileageDto } from './dto/payroll.dto.js';
import { calculatePay, grossPay, type PayVisit } from './payroll-calc.js';

const num = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const STAFF = { select: { id: true, employeeId: true, discipline: true, user: { select: { id: true, firstName: true, lastName: true } } } } as const;
const STUB_INCLUDE = {
  staffProfile: STAFF,
  lines: { orderBy: [{ serviceDate: 'asc' }, { createdAt: 'asc' }] },
  payPeriod: { select: { id: true, periodStart: true, periodEnd: true, payDate: true, status: true } },
} satisfies Prisma.PayStubInclude;
type StubRow = Prisma.PayStubGetPayload<{ include: typeof STUB_INCLUDE }>;

export interface PayrollWarning {
  staffId: string;
  staffName: string;
  message: string;
}

/**
 * Payroll (DESIGN.md §6.8, DECISIONS D-064). Pay periods are calculated from EVV-verified visits and approved mileage,
 * adjusted (bonus, deductions), approved (staff are told their stub is ready), then exported as CSV for the payroll
 * provider, which withholds taxes. This computes gross earnings only.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── Pay periods ───────────────────────────────────────────────────────────────────────────────────

  async listPeriods(caller: AuthUser, query: PaginationQueryDto) {
    const where = { agencyId: caller.agencyId };
    const [rows, total] = await Promise.all([
      this.prisma.payPeriod.findMany({
        where,
        orderBy: { periodStart: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: { stubs: { select: { grossPay: true, mileageAmount: true } } },
      }),
      this.prisma.payPeriod.count({ where }),
    ]);
    return Paginated.of(
      rows.map((p) => ({
        ...periodView(p),
        staffCount: p.stubs.length,
        totalGross: round(p.stubs.reduce((s, x) => s + num(x.grossPay), 0)),
        totalMileage: round(p.stubs.reduce((s, x) => s + num(x.mileageAmount), 0)),
      })),
      total,
      query,
    );
  }

  async createPeriod(caller: AuthUser, dto: CreatePayPeriodDto) {
    if (dto.periodEnd < dto.periodStart) throw new BadRequestException('The period can’t end before it starts');
    if (dto.periodEnd > addDays(dto.periodStart, 30)) throw new BadRequestException('A pay period can be at most 31 days');
    if (dto.payDate < dto.periodEnd) throw new BadRequestException('Pay day can’t be before the period ends');
    const overlapping = await this.prisma.payPeriod.count({
      where: { agencyId: caller.agencyId, periodStart: { lte: toDate(dto.periodEnd) }, periodEnd: { gte: toDate(dto.periodStart) } },
    });
    if (overlapping) throw new ConflictException('This period overlaps another pay period');
    const row = await this.prisma.payPeriod.create({
      data: { agencyId: caller.agencyId, periodStart: toDate(dto.periodStart)!, periodEnd: toDate(dto.periodEnd)!, payDate: toDate(dto.payDate)! },
    });
    return periodView(row);
  }

  async getPeriod(caller: AuthUser, id: string) {
    const period = await this.findPeriod(caller, id);
    const stubs = await this.prisma.payStub.findMany({ where: { payPeriodId: id }, include: STUB_INCLUDE });
    stubs.sort((a, b) => a.staffProfile.user.lastName.localeCompare(b.staffProfile.user.lastName));
    return { ...periodView(period), stubs: stubs.map(stubView) };
  }

  /**
   * (Re)calculates every stub. Bonuses, deductions and notes entered earlier are kept. Returns warnings for visits that
   * can't be paid yet (EVV not verified) and staff without a pay rate.
   */
  async calculate(caller: AuthUser, id: string) {
    const period = await this.findPeriod(caller, id);
    if (period.status !== 'open' && period.status !== 'calculated') throw new ConflictException(`An ${period.status} pay period can’t be recalculated`);
    const start = fromDate(period.periodStart)!;
    const end = fromDate(period.periodEnd)!;
    const agency = await this.prisma.agency.findUniqueOrThrow({ where: { id: caller.agencyId }, select: { payrollMileageRate: true, workweekStartDay: true } });

    // Visits from 6 days before the period too: they count toward the first workweek's 40 hours (D-064).
    const visits = await this.prisma.visit.findMany({
      where: { agencyId: caller.agencyId, status: 'completed', staffId: { not: null }, scheduledDate: { gte: toDate(addDays(start, -6)), lte: toDate(end) } },
      select: {
        id: true,
        staffId: true,
        scheduledDate: true,
        actualStart: true,
        actualEnd: true,
        patient: { select: { firstName: true, lastName: true } },
        evvRecords: { select: { status: true, clockInTime: true, clockOutTime: true } },
      },
    });
    const mileage = await this.prisma.mileageLog.findMany({
      where: { status: 'approved', travelDate: { gte: toDate(start), lte: toDate(end) }, staffProfile: { agencyId: caller.agencyId } },
      select: { staffProfileId: true, travelDate: true, miles: true },
    });
    const staffIds = [...new Set([...visits.map((v) => v.staffId!), ...mileage.map((m) => m.staffProfileId)])];
    const staff = await this.prisma.staffProfile.findMany({
      where: { id: { in: staffIds }, agencyId: caller.agencyId },
      select: { id: true, hourlyRate: true, perVisitRate: true, overtimeRate: true, mileageRate: true, user: { select: { firstName: true, lastName: true } } },
    });
    const kept = new Map(
      (await this.prisma.payStub.findMany({ where: { payPeriodId: id }, select: { staffProfileId: true, bonusAmount: true, deductions: true, notes: true } })).map((s) => [
        s.staffProfileId,
        s,
      ]),
    );

    const warnings: PayrollWarning[] = [];
    const stubs: Prisma.PayStubCreateInput[] = [];
    for (const s of staff) {
      const name = `${s.user.firstName} ${s.user.lastName}`;
      const mine = visits.filter((v) => v.staffId === s.id);
      const payable: PayVisit[] = [];
      let unverified = 0;
      for (const v of mine) {
        const date = fromDate(v.scheduledDate)!;
        const evv = v.evvRecords.find((e) => e.status === 'verified');
        if (!evv) {
          if (date >= start) unverified++;
          continue;
        }
        const from = evv.clockInTime ?? v.actualStart;
        const to = evv.clockOutTime ?? v.actualEnd;
        if (!from || !to) continue;
        payable.push({
          visitId: v.id,
          date,
          startedAt: from.toISOString(),
          minutes: Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000)),
          patientLabel: `${v.patient.firstName} ${v.patient.lastName.charAt(0)}.`,
          inPeriod: date >= start,
        });
      }
      if (unverified) warnings.push({ staffId: s.id, staffName: name, message: `${unverified} completed visit(s) not paid yet — EVV isn't verified` });
      const pay = calculatePay({
        rates: { hourlyRate: s.hourlyRate === null ? null : num(s.hourlyRate), perVisitRate: s.perVisitRate === null ? null : num(s.perVisitRate), overtimeRate: s.overtimeRate === null ? null : num(s.overtimeRate) },
        visits: payable,
        mileage: mileage.filter((m) => m.staffProfileId === s.id).map((m) => ({ date: fromDate(m.travelDate)!, miles: num(m.miles) })),
        mileageRate: s.mileageRate === null ? num(agency.payrollMileageRate) : num(s.mileageRate),
        workweekStartDay: agency.workweekStartDay,
      });
      if (pay.basis === 'none' && pay.visitCount) warnings.push({ staffId: s.id, staffName: name, message: 'No hourly or per-visit rate — visits not paid (set it in Staff)' });
      // Nothing to pay (no visits, or no rate — warned above) and no mileage: no stub.
      if ((!pay.visitCount || pay.basis === 'none') && !pay.mileageMiles) continue;
      const previous = kept.get(s.id);
      const bonusAmount = num(previous?.bonusAmount);
      const deductions = num(previous?.deductions);
      stubs.push({
        payPeriod: { connect: { id } },
        staffProfile: { connect: { id: s.id } },
        regularHours: pay.regularHours,
        overtimeHours: pay.overtimeHours,
        visitCount: pay.visitCount,
        regularPay: pay.regularPay,
        overtimePay: pay.overtimePay,
        perVisitPay: pay.perVisitPay,
        mileageMiles: pay.mileageMiles,
        mileageAmount: pay.mileageAmount,
        bonusAmount,
        deductions,
        grossPay: grossPay({ ...pay, bonusAmount, deductions }),
        notes: previous?.notes ?? null,
        lines: {
          create: pay.lines.map((l) => ({
            visitId: l.visitId,
            serviceDate: toDate(l.date)!,
            patientLabel: l.patientLabel,
            hours: l.hours,
            rate: l.rate,
            amount: l.amount,
            payType: l.payType,
          })),
        },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.payPeriod.updateMany({
        where: { id, status: { in: ['open', 'calculated'] } },
        data: { status: 'calculated', calculatedAt: new Date() },
      });
      if (!locked.count) throw new ConflictException('The pay period changed meanwhile — reload and try again');
      await tx.payStub.deleteMany({ where: { payPeriodId: id } });
      for (const data of stubs) await tx.payStub.create({ data });
    });
    return { ...(await this.getPeriod(caller, id)), warnings };
  }

  async adjustStub(caller: AuthUser, stubId: string, dto: AdjustPayStubDto) {
    const stub = await this.findStub(caller, stubId);
    if (stub.payPeriod.status !== 'calculated') throw new ConflictException('Only stubs of a calculated, not yet approved period can be adjusted');
    const bonusAmount = dto.bonusAmount ?? num(stub.bonusAmount);
    const deductions = dto.deductions ?? num(stub.deductions);
    const gross = grossPay({ regularPay: num(stub.regularPay), overtimePay: num(stub.overtimePay), perVisitPay: num(stub.perVisitPay), bonusAmount, deductions });
    if (gross < 0) throw new BadRequestException('Deductions can’t be more than the earnings');
    await this.prisma.payStub.update({
      where: { id: stubId },
      data: { bonusAmount, deductions, grossPay: gross, ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}) },
    });
    return stubView(await this.findStub(caller, stubId));
  }

  /** Locks the period and tells each staff member their stub is ready. */
  async approve(caller: AuthUser, id: string) {
    await this.findPeriod(caller, id);
    const done = await this.prisma.payPeriod.updateMany({
      where: { id, agencyId: caller.agencyId, status: 'calculated' },
      data: { status: 'approved', approvedAt: new Date(), approvedById: caller.userId },
    });
    if (!done.count) throw new ConflictException('Only a calculated pay period can be approved');
    const stubs = await this.prisma.payStub.findMany({ where: { payPeriodId: id }, select: { id: true, staffProfile: { select: { userId: true } } } });
    for (const s of stubs) {
      await this.notifications.notify({
        agencyId: caller.agencyId,
        userIds: [s.staffProfile.userId],
        type: 'payroll_ready',
        title: 'Your pay stub is ready',
        body: 'Open My pay to see the details.',
        data: { payStubId: s.id },
        actorUserId: caller.userId,
      });
    }
    return this.getPeriod(caller, id);
  }

  /**
   * CSV for the payroll provider (one row per staff member). Taxable earnings and the non-taxable mileage
   * reimbursement are separate columns. Exporting again is allowed (e.g. a lost file) and recorded in the audit log.
   */
  async exportCsv(caller: AuthUser, id: string): Promise<{ fileName: string; content: string }> {
    const period = await this.findPeriod(caller, id);
    if (period.status !== 'approved' && period.status !== 'exported') throw new ConflictException('Approve the pay period before exporting it');
    const { stubs } = await this.getPeriod(caller, id);
    const header = [
      'employee_id', 'last_name', 'first_name', 'discipline', 'regular_hours', 'overtime_hours', 'visits',
      'regular_pay', 'overtime_pay', 'per_visit_pay', 'bonus', 'deductions', 'gross_pay', 'mileage_miles', 'mileage_reimbursement',
    ];
    const csv = (v: string | number | null) => {
      const text = v === null ? '' : String(v);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const rows = stubs.map((s) => [
      s.staff.employeeId, s.staff.lastName, s.staff.firstName, s.staff.discipline, s.regularHours.toFixed(2), s.overtimeHours.toFixed(2), s.visitCount,
      s.regularPay.toFixed(2), s.overtimePay.toFixed(2), s.perVisitPay.toFixed(2), s.bonusAmount.toFixed(2), s.deductions.toFixed(2), s.grossPay.toFixed(2),
      s.mileageMiles.toFixed(2), s.mileageAmount.toFixed(2),
    ]);
    await this.prisma.payPeriod.update({ where: { id }, data: { status: 'exported', exportedAt: new Date() } });
    return {
      fileName: `payroll-${fromDate(period.periodStart)}-to-${fromDate(period.periodEnd)}.csv`,
      content: [header, ...rows].map((r) => r.map(csv).join(',')).join('\r\n') + '\r\n',
    };
  }

  // ── Stubs for staff ───────────────────────────────────────────────────────────────────────────────

  /** The caller's own stubs from approved periods. */
  async myStubs(caller: AuthUser) {
    const profile = await this.prisma.staffProfile.findFirst({ where: { userId: caller.userId, agencyId: caller.agencyId }, select: { id: true } });
    if (!profile) return [];
    const rows = await this.prisma.payStub.findMany({
      where: { staffProfileId: profile.id, payPeriod: { status: { in: ['approved', 'exported'] } } },
      include: STUB_INCLUDE,
      orderBy: { payPeriod: { periodStart: 'desc' } },
      take: 52,
    });
    return rows.map(stubView);
  }

  /** Payroll staff see any stub; staff see their own once approved. */
  async getStub(caller: AuthUser, stubId: string) {
    const stub = await this.findStub(caller, stubId);
    const access = await this.permissions.forUser(caller);
    if (!access.permissions.has('payroll:read')) {
      const own = stub.staffProfile.user.id === caller.userId && ['approved', 'exported'].includes(stub.payPeriod.status);
      if (!own) throw new NotFoundException('Pay stub not found');
    }
    return stubView(stub);
  }

  // ── Mileage ───────────────────────────────────────────────────────────────────────────────────────

  async logMileage(caller: AuthUser, dto: LogMileageDto) {
    const today = await this.clock.todayString(caller.agencyId);
    if (dto.travelDate > today) throw new BadRequestException('The travel date can’t be in the future');
    let staffId = dto.staffId;
    if (staffId) {
      const access = await this.permissions.forUser(caller);
      const found = await this.prisma.staffProfile.findFirst({ where: { id: staffId, agencyId: caller.agencyId }, select: { userId: true } });
      if (!found) throw new BadRequestException('staffId does not match a staff member in this agency');
      if (found.userId !== caller.userId && !access.permissions.has('payroll:update')) throw new ForbiddenException('You can only log your own mileage');
    } else {
      const own = await this.prisma.staffProfile.findFirst({ where: { userId: caller.userId, agencyId: caller.agencyId }, select: { id: true } });
      if (!own) throw new BadRequestException('Only staff members can log mileage');
      staffId = own.id;
    }
    if (dto.visitId) {
      const visit = await this.prisma.visit.count({ where: { id: dto.visitId, agencyId: caller.agencyId, staffId } });
      if (!visit) throw new BadRequestException('visitId does not match one of this staff member’s visits');
    }
    const row = await this.prisma.mileageLog.create({
      data: { staffProfileId: staffId, travelDate: toDate(dto.travelDate)!, miles: dto.miles, description: dto.description ?? null, visitId: dto.visitId ?? null },
      include: { staffProfile: STAFF },
    });
    return mileageView(row);
  }

  /** Payroll staff see everyone's; others see their own. */
  async listMileage(caller: AuthUser, query: ListMileageQueryDto) {
    const access = await this.permissions.forUser(caller);
    const where: Prisma.MileageLogWhereInput = {
      staffProfile: { agencyId: caller.agencyId, ...(access.permissions.has('payroll:read') ? {} : { userId: caller.userId }) },
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.mileageLog.findMany({ where, include: { staffProfile: STAFF }, orderBy: [{ travelDate: 'desc' }, { createdAt: 'desc' }], skip: query.skip, take: query.limit }),
      this.prisma.mileageLog.count({ where }),
    ]);
    return Paginated.of(rows.map(mileageView), total, query);
  }

  async decideMileage(caller: AuthUser, id: string, dto: DecideMileageDto) {
    const log = await this.prisma.mileageLog.findFirst({ where: { id, staffProfile: { agencyId: caller.agencyId } }, select: { status: true } });
    if (!log) throw new NotFoundException('Mileage entry not found');
    if (dto.decision === 'rejected' && !dto.reason) throw new BadRequestException('Say why the mileage is rejected');
    const done = await this.prisma.mileageLog.updateMany({
      where: { id, status: 'pending' },
      data: { status: dto.decision, decidedById: caller.userId, decidedAt: new Date(), rejectReason: dto.decision === 'rejected' ? dto.reason! : null },
    });
    if (!done.count) throw new ConflictException('This mileage entry was already decided');
    const row = await this.prisma.mileageLog.findUniqueOrThrow({ where: { id }, include: { staffProfile: STAFF } });
    return mileageView(row);
  }

  private async findPeriod(caller: AuthUser, id: string) {
    const row = await this.prisma.payPeriod.findFirst({ where: { id, agencyId: caller.agencyId } });
    if (!row) throw new NotFoundException('Pay period not found');
    return row;
  }

  private async findStub(caller: AuthUser, id: string): Promise<StubRow> {
    const row = await this.prisma.payStub.findFirst({ where: { id, payPeriod: { agencyId: caller.agencyId } }, include: STUB_INCLUDE });
    if (!row) throw new NotFoundException('Pay stub not found');
    return row;
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

function periodView(p: Prisma.PayPeriodGetPayload<object>) {
  return {
    id: p.id,
    periodStart: fromDate(p.periodStart)!,
    periodEnd: fromDate(p.periodEnd)!,
    payDate: fromDate(p.payDate)!,
    status: p.status,
    calculatedAt: p.calculatedAt,
    approvedAt: p.approvedAt,
    exportedAt: p.exportedAt,
  };
}

function stubView(s: StubRow) {
  return {
    id: s.id,
    payPeriod: { id: s.payPeriod.id, periodStart: fromDate(s.payPeriod.periodStart)!, periodEnd: fromDate(s.payPeriod.periodEnd)!, payDate: fromDate(s.payPeriod.payDate)!, status: s.payPeriod.status },
    staff: {
      id: s.staffProfile.id,
      userId: s.staffProfile.user.id,
      firstName: s.staffProfile.user.firstName,
      lastName: s.staffProfile.user.lastName,
      employeeId: s.staffProfile.employeeId,
      discipline: s.staffProfile.discipline,
    },
    regularHours: num(s.regularHours),
    overtimeHours: num(s.overtimeHours),
    visitCount: s.visitCount,
    regularPay: num(s.regularPay),
    overtimePay: num(s.overtimePay),
    perVisitPay: num(s.perVisitPay),
    mileageMiles: num(s.mileageMiles),
    mileageAmount: num(s.mileageAmount),
    bonusAmount: num(s.bonusAmount),
    deductions: num(s.deductions),
    grossPay: num(s.grossPay),
    notes: s.notes,
    lines: s.lines.map((l) => ({
      id: l.id,
      visitId: l.visitId,
      serviceDate: fromDate(l.serviceDate)!,
      patientLabel: l.patientLabel,
      hours: l.hours === null ? null : num(l.hours),
      rate: l.rate === null ? null : num(l.rate),
      amount: num(l.amount),
      payType: l.payType,
    })),
  };
}

function mileageView(m: Prisma.MileageLogGetPayload<{ include: { staffProfile: typeof STAFF } }>) {
  return {
    id: m.id,
    staff: { id: m.staffProfile.id, firstName: m.staffProfile.user.firstName, lastName: m.staffProfile.user.lastName },
    travelDate: fromDate(m.travelDate)!,
    miles: num(m.miles),
    description: m.description,
    visitId: m.visitId,
    status: m.status,
    rejectReason: m.rejectReason,
    decidedAt: m.decidedAt,
  };
}
