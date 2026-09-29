import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { EXPO_PUSH_TOKEN, ListNotificationsQueryDto, NotificationPreferenceDto, RegisterDeviceDto } from './dto/notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

/**
 * The caller's own notification inbox (DESIGN.md §6.10). Every logged-in user has one; no permissions needed,
 * and nobody can see or change anyone else's. Notifications hold no PHI, so these routes aren't audited.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(caller, query);
  }

  /** Which alerts the caller gets, per channel (D-066). */
  @Get('preferences')
  preferences(@CurrentUser() caller: AuthUser) {
    return this.notifications.preferences(caller);
  }

  @Put('preferences/:type')
  setPreference(@CurrentUser() caller: AuthUser, @Param('type') type: string, @Body() dto: NotificationPreferenceDto) {
    return this.notifications.setPreference(caller, type, dto);
  }

  /** Which channels outside the app are connected for this agency (push / SMS / email, D-071). */
  @Get('channels')
  channels() {
    return this.notifications.channels();
  }

  /** The mobile app registers the phone for push notifications after sign-in (D-071). */
  @Post('devices')
  @HttpCode(HttpStatus.OK)
  registerDevice(@CurrentUser() caller: AuthUser, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(caller, dto);
  }

  /** …and removes it on sign-out. */
  @Delete('devices/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregisterDevice(@CurrentUser() caller: AuthUser, @Param('token') token: string) {
    if (EXPO_PUSH_TOKEN.test(token)) await this.notifications.unregisterDevice(caller, token);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() caller: AuthUser) {
    return this.notifications.unreadCount(caller);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.markRead(caller, id);
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() caller: AuthUser) {
    return this.notifications.markAllRead(caller);
  }
}
