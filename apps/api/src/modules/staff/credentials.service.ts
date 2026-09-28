import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { credentialState, type CredentialState } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreateCredentialDto, UpdateCredentialDto } from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

export interface CredentialView {
  id: string;
  credentialType: string;
  credentialName: string;
  credentialNumber: string | null;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  alertDaysBefore: number;
  /** valid | expiring_soon | expired | no_expiry — computed, never stored. */
  state: CredentialState;
  verifiedById: string | null;
  verifiedAt: Date | null;
  notes: string | null;
}

export interface ExpiringCredential extends CredentialView {
  staff: { id: string; firstName: string; lastName: string; discipline: string };
}

type CredentialRow = Prisma.StaffCredentialGetPayload<object>;

/** Staff licences and certifications with expiry tracking (DESIGN.md §5.3, §13.2 credential_expiry). */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: StaffService,
    private readonly clock: AgencyClockService,
  ) {}

  async list(caller: AuthUser, staffId: string): Promise<CredentialView[]> {
    await this.staff.assertSelfOr(caller, await this.staff.find(caller, staffId), 'staff:read');
    const rows = await this.prisma.staffCredential.findMany({
      where: { staffProfileId: staffId },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { credentialName: 'asc' }],
    });
    const today = await this.clock.todayString(caller.agencyId);
    return rows.map((row) => toView(row, today));
  }

  async add(caller: AuthUser, staffId: string, dto: CreateCredentialDto): Promise<CredentialView> {
    await this.staff.find(caller, staffId);
    assertDates(dto.issueDate, dto.expiryDate);
    const row = await this.prisma.staffCredential.create({
      data: {
        staffProfileId: staffId,
        credentialType: dto.credentialType,
        credentialName: dto.credentialName,
        credentialNumber: dto.credentialNumber ?? null,
        issuingAuthority: dto.issuingAuthority ?? null,
        issueDate: toDate(dto.issueDate) ?? null,
        expiryDate: toDate(dto.expiryDate) ?? null,
        alertDaysBefore: dto.alertDaysBefore ?? 30,
        notes: dto.notes ?? null,
      },
    });
    return toView(row, await this.clock.todayString(caller.agencyId));
  }

  async update(caller: AuthUser, staffId: string, credentialId: string, dto: UpdateCredentialDto): Promise<CredentialView> {
    await this.staff.find(caller, staffId);
    const existing = await this.findCredential(staffId, credentialId);
    assertDates(dto.issueDate ?? fromDate(existing.issueDate) ?? undefined, dto.expiryDate ?? fromDate(existing.expiryDate) ?? undefined);

    const data: Prisma.StaffCredentialUncheckedUpdateInput = {};
    for (const key of ['credentialType', 'credentialName', 'credentialNumber', 'issuingAuthority', 'alertDaysBefore', 'notes'] as const) {
      if (dto[key] !== undefined) (data as Record<string, unknown>)[key] = dto[key];
    }
    if (dto.issueDate !== undefined) data.issueDate = toDate(dto.issueDate);
    if (dto.expiryDate !== undefined) data.expiryDate = toDate(dto.expiryDate);
    if (dto.verified !== undefined) {
      data.verifiedById = dto.verified ? caller.userId : null;
      data.verifiedAt = dto.verified ? new Date() : null;
    }
    return toView(await this.prisma.staffCredential.update({ where: { id: credentialId }, data }), await this.clock.todayString(caller.agencyId));
  }

  async remove(caller: AuthUser, staffId: string, credentialId: string): Promise<void> {
    await this.staff.find(caller, staffId);
    await this.findCredential(staffId, credentialId);
    await this.prisma.staffCredential.delete({ where: { id: credentialId } });
  }

  /** Active staff's credentials that are expired or expire within `withinDays`, soonest first. */
  async expiring(caller: AuthUser, withinDays: number): Promise<ExpiringCredential[]> {
    const today = await this.clock.todayString(caller.agencyId);
    const rows = await this.prisma.staffCredential.findMany({
      where: {
        expiryDate: { lte: toDate(addDays(today, withinDays)) },
        staffProfile: { agencyId: caller.agencyId, isActive: true },
      },
      include: {
        staffProfile: {
          select: { id: true, discipline: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { expiryDate: 'asc' },
      take: 500,
    });
    return rows.map((row) => ({
      ...toView(row, today),
      staff: {
        id: row.staffProfile.id,
        firstName: row.staffProfile.user.firstName,
        lastName: row.staffProfile.user.lastName,
        discipline: row.staffProfile.discipline,
      },
    }));
  }

  private async findCredential(staffId: string, credentialId: string): Promise<CredentialRow> {
    const credential = await this.prisma.staffCredential.findFirst({ where: { id: credentialId, staffProfileId: staffId } });
    if (!credential) throw new NotFoundException('Credential not found');
    return credential;
  }
}

function assertDates(issueDate: string | undefined, expiryDate: string | undefined): void {
  if (issueDate && expiryDate && expiryDate < issueDate) {
    throw new BadRequestException('expiryDate cannot be before issueDate');
  }
}

function toView(row: CredentialRow, today: string): CredentialView {
  const expiryDate = fromDate(row.expiryDate);
  return {
    id: row.id,
    credentialType: row.credentialType,
    credentialName: row.credentialName,
    credentialNumber: row.credentialNumber,
    issuingAuthority: row.issuingAuthority,
    issueDate: fromDate(row.issueDate),
    expiryDate,
    alertDaysBefore: row.alertDaysBefore,
    state: credentialState(expiryDate, row.alertDaysBefore, today),
    verifiedById: row.verifiedById,
    verifiedAt: row.verifiedAt,
    notes: row.notes,
  };
}
