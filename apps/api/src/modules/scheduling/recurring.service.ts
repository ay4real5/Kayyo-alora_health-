import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { recurrenceDates, todayInTimeZone, type RecurrenceFrequency, type VisitType } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, fromTime, toDate, toTime } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { ConflictDetectorService, type Conflict } from './conflict-detector.service.js';
import type {
  CreateRecurringDto,
  ListRecurringQueryDto,
  UpdateRecurringDto,
} from './dto/recurring.dto.js';

/** Occurrences are created this far ahead; a scheduled job will keep extending the window (P2-02). */
export const GENERATION_HORIZON_DAYS = 28;
const MAX_HORIZON_DAYS = 366;
const CHECK_CONCURRENCY = 5;

const RULE_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true, status: true } },
  staff: { select: { id: true, discipline: true, userId: true, user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.RecurrenceRuleInclude;
type RuleRow = Prisma.RecurrenceRuleGetPayload<{ include: typeof RULE_INCLUDE }>;

export interface RecurringView {
  id: string;
  patient: { id: string; firstName: string; lastName: string };
  staff: { id: string; firstName: string; lastName: string; discipline: string } | null;
  visitType: string;
  serviceCode: string | null;
  frequency: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  isActive: boolean;
}

export interface GenerationResult {
  created: { id: string; scheduledDate: string }[];
  /** Dates not booked because of blocking conflicts — book them individually or fix the conflict. */
  skipped: { date: string; conflicts: Conflict[] }[];
  /** Booked dates that carry warnings. */
  warnings: { date: string; conflicts: Conflict[] }[];
}

export interface RecurringWithGeneration extends RecurringView {
  generation: GenerationResult;
}

/**
 * Recurring visit series (DESIGN.md §6.5, DECISIONS D-031). A rule is a pattern; its occurrences are ordinary
 * visits (is_recurring, recurrence_rule_id) created up to a rolling horizon, each passing the conflict detector.
 */
@Injectable()
export class RecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conflicts: ConflictDetectorService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(caller: AuthUser, query: ListRecurringQueryDto): Promise<Paginated<RecurringView>> {
    const where: Prisma.RecurrenceRuleWhereInput = {
      AND: [
        await this.scope(caller),
        query.patientId ? { patientId: query.patientId } : {},
        query.staffId ? { staffId: query.staffId } : {},
        query.isActive !== undefined ? { isActive: query.isActive } : {},
      ],
    };
    const [rules, total] = await Promise.all([
      this.prisma.recurrenceRule.findMany({
        where,
        include: RULE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.recurrenceRule.count({ where }),
    ]);
    return Paginated.of(rules.map(toView), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<RecurringView> {
    return toView(await this.find(caller, id));
  }

  async create(caller: AuthUser, dto: CreateRecurringDto): Promise<RecurringWithGeneration> {
    assertPattern(dto);
    const patient = await this.prisma.patient.findFirst({ where: { id: dto.patientId, agencyId: caller.agencyId } });
    if (!patient) throw new BadRequestException('patientId does not match a patient in this agency');
    if (patient.status !== 'active') throw new ConflictException(`The patient is ${patient.status}`);
    await this.assertStaff(caller, dto.staffId);

    const rule = await this.prisma.recurrenceRule.create({
      data: {
        agencyId: caller.agencyId,
        patientId: dto.patientId,
        staffId: dto.staffId ?? null,
        visitType: dto.visitType,
        serviceCode: dto.serviceCode ?? null,
        frequency: dto.frequency,
        daysOfWeek: [...dto.daysOfWeek].sort((a, b) => a - b),
        startTime: toTime(dto.startTime),
        endTime: toTime(dto.endTime),
        startDate: toDate(dto.startDate)!,
        endDate: toDate(dto.endDate) ?? null,
        maxOccurrences: dto.maxOccurrences ?? null,
      },
      include: RULE_INCLUDE,
    });
    const generation = await this.generateFor(caller, rule);
    await this.notifySeries(caller, rule, generation, 'New recurring visits assigned');
    return { ...toView(rule), generation };
  }

  /** One notification per series change, not one per visit. No PHI. */
  private async notifySeries(caller: AuthUser, rule: RuleRow, generation: GenerationResult, title: string): Promise<void> {
    if (!rule.staff || !generation.created.length) return;
    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: [rule.staff.userId],
      actorUserId: caller.userId,
      type: 'shift_assigned',
      title,
      body: `${generation.created.length} visit(s) starting ${generation.created[0]!.scheduledDate}. Open the app for details.`,
      data: { recurrenceRuleId: rule.id },
    });
  }

  /**
   * Changes the pattern. Future `scheduled` occurrences are removed and rebuilt from the new pattern;
   * everything else (past, in-progress, completed, cancelled) is left as it was.
   */
  async update(caller: AuthUser, id: string, dto: UpdateRecurringDto): Promise<RecurringWithGeneration> {
    const existing = await this.find(caller, id);
    if (!existing.isActive) throw new ConflictException('This recurring schedule has ended');
    const merged = {
      startTime: dto.startTime ?? fromTime(existing.startTime),
      endTime: dto.endTime ?? fromTime(existing.endTime),
      startDate: fromDate(existing.startDate)!,
      endDate: dto.endDate === undefined ? fromDate(existing.endDate) : dto.endDate,
    };
    assertPattern({ ...merged, endDate: merged.endDate ?? undefined });
    if (dto.staffId) await this.assertStaff(caller, dto.staffId);

    const today = await this.agencyToday(caller);
    const rule = await this.prisma.$transaction(async (tx) => {
      await tx.visit.deleteMany({
        where: { recurrenceRuleId: id, status: 'scheduled', scheduledDate: { gte: toDate(today) } },
      });
      return tx.recurrenceRule.update({
        where: { id },
        data: {
          ...(dto.staffId !== undefined ? { staffId: dto.staffId } : {}),
          ...(dto.visitType ? { visitType: dto.visitType } : {}),
          ...(dto.serviceCode !== undefined ? { serviceCode: dto.serviceCode } : {}),
          ...(dto.daysOfWeek ? { daysOfWeek: [...dto.daysOfWeek].sort((a, b) => a - b) } : {}),
          startTime: toTime(merged.startTime),
          endTime: toTime(merged.endTime),
          endDate: toDate(merged.endDate ?? undefined) ?? null,
        },
        include: RULE_INCLUDE,
      });
    });
    const generation = await this.generateFor(caller, rule);
    await this.notifySeries(caller, rule, generation, 'Your recurring visits changed');
    return { ...toView(rule), generation };
  }

  /** Ends the series: the rule is deactivated and its future scheduled occurrences are cancelled. */
  async end(caller: AuthUser, id: string): Promise<{ cancelledVisits: number }> {
    const rule = await this.find(caller, id);
    if (!rule.isActive) throw new ConflictException('This recurring schedule has already ended');
    const today = await this.agencyToday(caller);
    const [cancelled] = await this.prisma.$transaction([
      this.prisma.visit.updateMany({
        where: { recurrenceRuleId: id, status: 'scheduled', scheduledDate: { gte: toDate(today) } },
        data: { status: 'cancelled', cancelReason: 'Recurring schedule ended' },
      }),
      this.prisma.recurrenceRule.update({ where: { id }, data: { isActive: false } }),
    ]);
    return { cancelledVisits: cancelled.count };
  }

  /** Creates occurrences up to `until` (default: the rolling horizon). Safe to repeat. */
  async generate(caller: AuthUser, id: string, until?: string): Promise<GenerationResult> {
    const rule = await this.find(caller, id);
    if (!rule.isActive) throw new ConflictException('This recurring schedule has ended');
    const today = await this.agencyToday(caller);
    if (until && until > addDays(today, MAX_HORIZON_DAYS)) {
      throw new BadRequestException('until can be at most one year ahead');
    }
    return this.generateFor(caller, rule, until);
  }

  /**
   * Nightly (D-041): keeps every active series booked 28 days ahead. Idempotent (unique rule+date), so a re-run or
   * a second API instance running it at the same time only skips dates that already exist.
   */
  async extendAllActive(agencyIds?: string[]): Promise<{ rules: number; created: number; skipped: number }> {
    const rules = await this.prisma.recurrenceRule.findMany({
      where: { isActive: true, ...(agencyIds ? { agencyId: { in: agencyIds } } : {}) },
      include: RULE_INCLUDE,
    });
    let created = 0;
    let skipped = 0;
    for (const rule of rules) {
      const result = await this.generateFor({ agencyId: rule.agencyId, userId: null }, rule);
      created += result.created.length;
      skipped += result.skipped.length;
    }
    return { rules: rules.length, created, skipped };
  }

  private async generateFor(caller: JobCaller, rule: RuleRow, until?: string): Promise<GenerationResult> {
    const today = await this.agencyToday(caller);
    const dates = recurrenceDates(
      {
        frequency: rule.frequency as RecurrenceFrequency,
        daysOfWeek: rule.daysOfWeek,
        startDate: fromDate(rule.startDate)!,
        endDate: fromDate(rule.endDate),
        maxOccurrences: rule.maxOccurrences,
      },
      today,
      until ?? addDays(today, GENERATION_HORIZON_DAYS),
    );
    const existing = new Set(
      (
        await this.prisma.visit.findMany({
          where: { recurrenceRuleId: rule.id, scheduledDate: { in: dates.map((d) => toDate(d)!) } },
          select: { scheduledDate: true },
        })
      ).map((v) => fromDate(v.scheduledDate)!),
    );
    const todo = dates.filter((date) => !existing.has(date));

    const result: GenerationResult = { created: [], skipped: [], warnings: [] };
    for (let i = 0; i < todo.length; i += CHECK_CONCURRENCY) {
      const batch = todo.slice(i, i + CHECK_CONCURRENCY);
      const checked = await Promise.all(
        batch.map(async (date) => ({
          date,
          conflicts: await this.conflicts.check({
            agencyId: caller.agencyId,
            patientId: rule.patientId,
            staffId: rule.staffId,
            visitType: rule.visitType as VisitType,
            scheduledDate: date,
            scheduledStart: fromTime(rule.startTime),
            scheduledEnd: fromTime(rule.endTime),
          }),
        })),
      );
      for (const { date, conflicts } of checked) {
        const blocking = conflicts.filter((c) => c.severity === 'blocking');
        if (blocking.length) {
          result.skipped.push({ date, conflicts: blocking });
          continue;
        }
        try {
          const visit = await this.prisma.visit.create({
            data: {
              agencyId: caller.agencyId,
              patientId: rule.patientId,
              staffId: rule.staffId,
              visitType: rule.visitType,
              serviceCode: rule.serviceCode,
              scheduledDate: toDate(date)!,
              scheduledStart: rule.startTime,
              scheduledEnd: rule.endTime,
              isRecurring: true,
              recurrenceRuleId: rule.id,
              createdById: caller.userId,
            },
            select: { id: true },
          });
          result.created.push({ id: visit.id, scheduledDate: date });
          const warnings = conflicts.filter((c) => c.severity === 'warning');
          if (warnings.length) result.warnings.push({ date, conflicts: warnings });
        } catch (error) {
          // Another generation run created this date first — that's fine, generation is idempotent.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        }
      }
    }
    return result;
  }

  private async scope(caller: AuthUser): Promise<Prisma.RecurrenceRuleWhereInput> {
    const access = await this.permissions.forUser(caller);
    if (access.permissions.has('visits:read_all')) return { agencyId: caller.agencyId };
    return { agencyId: caller.agencyId, staff: { userId: caller.userId } };
  }

  private async find(caller: AuthUser, id: string): Promise<RuleRow> {
    const rule = await this.prisma.recurrenceRule.findFirst({
      where: { AND: [{ id }, await this.scope(caller)] },
      include: RULE_INCLUDE,
    });
    if (!rule) throw new NotFoundException('Recurring schedule not found');
    return rule;
  }

  private async assertStaff(caller: AuthUser, staffId: string | undefined | null): Promise<void> {
    if (!staffId) return;
    const exists = await this.prisma.staffProfile.count({ where: { id: staffId, agencyId: caller.agencyId } });
    if (!exists) throw new BadRequestException('staffId does not match a staff member in this agency');
  }

  private async agencyToday(caller: Pick<AuthUser, 'agencyId'>): Promise<string> {
    const agency = await this.prisma.agency.findUniqueOrThrow({ where: { id: caller.agencyId }, select: { timezone: true } });
    return todayInTimeZone(agency.timezone);
  }
}

/** Who a generation run is for: a signed-in user, or the nightly job (no user). */
type JobCaller = Pick<AuthUser, 'agencyId'> & { userId: string | null };

function assertPattern(p: { startTime: string; endTime: string; startDate: string; endDate?: string }): void {
  if (p.endTime <= p.startTime) throw new BadRequestException('endTime must be after startTime');
  if (p.endDate && p.endDate < p.startDate) throw new BadRequestException('endDate cannot be before startDate');
}

function toView(rule: RuleRow): RecurringView {
  return {
    id: rule.id,
    patient: { id: rule.patient.id, firstName: rule.patient.firstName, lastName: rule.patient.lastName },
    staff: rule.staff
      ? {
          id: rule.staff.id,
          firstName: rule.staff.user.firstName,
          lastName: rule.staff.user.lastName,
          discipline: rule.staff.discipline,
        }
      : null,
    visitType: rule.visitType,
    serviceCode: rule.serviceCode,
    frequency: rule.frequency,
    daysOfWeek: rule.daysOfWeek,
    startTime: fromTime(rule.startTime),
    endTime: fromTime(rule.endTime),
    startDate: fromDate(rule.startDate)!,
    endDate: fromDate(rule.endDate),
    maxOccurrences: rule.maxOccurrences,
    isActive: rule.isActive,
  };
}
