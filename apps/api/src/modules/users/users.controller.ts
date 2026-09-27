import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/users.dto.js';
import { UsersService } from './users.service.js';

const id = () => new ParseUUIDPipe({ version: undefined });

/** Agency user administration (DESIGN.md §6.2). All actions are scoped to the caller's agency. */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Permissions('users:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListUsersQueryDto) {
    return this.users.list(caller, query);
  }

  @Permissions('users:create')
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(caller, dto);
  }

  @Permissions('users:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', id()) userId: string) {
    return this.users.get(caller, userId);
  }

  @Permissions('users:update')
  @Patch(':id')
  update(@CurrentUser() caller: AuthUser, @Param('id', id()) userId: string, @Body() dto: UpdateUserDto) {
    return this.users.update(caller, userId, dto);
  }

  /** Deactivates (never deletes) — accounts and their audit history are kept. */
  @Permissions('users:delete')
  @Audit({ action: 'DEACTIVATE_USER' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@CurrentUser() caller: AuthUser, @Param('id', id()) userId: string): Promise<void> {
    await this.users.deactivate(caller, userId);
  }

  @Permissions('users:update')
  @Audit({ action: 'REACTIVATE_USER' })
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentUser() caller: AuthUser, @Param('id', id()) userId: string) {
    return this.users.reactivate(caller, userId);
  }

  @Permissions('users:update')
  @Audit({ action: 'UNLOCK_USER' })
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(@CurrentUser() caller: AuthUser, @Param('id', id()) userId: string) {
    return this.users.unlock(caller, userId);
  }

  @Permissions('users:update')
  @Audit({ action: 'RESET_USER_2FA' })
  @Post(':id/reset-2fa')
  @HttpCode(HttpStatus.OK)
  resetTwoFactor(@CurrentUser() caller: AuthUser, @Param('id', id()) userId: string) {
    return this.users.resetTwoFactor(caller, userId);
  }

  @Permissions('users:read', 'audit_logs:read')
  @Audit({ action: 'VIEW_USER_ACTIVITY' })
  @Get(':id/activity')
  activity(@CurrentUser() caller: AuthUser, @Param('id', id()) userId: string, @Query() query: PaginationQueryDto) {
    return this.users.activity(caller, userId, query);
  }
}
