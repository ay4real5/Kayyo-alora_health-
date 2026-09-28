import { Injectable } from '@nestjs/common';
import { todayInTimeZone } from '@alora/shared';
import { toDate } from '../common/utils/dates.js';
import { PrismaService } from './prisma.service.js';

/**
 * "Today" for an agency, in the agency's own timezone (agencies.timezone). Every business date default — admission,
 * discharge, termination, credential expiry state, scheduling — must use this, never UTC (DECISIONS D-036).
 */
@Injectable()
export class AgencyClockService {
  private readonly zones = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async todayString(agencyId: string): Promise<string> {
    return todayInTimeZone(await this.timezone(agencyId));
  }

  async today(agencyId: string): Promise<Date> {
    return toDate(await this.todayString(agencyId))!;
  }

  private async timezone(agencyId: string): Promise<string> {
    const cached = this.zones.get(agencyId);
    if (cached) return cached;
    const agency = await this.prisma.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { timezone: true } });
    this.zones.set(agencyId, agency.timezone);
    return agency.timezone;
  }
}
