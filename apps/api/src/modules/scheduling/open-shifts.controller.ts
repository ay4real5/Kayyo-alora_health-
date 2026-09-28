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
  AssignOpenShiftDto,
  CreateOpenShiftDto,
  CreateShiftSwapDto,
  DecideShiftSwapDto,
  ListOpenShiftsQueryDto,
  ListShiftSwapsQueryDto,
} from './dto/open-shifts.dto.js';
import { OpenShiftsService } from './open-shifts.service.js';
import { ShiftSwapsService } from './shift-swaps.service.js';

/** Open shifts and shift swaps (DESIGN.md §6.5, DECISIONS D-040). */
@ApiTags('schedule')
@Controller('schedule')
export class OpenShiftsController {
  constructor(
    private readonly openShifts: OpenShiftsService,
    private readonly swaps: ShiftSwapsService,
  ) {}

  /** Schedulers: all offers. Caregivers: what they could claim now (area and time only, no patient name). */
  @Permissions('visits:read')
  @Get('open-shifts')
  list(@CurrentUser() caller: AuthUser, @Query() query: ListOpenShiftsQueryDto) {
    return this.openShifts.list(caller, query);
  }

  @Permissions('visits:read')
  @Get('open-shifts/:id')
  get(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.openShifts.get(caller, id);
  }

  /** Offers a scheduled visit; a caregiver already on it is taken off and told. */
  @Permissions('visits:create')
  @Audit({ action: 'CREATE_OPEN_SHIFT' })
  @Post('open-shifts')
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateOpenShiftDto) {
    return this.openShifts.create(caller, dto);
  }

  /** Notifies every eligible caregiver (PHI-free text). */
  @Permissions('notifications:create')
  @Audit({ action: 'BROADCAST_OPEN_SHIFT' })
  @Post('open-shifts/:id/broadcast')
  @HttpCode(HttpStatus.OK)
  broadcast(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.openShifts.broadcast(caller, id);
  }

  /** A caregiver takes the shift: first come, first served; refused on blocking conflicts or expired credentials. */
  @Permissions('visits:read')
  @Audit({ action: 'CLAIM_OPEN_SHIFT' })
  @Post('open-shifts/:id/claim')
  @HttpCode(HttpStatus.OK)
  claim(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.openShifts.claim(caller, id);
  }

  @Permissions('visits:assign')
  @Audit({ action: 'ASSIGN_OPEN_SHIFT' })
  @Post('open-shifts/:id/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @CurrentUser() caller: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignOpenShiftDto,
  ) {
    return this.openShifts.assign(caller, id, dto);
  }

  @Permissions('visits:update')
  @Audit({ action: 'CANCEL_OPEN_SHIFT' })
  @Post('open-shifts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.openShifts.cancel(caller, id);
  }

  /** Schedulers: all requests. Caregivers: the ones they made or are named in. */
  @Permissions('visits:read')
  @Get('shift-swaps')
  listSwaps(@CurrentUser() caller: AuthUser, @Query() query: ListShiftSwapsQueryDto) {
    return this.swaps.list(caller, query);
  }

  /** A caregiver asks to hand one of their upcoming visits to a colleague, or back to the pool. */
  @Permissions('visits:read')
  @Audit({ action: 'REQUEST_SHIFT_SWAP' })
  @Post('shift-swaps')
  requestSwap(@CurrentUser() caller: AuthUser, @Body() dto: CreateShiftSwapDto) {
    return this.swaps.create(caller, dto);
  }

  @Permissions('visits:read')
  @Audit({ action: 'WITHDRAW_SHIFT_SWAP' })
  @Post('shift-swaps/:id/cancel')
  @HttpCode(HttpStatus.OK)
  withdrawSwap(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.swaps.cancel(caller, id);
  }

  /** Approve (the visit moves to the colleague, or becomes an open shift) or deny. Not your own request. */
  @Permissions('visits:approve')
  @Audit({ action: 'DECIDE_SHIFT_SWAP' })
  @Patch('shift-swaps/:id')
  decideSwap(
    @CurrentUser() caller: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideShiftSwapDto,
  ) {
    return this.swaps.decide(caller, id, dto);
  }
}
