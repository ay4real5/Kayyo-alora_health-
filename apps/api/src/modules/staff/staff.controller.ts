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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { CredentialsService } from './credentials.service.js';
import {
  CreateCredentialDto,
  CreateStaffDto,
  CreateTimeOffDto,
  DecideTimeOffDto,
  ExpiringCredentialsQueryDto,
  ListStaffQueryDto,
  SetAvailabilityDto,
  TerminateStaffDto,
  UpdateCredentialDto,
  UpdateStaffDto,
} from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

const uuid = () => new ParseUUIDPipe();

/**
 * Staff (DESIGN.md §6.4). Routes without @Permissions allow the staff member themselves OR a holder of the
 * permission named in their service call ("self" rules, DECISIONS D-029); those carry @Audit so they are
 * still audited. Fixed paths (me, expiring-credentials, candidates) must stay above ':id'.
 */
@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly credentials: CredentialsService,
  ) {}

  @Permissions('staff:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListStaffQueryDto) {
    return this.staff.list(caller, query);
  }

  /** The caller's own staff profile (including their pay details). For the mobile app. */
  @Audit({ action: 'VIEW_OWN_STAFF_PROFILE', resourceType: 'staff' })
  @Get('me')
  me(@CurrentUser() caller: AuthUser) {
    return this.staff.me(caller);
  }

  @Permissions('staff:read')
  @Get('expiring-credentials')
  expiring(@CurrentUser() caller: AuthUser, @Query() query: ExpiringCredentialsQueryDto) {
    return this.credentials.expiring(caller, query.withinDays);
  }

  /** Users who can be given a staff profile (active, no profile yet). */
  @Permissions('staff:create')
  @Get('candidates')
  candidates(@CurrentUser() caller: AuthUser) {
    return this.staff.candidates(caller);
  }

  @Permissions('staff:create')
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(caller, dto);
  }

  /** Self, or staff:read. */
  @Audit({ action: 'VIEW_STAFF', resourceType: 'staff' })
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.staff.get(caller, id);
  }

  @Permissions('staff:update')
  @Patch(':id')
  update(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(caller, id, dto);
  }

  /** Ends employment: inactive + termination date. Profiles are never deleted. */
  @Permissions('staff:delete')
  @Audit({ action: 'TERMINATE_STAFF' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  terminate(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: TerminateStaffDto) {
    return this.staff.terminate(caller, id, dto.terminationDate);
  }

  /** Self, or staff:read. */
  @Audit({ action: 'VIEW_STAFF_CREDENTIALS', resourceType: 'staff' })
  @Get(':id/credentials')
  listCredentials(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.credentials.list(caller, id);
  }

  @Permissions('staff:update')
  @Audit({ action: 'ADD_STAFF_CREDENTIAL' })
  @Post(':id/credentials')
  addCredential(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: CreateCredentialDto) {
    return this.credentials.add(caller, id, dto);
  }

  @Permissions('staff:update')
  @Audit({ action: 'UPDATE_STAFF_CREDENTIAL' })
  @Patch(':id/credentials/:credentialId')
  updateCredential(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('credentialId', uuid()) credentialId: string,
    @Body() dto: UpdateCredentialDto,
  ) {
    return this.credentials.update(caller, id, credentialId, dto);
  }

  @Permissions('staff:update')
  @Audit({ action: 'REMOVE_STAFF_CREDENTIAL' })
  @Delete(':id/credentials/:credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCredential(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('credentialId', uuid()) credentialId: string,
  ): Promise<void> {
    await this.credentials.remove(caller, id, credentialId);
  }

  /** Self, or staff:read. */
  @Audit({ action: 'VIEW_STAFF_AVAILABILITY', resourceType: 'staff' })
  @Get(':id/availability')
  getAvailability(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.staff.getAvailability(caller, id);
  }

  /** Self, or staff:update. Replaces the whole weekly schedule. */
  @Audit({ action: 'SET_STAFF_AVAILABILITY', resourceType: 'staff' })
  @Put(':id/availability')
  setAvailability(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: SetAvailabilityDto) {
    return this.staff.setAvailability(caller, id, dto);
  }

  /** Self, or staff:read. */
  @Audit({ action: 'VIEW_STAFF_TIME_OFF', resourceType: 'staff' })
  @Get(':id/time-off')
  listTimeOff(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.staff.listTimeOff(caller, id);
  }

  /** Self, or staff:update. */
  @Audit({ action: 'REQUEST_TIME_OFF', resourceType: 'staff' })
  @Post(':id/time-off')
  requestTimeOff(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: CreateTimeOffDto) {
    return this.staff.requestTimeOff(caller, id, dto);
  }

  /** approved/denied need time_off:approve (not for your own request); cancelled: self or staff:update. */
  @Audit({ action: 'DECIDE_TIME_OFF', resourceType: 'staff' })
  @Patch(':id/time-off/:timeOffId')
  decideTimeOff(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('timeOffId', uuid()) timeOffId: string,
    @Body() dto: DecideTimeOffDto,
  ) {
    return this.staff.decideTimeOff(caller, id, timeOffId, dto.status);
  }
}
