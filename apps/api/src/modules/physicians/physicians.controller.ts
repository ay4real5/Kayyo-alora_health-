import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { CreatePhysicianDto, ListPhysiciansQueryDto, UpdatePhysicianDto } from './dto/physicians.dto.js';
import { PhysiciansService } from './physicians.service.js';

/**
 * Physicians directory. No delete: physicians are referenced by patients, orders and care plans, so
 * they're deactivated instead (PATCH isActive=false).
 */
@ApiTags('physicians')
@Controller('physicians')
export class PhysiciansController {
  constructor(private readonly physicians: PhysiciansService) {}

  @Permissions('physicians:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListPhysiciansQueryDto) {
    return this.physicians.list(caller, query);
  }

  @Permissions('physicians:create')
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreatePhysicianDto) {
    return this.physicians.create(caller, dto);
  }

  @Permissions('physicians:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.physicians.get(caller, id);
  }

  @Permissions('physicians:update')
  @Patch(':id')
  update(
    @CurrentUser() caller: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePhysicianDto,
  ) {
    return this.physicians.update(caller, id, dto);
  }
}
