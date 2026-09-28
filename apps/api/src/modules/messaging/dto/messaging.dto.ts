import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimmed } from '../../../common/validators/fields.js';

export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_PARTICIPANTS = 50;

export class SendMessageDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  content!: string;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  /** A document the sender can see (uploaded through /documents). */
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

/** Start a conversation with its first message. One other person and no subject/patient reuses the direct thread. */
export class CreateConversationDto extends SendMessageDto {
  /** The other people (the caller is added automatically). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @IsUUID('all', { each: true })
  participantIds!: string[];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  subject?: string;

  /** The patient this is about (the caller must have access to them). */
  @IsOptional()
  @IsUUID()
  patientId?: string;
}

export class ListMessagesQueryDto {
  /** Older than this time (the `createdAt` of the oldest message you have). */
  @IsOptional()
  @IsDateString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListConversationsQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AddParticipantsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class ContactsQueryDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string;
}
