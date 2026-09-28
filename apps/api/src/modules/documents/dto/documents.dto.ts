import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { trimmed } from '../../../common/validators/fields.js';

export const DOCUMENT_TYPES = [
  'consent',
  'care_plan',
  'physician_order',
  'assessment',
  'insurance_card',
  'identification',
  'credential',
  'policy',
  'correspondence',
  'other',
] as const;

/** Multipart form fields sent with the file (DECISIONS D-056). */
export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  documentType!: (typeof DOCUMENT_TYPES)[number];

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  /** Upload as a new version of this document (inherits its links and type). */
  @IsOptional()
  @IsUUID()
  replacesDocumentId?: string;
}

export class ListDocumentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeDeleted?: boolean;
}

export class SignDocumentDto {
  /** The signer types their full name (the e-signature). */
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  typedName!: string;
}

export class DeleteDocumentDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
