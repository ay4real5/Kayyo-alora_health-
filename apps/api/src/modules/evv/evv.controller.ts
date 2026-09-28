import {
  Body,
  Controller,
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
import {
  ClockDto,
  CreateEvvExceptionDto,
  DecideEvvExceptionDto,
  ListEvvQueryDto,
  RejectEvvDto,
  VerifyEvvDto,
} from './dto/evv.dto.js';
import { EvvService } from './evv.service.js';

/** EVV (DESIGN.md §6.6, DECISIONS D-038). Telephony (IVR), the live monitor and aggregator export come later. */
@ApiTags('evv')
@Controller('evv')
export class EvvController {
  constructor(private readonly evv: EvvService) {}

  /**
   * Clock into your own scheduled visit with the device's GPS reading. Never refused for location or timing —
   * those are flagged for review. Refused if the visit isn't yours, isn't scheduled, or is far from this time.
   */
  @Permissions('visits:read')
  @Audit({ action: 'EVV_CLOCK_IN', resourceType: 'evv' })
  @Post('clock-in')
  @HttpCode(HttpStatus.OK)
  clockIn(@CurrentUser() caller: AuthUser, @Body() dto: ClockDto) {
    return this.evv.clockIn(caller, dto);
  }

  /** Clock out of the visit you're clocked into. Flags make the record `exception` instead of `completed`. */
  @Permissions('visits:read')
  @Audit({ action: 'EVV_CLOCK_OUT', resourceType: 'evv' })
  @Post('clock-out')
  @HttpCode(HttpStatus.OK)
  clockOut(@CurrentUser() caller: AuthUser, @Body() dto: ClockDto) {
    return this.evv.clockOut(caller, dto);
  }

  /** Today's live picture for the monitor: active visits (with map points), late/no-show, unassigned, counts. */
  @Permissions('evv:read')
  @Audit({ action: 'VIEW_LIVE_MONITOR', resourceType: 'evv' })
  @Get('live')
  live(@CurrentUser() caller: AuthUser) {
    return this.evv.live(caller);
  }

  @Permissions('evv:read')
  @Get('records')
  list(@CurrentUser() caller: AuthUser, @Query() query: ListEvvQueryDto) {
    return this.evv.list(caller, query);
  }

  @Permissions('evv:read')
  @Get('records/:id')
  get(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.evv.get(caller, id);
  }

  /** Confirms a completed/exception record. Not your own visit; no pending corrections. */
  @Permissions('evv:approve')
  @Audit({ action: 'VERIFY_EVV' })
  @Post('records/:id/verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @CurrentUser() caller: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyEvvDto,
  ) {
    return this.evv.verify(caller, id, dto.note);
  }

  /** Rejects a record (it won't be billed or paid). A note is required. */
  @Permissions('evv:approve')
  @Audit({ action: 'REJECT_EVV' })
  @Post('records/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() caller: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectEvvDto,
  ) {
    return this.evv.reject(caller, id, dto.note);
  }

  /** Files a clock-in/out time correction with a reason. Applied only when someone else approves it. */
  @Permissions('evv:update')
  @Audit({ action: 'REQUEST_EVV_CORRECTION' })
  @Post('records/:id/exception')
  createException(
    @CurrentUser() caller: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateEvvExceptionDto,
  ) {
    return this.evv.createException(caller, id, dto);
  }

  @Permissions('evv:approve')
  @Audit({ action: 'DECIDE_EVV_CORRECTION', resourceType: 'evv_exceptions' })
  @Patch('exceptions/:id')
  decideException(
    @CurrentUser() caller: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideEvvExceptionDto,
  ) {
    return this.evv.decideException(caller, id, dto.status);
  }
}
