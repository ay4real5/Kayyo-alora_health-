import { REFERRAL_PAYER_TYPES, REFERRAL_SOURCE_TYPES, REFERRAL_STATUSES, GENDERS } from '@alora/shared';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { lowerTrimmed, PHONE, trimmed, upperTrimmed, US_STATE, US_ZIP } from '../../../common/validators/fields.js';
import { IsDateOnly } from '../../../common/validators/is-date-only.js';

/** Fields a referral and the public intake form share. */
class ReferralClientFields {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clientFirstName!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clientLastName!: string;

  @IsOptional()
  @IsDateOnly()
  dateOfBirth?: string;

  @IsOptional()
  @Matches(PHONE)
  phone?: string;

  @IsOptional()
  @Transform(lowerTrimmed)
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Matches(US_ZIP)
  zip?: string;

  @IsOptional()
  @IsIn(REFERRAL_PAYER_TYPES)
  payerType?: (typeof REFERRAL_PAYER_TYPES)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(4000)
  careNeeds?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  contactRelationship?: string;

  @IsOptional()
  @Matches(PHONE)
  contactPhone?: string;

  @IsOptional()
  @Transform(lowerTrimmed)
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;
}

export class CreateReferralDto extends ReferralClientFields {
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @IsOptional()
  @IsDateOnly()
  nextFollowUp?: string;
}

/** Every field optional; null clears the source, assignee or follow-up date. */
export class UpdateReferralDto {
  @IsOptional() @Transform(trimmed) @IsString() @IsNotEmpty() @MaxLength(100) clientFirstName?: string;
  @IsOptional() @Transform(trimmed) @IsString() @IsNotEmpty() @MaxLength(100) clientLastName?: string;
  @IsOptional() @IsDateOnly() dateOfBirth?: string;
  @IsOptional() @Matches(PHONE) phone?: string;
  @IsOptional() @Transform(lowerTrimmed) @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) city?: string;
  @IsOptional() @Matches(US_ZIP) zip?: string;
  @IsOptional() @IsIn(REFERRAL_PAYER_TYPES) payerType?: (typeof REFERRAL_PAYER_TYPES)[number];
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(4000) careNeeds?: string;
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(200) contactName?: string;
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(50) contactRelationship?: string;
  @IsOptional() @Matches(PHONE) contactPhone?: string;
  @IsOptional() @Transform(lowerTrimmed) @IsEmail() @MaxLength(255) contactEmail?: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsUUID() sourceId?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsUUID() assignedToId?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsDateOnly() nextFollowUp?: string | null;
}

/** Move along the pipeline (not to `admitted` — use admit, which creates the patient). */
export class ReferralStatusDto {
  @IsIn(REFERRAL_STATUSES.filter((s) => s !== 'admitted'))
  status!: Exclude<(typeof REFERRAL_STATUSES)[number], 'admitted'>;

  /** Required when the status is `lost`. */
  @ValidateIf((o: ReferralStatusDto) => o.status === 'lost')
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  lostReason?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class ReferralNoteDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}

/** What admission needs that a referral may not have yet. Everything else is copied from the referral. */
export class AdmitReferralDto {
  /** Required unless the referral already has one. */
  @IsOptional()
  @IsDateOnly()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @Transform(upperTrimmed)
  @Matches(US_STATE)
  state?: string;

  @IsOptional()
  @IsDateOnly()
  admissionDate?: string;
}

export class ListReferralsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn([...REFERRAL_STATUSES, 'open'])
  status?: (typeof REFERRAL_STATUSES)[number] | 'open';

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  /** Name, phone or email contains. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ReferralSourceDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsIn(REFERRAL_SOURCE_TYPES)
  sourceType!: (typeof REFERRAL_SOURCE_TYPES)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @Matches(PHONE)
  phone?: string;

  @IsOptional()
  @Transform(lowerTrimmed)
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

export class UpdateReferralSourceDto {
  @IsOptional() @Transform(trimmed) @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsIn(REFERRAL_SOURCE_TYPES) sourceType?: (typeof REFERRAL_SOURCE_TYPES)[number];
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(200) contactName?: string;
  @IsOptional() @Matches(PHONE) phone?: string;
  @IsOptional() @Transform(lowerTrimmed) @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SourcesReportQueryDto {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;
}

/**
 * The public "I need care" form (D-098). Minimal on purpose: enough for the office to call back. `website` is a
 * honeypot that people never see — bots fill it in.
 */
export class IntakeDto extends ReferralClientFields {
  /** Who is filling in the form: the person needing care, or someone on their behalf. */
  @IsIn(['self', 'someone_else'])
  submittedBy!: 'self' | 'someone_else';

  @Equals(true, { message: 'Please agree to be contacted' })
  consent!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
