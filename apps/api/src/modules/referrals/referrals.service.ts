import { OPEN_REFERRAL_STATUSES, zonedTimeToUtc, type ReferralStatus } from '@alora/shared';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreatePatientDto } from '../patients/dto/patients.dto.js';
import { PatientsService } from '../patients/patients.service.js';
import type {
  AdmitReferralDto,
  CreateReferralDto,
  IntakeDto,
  ListReferralsQueryDto,
  ReferralSourceDto,
  ReferralStatusDto,
  UpdateReferralDto,
  UpdateReferralSourceDto,
} from './dto/referrals.dto.js';

const INCLUDE = {
  source: { select: { id: true, name: true, sourceType: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} as const;
type Row = Prisma.ReferralGetPayload<{ include: typeof INCLUDE }>;

export interface ReferralView {
  id: string;
  status: string;
  channel: string;
  clientFirstName: string;
  clientLastName: string;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  zip: string | null;
  payerType: string;
  careNeeds: string | null;
  contactName: string | null;
  contactRelationship: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  lostReason: string | null;
  nextFollowUp: string | null;
  source: { id: string; name: string; sourceType: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  patientId: string | null;
  statusChangedAt: Date;
  admittedAt: Date | null;
  createdAt: Date;
}

export interface ReferralEventView {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  by: string | null;
  createdAt: Date;
}

export interface SourceReportRow {
  sourceId: string | null;
  name: string;
  sourceType: string | null;
  referrals: number;
  admitted: number;
  lost: number;
  open: number;
  /** Admitted ÷ (admitted + lost), as a percent; null until something has closed. */
  conversionRate: number | null;
  /** Average days from referral to admission. */
  avgDaysToAdmit: number | null;
}

function toView(r: Row): ReferralView {
  return {
    id: r.id,
    status: r.status,
    channel: r.channel,
    clientFirstName: r.clientFirstName,
    clientLastName: r.clientLastName,
    dateOfBirth: fromDate(r.dateOfBirth),
    phone: r.phone,
    email: r.email,
    city: r.city,
    zip: r.zip,
    payerType: r.payerType,
    careNeeds: r.careNeeds,
    contactName: r.contactName,
    contactRelationship: r.contactRelationship,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    lostReason: r.lostReason,
    nextFollowUp: fromDate(r.nextFollowUp),
    source: r.source,
    assignedTo: r.assignedTo,
    patientId: r.patientId,
    statusChangedAt: r.statusChangedAt,
    admittedAt: r.admittedAt,
    createdAt: r.createdAt,
  };
}

const DAY_MS = 86_400_000;

/**
 * The referral pipeline (D-098): prospective clients from first call to admission, where they came from, and how
 * well each source converts. Admission creates the patient through PatientsService, so every admission rule applies.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly patients: PatientsService,
    private readonly compliance: ComplianceService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(caller: AuthUser, q: ListReferralsQueryDto): Promise<Paginated<ReferralView>> {
    const where: Prisma.ReferralWhereInput = {
      agencyId: caller.agencyId,
      ...(q.status === 'open' ? { status: { in: [...OPEN_REFERRAL_STATUSES] } } : q.status ? { status: q.status } : {}),
      ...(q.sourceId ? { sourceId: q.sourceId } : {}),
      ...(q.search
        ? {
            OR: [
              { clientFirstName: { contains: q.search, mode: 'insensitive' } },
              { clientLastName: { contains: q.search, mode: 'insensitive' } },
              { contactName: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: q.search } },
              { contactPhone: { contains: q.search } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.referral.findMany({ where, include: INCLUDE, orderBy: [{ createdAt: 'desc' }], skip: q.skip, take: q.limit }),
      this.prisma.referral.count({ where }),
    ]);
    return Paginated.of(rows.map(toView), total, q);
  }

  /** Every open referral, for the pipeline board (columns by status). */
  async board(caller: AuthUser): Promise<{ status: ReferralStatus; referrals: ReferralView[] }[]> {
    const rows = await this.prisma.referral.findMany({
      where: { agencyId: caller.agencyId, status: { in: [...OPEN_REFERRAL_STATUSES] } },
      include: INCLUDE,
      orderBy: [{ statusChangedAt: 'asc' }],
      take: 500,
    });
    return OPEN_REFERRAL_STATUSES.map((status) => ({ status, referrals: rows.filter((r) => r.status === status).map(toView) }));
  }

  async get(caller: AuthUser, id: string): Promise<ReferralView & { events: ReferralEventView[] }> {
    const row = await this.prisma.referral.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: { ...INCLUDE, events: { include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } } },
    });
    if (!row) throw new NotFoundException('Referral not found');
    return {
      ...toView(row),
      events: row.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: e.note,
        by: e.user ? `${e.user.firstName} ${e.user.lastName}` : null,
        createdAt: e.createdAt,
      })),
    };
  }

  private async find(caller: AuthUser, id: string) {
    const row = await this.prisma.referral.findFirst({ where: { id, agencyId: caller.agencyId } });
    if (!row) throw new NotFoundException('Referral not found');
    return row;
  }

  /** Source and assignee must belong to the caller's agency (assignee: an active staff user). */
  private async assertLinks(agencyId: string, dto: { sourceId?: string | null; assignedToId?: string | null }) {
    if (dto.sourceId) {
      const ok = await this.prisma.referralSource.count({ where: { id: dto.sourceId, agencyId } });
      if (!ok) throw new BadRequestException('Referral source not found');
    }
    if (dto.assignedToId) {
      const ok = await this.prisma.user.count({ where: { id: dto.assignedToId, agencyId, isActive: true } });
      if (!ok) throw new BadRequestException('Assignee not found');
    }
  }

  async create(caller: AuthUser, dto: CreateReferralDto): Promise<ReferralView> {
    await this.assertLinks(caller.agencyId, dto);
    const { dateOfBirth, nextFollowUp, ...fields } = dto;
    const row = await this.prisma.referral.create({
      data: {
        ...fields,
        agencyId: caller.agencyId,
        channel: 'manual',
        dateOfBirth: toDate(dateOfBirth),
        nextFollowUp: toDate(nextFollowUp),
        events: { create: { eventType: 'created', toStatus: 'new', userId: caller.userId } },
      },
      include: INCLUDE,
    });
    return toView(row);
  }

  async update(caller: AuthUser, id: string, dto: UpdateReferralDto): Promise<ReferralView> {
    const current = await this.find(caller, id);
    if (current.status === 'admitted') throw new ConflictException('This referral is admitted — edit the patient instead');
    await this.assertLinks(caller.agencyId, dto);
    const { dateOfBirth, nextFollowUp, ...fields } = dto;
    const row = await this.prisma.referral.update({
      where: { id },
      data: {
        ...fields,
        ...(dateOfBirth !== undefined ? { dateOfBirth: toDate(dateOfBirth) } : {}),
        ...(nextFollowUp !== undefined ? { nextFollowUp: nextFollowUp === null ? null : toDate(nextFollowUp) } : {}),
      },
      include: INCLUDE,
    });
    return toView(row);
  }

  async setStatus(caller: AuthUser, id: string, dto: ReferralStatusDto): Promise<ReferralView> {
    const current = await this.find(caller, id);
    if (current.status === 'admitted') throw new ConflictException('This referral is already admitted');
    if (current.status === dto.status) throw new ConflictException(`The referral is already ${dto.status}`);
    const row = await this.prisma.referral.update({
      where: { id },
      data: {
        status: dto.status,
        statusChangedAt: new Date(),
        lostReason: dto.status === 'lost' ? dto.lostReason : null,
        events: { create: { eventType: 'status', fromStatus: current.status, toStatus: dto.status, note: dto.status === 'lost' ? (dto.note ? `${dto.lostReason} — ${dto.note}` : dto.lostReason) : dto.note, userId: caller.userId } },
      },
      include: INCLUDE,
    });
    return toView(row);
  }

  async addNote(caller: AuthUser, id: string, note: string): Promise<ReferralEventView> {
    await this.find(caller, id);
    const e = await this.prisma.referralEvent.create({
      data: { referralId: id, eventType: 'note', note, userId: caller.userId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    return { id: e.id, eventType: e.eventType, fromStatus: null, toStatus: null, note: e.note, by: e.user ? `${e.user.firstName} ${e.user.lastName}` : null, createdAt: e.createdAt };
  }

  /** Admit: create the patient from the referral (same validation and rules as Add patient) and close the referral. */
  async admit(caller: AuthUser, id: string, dto: AdmitReferralDto): Promise<{ referral: ReferralView; patientId: string }> {
    const r = await this.find(caller, id);
    if (r.status === 'admitted' || r.patientId) throw new ConflictException('This referral is already admitted');
    if (r.status === 'lost') throw new ConflictException('Reopen the referral before admitting');
    const patientDto = plainToInstance(CreatePatientDto, {
      firstName: r.clientFirstName,
      lastName: r.clientLastName,
      dateOfBirth: dto.dateOfBirth ?? fromDate(r.dateOfBirth) ?? undefined,
      ...(dto.gender ? { gender: dto.gender } : {}),
      ...(r.phone ? { phoneCell: r.phone } : {}),
      ...(r.email ? { email: r.email } : {}),
      ...(dto.addressLine1 ? { addressLine1: dto.addressLine1 } : {}),
      ...(r.city ? { city: r.city } : {}),
      ...(dto.state ? { state: dto.state } : {}),
      ...(r.zip ? { zip: r.zip } : {}),
      ...(r.contactName ? { emergencyContactName: r.contactName } : {}),
      ...(r.contactPhone ? { emergencyContactPhone: r.contactPhone } : {}),
      ...(r.contactRelationship ? { emergencyContactRelation: r.contactRelationship } : {}),
      ...(dto.admissionDate ? { admissionDate: dto.admissionDate } : {}),
    });
    const errors = validateSync(patientDto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const fields = errors.map((e) => e.property).join(', ');
      throw new BadRequestException(`Can't admit yet — check: ${fields}${fields.includes('dateOfBirth') ? ' (date of birth is required)' : ''}`);
    }
    const patient = await this.patients.admit(caller, patientDto);
    const claimed = await this.prisma.referral.updateMany({
      where: { id, agencyId: caller.agencyId, patientId: null },
      data: { status: 'admitted', patientId: patient.id, admittedAt: new Date(), statusChangedAt: new Date(), nextFollowUp: null },
    });
    if (claimed.count === 0) {
      // Someone admitted it at the same moment; the duplicate patient is left for the office to discharge.
      this.logger.warn(`Referral ${id} was admitted twice; patient ${patient.id} is a duplicate`);
      throw new ConflictException('This referral was just admitted by someone else');
    }
    await this.prisma.referralEvent.create({ data: { referralId: id, eventType: 'admitted', fromStatus: r.status, toStatus: 'admitted', userId: caller.userId } });
    const row = await this.prisma.referral.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return { referral: toView(row), patientId: patient.id };
  }

  // ── Sources ─────────────────────────────────────────────────────────────────────────────────────────────────

  async listSources(caller: AuthUser) {
    return this.prisma.referralSource.findMany({ where: { agencyId: caller.agencyId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  createSource(caller: AuthUser, dto: ReferralSourceDto) {
    return this.prisma.referralSource.create({ data: { ...dto, agencyId: caller.agencyId } });
  }

  async updateSource(caller: AuthUser, id: string, dto: UpdateReferralSourceDto) {
    const ok = await this.prisma.referralSource.count({ where: { id, agencyId: caller.agencyId } });
    if (!ok) throw new NotFoundException('Referral source not found');
    return this.prisma.referralSource.update({ where: { id }, data: dto });
  }

  /** Per source over referrals received in [from, to] (default the last 90 days): volume and conversion. */
  async sourcesReport(caller: AuthUser, from?: string, to?: string): Promise<{ from: string; to: string; rows: SourceReportRow[] }> {
    const today = await this.clock.todayString(caller.agencyId);
    const end = to ?? today;
    const start = from ?? addDays(end, -89);
    const tz = await this.clock.timezone(caller.agencyId);
    // Agency-local day bounds → instants (createdAt is a timestamp).
    const rows = await this.prisma.referral.findMany({
      where: { agencyId: caller.agencyId, createdAt: { gte: zonedTimeToUtc(start, '00:00', tz), lt: zonedTimeToUtc(addDays(end, 1), '00:00', tz) } },
      select: { sourceId: true, channel: true, status: true, createdAt: true, admittedAt: true, source: { select: { name: true, sourceType: true } } },
    });
    const groups = new Map<string, SourceReportRow & { days: number[] }>();
    for (const r of rows) {
      const key = r.sourceId ?? `channel:${r.channel}`;
      const g =
        groups.get(key) ??
        groups
          .set(key, {
            sourceId: r.sourceId,
            name: r.source?.name ?? (r.channel === 'web_form' ? 'Website form (no source set)' : 'No source set'),
            sourceType: r.source?.sourceType ?? null,
            referrals: 0,
            admitted: 0,
            lost: 0,
            open: 0,
            conversionRate: null,
            avgDaysToAdmit: null,
            days: [],
          })
          .get(key)!;
      g.referrals++;
      if (r.status === 'admitted') {
        g.admitted++;
        if (r.admittedAt) g.days.push((r.admittedAt.getTime() - r.createdAt.getTime()) / DAY_MS);
      } else if (r.status === 'lost') g.lost++;
      else g.open++;
    }
    const out = [...groups.values()].map(({ days, ...g }) => ({
      ...g,
      conversionRate: g.admitted + g.lost ? Math.round((g.admitted / (g.admitted + g.lost)) * 100) : null,
      avgDaysToAdmit: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
    }));
    out.sort((a, b) => b.referrals - a.referrals || a.name.localeCompare(b.name));
    return { from: start, to: end, rows: out };
  }

  // ── Public intake ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The public "I need care" form. Unknown agency → 404. A filled-in honeypot is accepted silently (bots learn
   * nothing) and stored nowhere. Staff who manage referrals get a notification without PHI.
   */
  async intake(agencyId: string, dto: IntakeDto): Promise<{ received: true }> {
    const agency = await this.prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
    if (!agency) throw new NotFoundException('Agency not found');
    if (dto.website) return { received: true };
    const { submittedBy, consent: _consent, website: _website, dateOfBirth, ...fields } = dto;
    if (submittedBy === 'someone_else' && !fields.contactName && !fields.contactPhone && !fields.contactEmail) {
      throw new BadRequestException('Please tell us how to reach you');
    }
    if (!fields.phone && !fields.email && !fields.contactPhone && !fields.contactEmail) {
      throw new BadRequestException('Please give a phone number or email so we can call you back');
    }
    const row = await this.prisma.referral.create({
      data: {
        ...fields,
        agencyId,
        channel: 'web_form',
        dateOfBirth: toDate(dateOfBirth),
        events: { create: { eventType: 'created', toStatus: 'new', note: 'Received from the website form' } },
      },
    });
    try {
      const userIds = await this.compliance.usersWithPermission(agencyId, 'referrals', 'manage');
      await this.notifications.notify({
        agencyId,
        userIds,
        type: 'referral_received',
        title: 'New referral from the website',
        body: 'Someone asked about care through the intake form. Open Referrals to call them back.',
        data: { referralId: row.id },
      });
    } catch (error) {
      this.logger.error(`Referral alert failed: ${(error as Error).name}`);
    }
    return { received: true };
  }

  /** For the Command Center: new referrals not yet contacted, and follow-ups due by today. */
  async attention(agencyId: string): Promise<{ newWaiting: number; followUpsDue: number }> {
    const today = await this.clock.today(agencyId);
    const [newWaiting, followUpsDue] = await Promise.all([
      this.prisma.referral.count({ where: { agencyId, status: 'new' } }),
      this.prisma.referral.count({ where: { agencyId, status: { in: [...OPEN_REFERRAL_STATUSES] }, nextFollowUp: { lte: today } } }),
    ]);
    return { newWaiting, followUpsDue };
  }
}

