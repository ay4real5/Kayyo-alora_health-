import { Body, Controller, Get, Injectable, Module, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { PHONE, trimmed, upperTrimmed, US_STATE, US_ZIP } from '../../common/validators/fields.js';
import { IsNpi } from '../../common/validators/is-npi.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { recognitionEnabled } from '../insights/workforce.service.js';

export class UpdateAgencyDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNpi()
  npi?: string;

  /** Employer Identification Number, 9 digits (with or without the dash). */
  @IsOptional()
  @Matches(/^\d{2}-?\d{7}$/, { message: 'taxId must be an EIN like 12-3456789' })
  taxId?: string;

  @IsOptional()
  @Matches(PHONE)
  phone?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(US_STATE)
  state?: string;

  /** ZIP+4 is needed for electronic claims. */
  @IsOptional()
  @Matches(US_ZIP)
  zip?: string;

  /** Show caregivers recognition badges in the app (D-097). Off by default. */
  @IsOptional()
  @IsBoolean()
  recognitionBadges?: boolean;
}

export interface AgencyView {
  id: string;
  name: string;
  npi: string | null;
  taxId: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timezone: string;
  recognitionBadges: boolean;
}

const SELECT = {
  id: true,
  name: true,
  npi: true,
  taxId: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  zip: true,
  timezone: true,
  settings: true,
} as const;

const isObject = (v: unknown): v is Prisma.JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function view({ settings, ...agency }: Prisma.AgencyGetPayload<{ select: typeof SELECT }>): AgencyView {
  return { ...agency, recognitionBadges: recognitionEnabled(settings) };
}

/**
 * The caller's agency profile (DECISIONS D-053): name, NPI, EIN, address — what claims are billed under. The timezone
 * is not editable here (it changes what "today" means for every date already recorded).
 */
@Injectable()
export class AgencyService {
  constructor(private readonly prisma: PrismaService) {}

  async get(caller: AuthUser): Promise<AgencyView> {
    return view(await this.prisma.agency.findUniqueOrThrow({ where: { id: caller.agencyId }, select: SELECT }));
  }

  /** An NPI already used by another agency → 409 (unique). */
  async update(caller: AuthUser, dto: UpdateAgencyDto): Promise<AgencyView> {
    const { recognitionBadges, ...fields } = dto;
    let settings: Prisma.InputJsonObject | undefined;
    if (recognitionBadges !== undefined) {
      const current = await this.prisma.agency.findUniqueOrThrow({ where: { id: caller.agencyId }, select: { settings: true } });
      settings = { ...(isObject(current.settings) ? current.settings : {}), recognitionBadges };
    }
    return view(await this.prisma.agency.update({ where: { id: caller.agencyId }, data: { ...fields, ...(settings ? { settings } : {}) }, select: SELECT }));
  }
}

@ApiTags('agency')
@Controller('agency')
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  @Permissions('settings:read')
  @Get()
  get(@CurrentUser() caller: AuthUser) {
    return this.agency.get(caller);
  }

  @Permissions('settings:update')
  @Audit({ action: 'UPDATE_AGENCY', resourceType: 'agency' })
  @Patch()
  update(@CurrentUser() caller: AuthUser, @Body() dto: UpdateAgencyDto) {
    return this.agency.update(caller, dto);
  }
}

@Module({ controllers: [AgencyController], providers: [AgencyService], exports: [AgencyService] })
export class AgencyModule {}
