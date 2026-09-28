import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizationDto, UpdateAuthorizationDto } from './dto/billing-setup.dto.js';

/** Visits that count against an authorization: done, happening, or booked. */
const COUNTED = ['scheduled', 'in_progress', 'completed'];
const EXPIRING_DAYS = 14;

type AuthRow = Prisma.AuthorizationGetPayload<{
  include: { payer: { select: { id: true; name: true } } };
}>;

interface Amounts {
  visits: number;
  hours: number;
}

export interface AuthorizationView {
  id: string;
  payer: { id: string; name: string };
  authorizationNumber: string | null;
  serviceCode: string | null;
  startDate: string;
  endDate: string;
  authorizedVisits: number | null;
  authorizedHours: number | null;
  status: string;
  /** active | upcoming | expired | exhausted | cancelled — as of the agency's today. */
  state: string;
  expiringSoon: boolean;
  /** Completed or in-progress visits. */
  used: Amounts;
  /** Booked but not yet done. */
  planned: Amounts;
  /** Authorized minus used minus planned (null where that limit isn't set). */
  remaining: { visits: number | null; hours: number | null };
  notes: string | null;
}

export interface AuthorizationMatch {
  /** The payer or service code says this service needs an authorization. */
  required: boolean;
  authorizationId: string | null;
  /** Remaining after this visit would be booked (null = no such limit). */
  remainingVisits: number | null;
  remainingHours: number | null;
}

const hoursBetween = (start: Date, end: Date) =>
  Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Patient service authorizations (DESIGN.md §5.4/§6.2, DECISIONS D-050). Usage is **computed from the visits linked
 * to an authorization** — never a stored counter that drifts. Visits are linked automatically when booked (see
 * `match`); scheduling warns when an authorization is missing or used up.
 */
