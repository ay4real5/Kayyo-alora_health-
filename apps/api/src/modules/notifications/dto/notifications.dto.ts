import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  /** Only unread notifications. */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unreadOnly?: boolean;
}

/** Channels to change for one notification type; omitted ones stay as they are (D-066). */
export class NotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

/** An Expo push token from the mobile app (D-071). */
export const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;

export class RegisterDeviceDto {
  @Matches(EXPO_PUSH_TOKEN, { message: 'token must be an Expo push token' })
  token!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}
