import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { lowerTrimmed, trimmed } from '../../../common/validators/fields.js';
import { MAX_MESSAGE_LENGTH } from '../../messaging/dto/messaging.dto.js';

/** Give a family member (or the patient) portal access (D-058). */
export class GrantPortalAccessDto {
  @Transform(lowerTrimmed)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;
}

export class PortalMessageDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  content!: string;
}
