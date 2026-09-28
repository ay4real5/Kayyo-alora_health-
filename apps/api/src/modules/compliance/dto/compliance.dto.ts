import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { trimmed } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

export const INCIDENT_TYPES = [
  'fall',
  'injury',
  'medication_error',
  'abuse_neglect',
  'complaint',
  'property_damage',
  'infection',
  'privacy_breach',
  'other',
] as const;
export const INCIDENT_SEVERITIES = ['low', 'moderate', 'high', 'critical'] as const;
export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const;

export class CreateIncidentDto {
  @IsIn(INCIDENT_TYPES)
  incidentType!: (typeof INCIDENT_TYPES)[number];

  @IsIn(INCIDENT_SEVERITIES)
  severity!: (typeof INCIDENT_SEVERITIES)[number];

  @IsDateOnly()
  incidentDate!: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'incidentTime must be HH:MM' })
  incidentTime?: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  description!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(10_000)
  actionsTaken?: string;

  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;
}

export class UpdateIncidentDto {
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: (typeof INCIDENT_STATUSES)[number];

  @IsOptional()
  @IsIn(INCIDENT_SEVERITIES)
  severity?: (typeof INCIDENT_SEVERITIES)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(10_000)
  actionsTaken?: string;

  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(10_000)
  followUpNotes?: string;
}

export class ListIncidentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;
}

export class AuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Exact action, e.g. VIEW_PATIENTS, LOGIN_FAILED. */
  @IsOptional()
  @Transform(trimmed)
  @Matches(/^[A-Z0-9_]{2,60}$/, { message: 'action is an UPPER_SNAKE name' })
  action?: string;

  @IsOptional()
  @Transform(trimmed)
  @Matches(/^[a-z_]{2,50}$/, { message: 'resourceType is a lower_snake name, e.g. patients' })
  resourceType?: string;

  /** Everything that happened to one record (e.g. a patient ID). */
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;
}

export class CredentialAlertsQueryDto {
  @IsOptional()
  @Type(() => Number)
  withinDays?: number;
}
