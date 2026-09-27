import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { ListNotificationsQueryDto } from './dto/notifications.dto.js';
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
