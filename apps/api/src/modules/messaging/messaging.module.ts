import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import {
  AddParticipantsDto,
  ContactsQueryDto,
  CreateConversationDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './dto/messaging.dto.js';
import { MessagingService } from './messaging.service.js';

const uuid = () => new ParseUUIDPipe();

/** Secure staff messaging (DESIGN.md §6.13, DECISIONS D-057). Participants only; others get 404. */
@ApiTags('messages')
@Permissions('messages:use')
@Controller('messages')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  /** Who the caller can message (active staff in the agency). */
  @Get('contacts')
  contacts(@CurrentUser() caller: AuthUser, @Query() query: ContactsQueryDto) {
    return this.messaging.contacts(caller, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() caller: AuthUser) {
    return this.messaging.unreadCount(caller);
  }

  @Get('conversations')
  list(@CurrentUser() caller: AuthUser, @Query() query: ListConversationsQueryDto) {
    return this.messaging.list(caller, query);
  }

  @Audit({ action: 'START_CONVERSATION', resourceType: 'conversations' })
  @Post('conversations')
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateConversationDto) {
    return this.messaging.create(caller, dto);
  }

  @Get('conversations/:id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.messaging.get(caller, id);
  }

  /** Newest first; page back with `before`. */
  @Get('conversations/:id/messages')
  messages(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Query() query: ListMessagesQueryDto) {
    return this.messaging.messages(caller, id, query);
  }

  @Audit({ action: 'SEND_MESSAGE', resourceType: 'conversations' })
  @Post('conversations/:id/messages')
  send(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: SendMessageDto) {
    return this.messaging.send(caller, id, dto);
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.messaging.markRead(caller, id);
  }

  @Post('conversations/:id/participants')
  @HttpCode(HttpStatus.OK)
  addParticipants(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: AddParticipantsDto) {
    return this.messaging.addParticipants(caller, id, dto.userIds);
  }

  @Post('conversations/:id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.messaging.leave(caller, id);
  }
}

@Module({
  imports: [PatientsModule, DocumentsModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