@Injectable()
export class AuthorizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
  ) {}

  async list(caller: AuthUser, patientId: string): Promise<AuthorizationView[]> {
    await this.patient(caller, patientId);
    const rows = await this.prisma.authorization.findMany({
      where: { patientId },
      include: { payer: { select: { id: true, name: true } } },
      orderBy: [{ endDate: 'desc' }],
    });
    return this.views(caller.agencyId, rows);
  }

  async create(
    caller: AuthUser,
    patientId: string,
    dto: AuthorizationDto,
  ): Promise<AuthorizationView> {
    await this.patient(caller, patientId);
    await this.assertPayerAndCode(caller, dto.payerId, dto.serviceCode);
    if (dto.endDate < dto.startDate)
      throw new BadRequestException('endDate cannot be before startDate');
    const row = await this.prisma.authorization.create({
      data: {
        patientId,
        payerId: dto.payerId,
        authorizationNumber: dto.authorizationNumber ?? null,
        serviceCode: dto.serviceCode ?? null,
        startDate: toDate(dto.startDate)!,
        endDate: toDate(dto.endDate)!,
        authorizedVisits: dto.authorizedVisits ?? null,
        authorizedHours: dto.authorizedHours ?? null,
        notes: dto.notes ?? null,
      },
      include: { payer: { select: { id: true, name: true } } },
    });
    return (await this.views(caller.agencyId, [row]))[0]!;
  }

  async update(
    caller: AuthUser,
    patientId: string,
    id: string,
    dto: UpdateAuthorizationDto,
  ): Promise<AuthorizationView> {
    await this.patient(caller, patientId);
    const existing = await this.prisma.authorization.findFirst({ where: { id, patientId } });
    if (!existing) throw new NotFoundException('Authorization not found');
    if (dto.endDate && dto.endDate < fromDate(existing.startDate)!) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
    const row = await this.prisma.authorization.update({
      where: { id },
      data: {
        ...(dto.authorizationNumber !== undefined
          ? { authorizationNumber: dto.authorizationNumber }
          : {}),
        ...(dto.endDate ? { endDate: toDate(dto.endDate)! } : {}),
        ...(dto.authorizedVisits !== undefined ? { authorizedVisits: dto.authorizedVisits } : {}),
        ...(dto.authorizedHours !== undefined ? { authorizedHours: dto.authorizedHours } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: { payer: { select: { id: true, name: true } } },
    });
    if (dto.status === 'cancelled') {
      // Booked visits stop counting against it; they're re-linked (or warned about) when next changed.
      await this.prisma.visit.updateMany({
        where: { authorizationId: id, status: 'scheduled' },
        data: { authorizationId: null },
      });
    }
    return (await this.views(caller.agencyId, [row]))[0]!;
  }

  /**
   * Which authorization a visit falls under: active, covering the date, for this service code (or any code), the
   * soonest-ending one with room left first. `required` says whether one is needed at all.
   */
  async match(visit: {
    agencyId: string;
    patientId: string;
    serviceCode?: string | null;
    scheduledDate: string;
    scheduledStart: string;
    scheduledEnd: string;
    excludeVisitId?: string;
  }): Promise<AuthorizationMatch> {
    const date = toDate(visit.scheduledDate)!;
    const [patient, code] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { id: visit.patientId, agencyId: visit.agencyId },
        select: { payerPrimary: { select: { requiresAuthorization: true } } },
      }),
      visit.serviceCode
        ? this.prisma.serviceCode.findFirst({
            where: { agencyId: visit.agencyId, code: visit.serviceCode, isActive: true },
            select: { requiresAuth: true },
          })
        : null,
    ]);
    const required =
      Boolean(visit.serviceCode) &&
      Boolean(patient?.payerPrimary?.requiresAuthorization || code?.requiresAuth);
    const none: AuthorizationMatch = {
      required,
      authorizationId: null,
      remainingVisits: null,
      remainingHours: null,
    };
    if (!visit.serviceCode) return none;

    const candidates = await this.prisma.authorization.findMany({
      where: {
        patientId: visit.patientId,
        status: 'active',
        startDate: { lte: date },
        endDate: { gte: date },
        OR: [{ serviceCode: visit.serviceCode }, { serviceCode: null }],
        patient: { agencyId: visit.agencyId },
      },
      orderBy: { endDate: 'asc' },
    });
    if (!candidates.length) return none;

    const hours = hoursBetween(
      new Date(`1970-01-01T${visit.scheduledStart}:00Z`),
      new Date(`1970-01-01T${visit.scheduledEnd}:00Z`),
    );
    const usage = await this.usage(
      candidates.map((c) => c.id),
      visit.excludeVisitId,
    );
    const withRoom = candidates.map((c) => {
      const u = usage.get(c.id) ?? {
        used: { visits: 0, hours: 0 },
        planned: { visits: 0, hours: 0 },
      };
      const remainingVisits =
        c.authorizedVisits === null
          ? null
          : c.authorizedVisits - u.used.visits - u.planned.visits - 1;
      const remainingHours =
        c.authorizedHours === null
          ? null
          : round2(Number(c.authorizedHours) - u.used.hours - u.planned.hours - hours);
      return { id: c.id, remainingVisits, remainingHours };
    });
    const pick =
      withRoom.find((c) => (c.remainingVisits ?? 0) >= 0 && (c.remainingHours ?? 0) >= 0) ??
      withRoom[0]!;
    return {
      required,
      authorizationId: pick.id,
      remainingVisits: pick.remainingVisits,
      remainingHours: pick.remainingHours,
    };
  }

  private async views(agencyId: string, rows: AuthRow[]): Promise<AuthorizationView[]> {
    const today = await this.clock.todayString(agencyId);
    const usage = await this.usage(rows.map((r) => r.id));
    return rows.map((r) => {
      const u = usage.get(r.id) ?? {
        used: { visits: 0, hours: 0 },
        planned: { visits: 0, hours: 0 },
      };
      const remainingVisits =
        r.authorizedVisits === null ? null : r.authorizedVisits - u.used.visits - u.planned.visits;
      const remainingHours =
        r.authorizedHours === null
          ? null
          : round2(Number(r.authorizedHours) - u.used.hours - u.planned.hours);
      const start = fromDate(r.startDate)!;
      const end = fromDate(r.endDate)!;
      const exhausted =
        (remainingVisits !== null && remainingVisits <= 0) ||
        (remainingHours !== null && remainingHours <= 0);
      const state =
        r.status === 'cancelled'
          ? 'cancelled'
          : end < today
            ? 'expired'
            : start > today
              ? 'upcoming'
              : exhausted
                ? 'exhausted'
                : 'active';
      return {
        id: r.id,
        payer: r.payer,
        authorizationNumber: r.authorizationNumber,
        serviceCode: r.serviceCode,
        startDate: start,
        endDate: end,
        authorizedVisits: r.authorizedVisits,
        authorizedHours: r.authorizedHours === null ? null : Number(r.authorizedHours),
        status: r.status,
        state,
        expiringSoon: state === 'active' && end <= addDays(today, EXPIRING_DAYS),
        used: { visits: u.used.visits, hours: round2(u.used.hours) },
        planned: { visits: u.planned.visits, hours: round2(u.planned.hours) },
        remaining: { visits: remainingVisits, hours: remainingHours },
        notes: r.notes,
      };
    });
  }

  /** Visits and hours per authorization: used (done/in progress; actual times when known) and planned (booked). */
  private async usage(ids: string[], excludeVisitId?: string) {
    const map = new Map<string, { used: Amounts; planned: Amounts }>();
    if (!ids.length) return map;
    const visits = await this.prisma.visit.findMany({
      where: {
        authorizationId: { in: ids },
        status: { in: COUNTED },
        ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}),
      },
      select: {
        authorizationId: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        actualStart: true,
        actualEnd: true,
      },
    });
    for (const v of visits) {
      const entry = map.get(v.authorizationId!) ?? {
        used: { visits: 0, hours: 0 },
        planned: { visits: 0, hours: 0 },
      };
      const bucket = v.status === 'scheduled' ? entry.planned : entry.used;
      bucket.visits++;
      bucket.hours +=
        v.actualStart && v.actualEnd
          ? hoursBetween(v.actualStart, v.actualEnd)
          : hoursBetween(v.scheduledStart, v.scheduledEnd);
      map.set(v.authorizationId!, entry);
    }
    return map;
  }

  private async patient(caller: AuthUser, patientId: string): Promise<void> {
    const found = await this.prisma.patient.count({
      where: { id: patientId, agencyId: caller.agencyId },
    });
    if (!found) throw new NotFoundException('Patient not found');
  }

  private async assertPayerAndCode(
    caller: AuthUser,
    payerId: string,
    serviceCode?: string,
  ): Promise<void> {
    const [payer, code] = await Promise.all([
      this.prisma.payer.count({ where: { id: payerId, agencyId: caller.agencyId } }),
      serviceCode
        ? this.prisma.serviceCode.count({ where: { agencyId: caller.agencyId, code: serviceCode } })
        : 1,
    ]);
    if (!payer) throw new BadRequestException('payerId does not match a payer in this agency');
    if (!code)
      throw new BadRequestException("serviceCode is not one of this agency's service codes");
  }
}
