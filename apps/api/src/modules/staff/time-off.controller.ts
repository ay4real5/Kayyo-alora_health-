import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { DecideTimeOffDto, ListTimeOffQueryDto, RequestTimeOffDto } from './dto/time-off.dto.js';
import { TimeOffService } from './time-off.service.js';

/** Time off requests (D-090). Staff see and manage their own; supervisors (`visits:approve`) see and decide all. */
@ApiTags('staff')
@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOff: TimeOffService) {}

  @Permissions('visits:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListTimeOffQueryDto) {
    return this.timeOff.list(caller, query);
  }

  @Permissions('visits:read')
  @Audit({ action: 'REQUEST_TIME_OFF', resourceType: 'staff_time_off' })
  @Post()
  request(@CurrentUser() caller: AuthUser, @Body() dto: RequestTimeOffDto) {
    return this.timeOff.request(caller, dto);
  }

  @Permissions('visits:read')
  @Audit({ action: 'CANCEL_TIME_OFF', resourceType: 'staff_time_off' })
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.timeOff.cancel(caller, id);
  }

  @Permissions('visits:approve')
  @Audit({ action: 'DECIDE_TIME_OFF', resourceType: 'staff_time_off' })
  @Patch(':id')
  decide(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DecideTimeOffDto) {
    return this.timeOff.decide(caller, id, dto);
  }
}
