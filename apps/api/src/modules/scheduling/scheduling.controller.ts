import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import {
  CalendarQueryDto,
  CancelVisitDto,
  ConflictCheckQueryDto,
  CreateVisitDto,
  ListVisitsQueryDto,
  SuggestCaregiversDto,
  UpdateVisitDto,
} from './dto/scheduling.dto.js';
import { CaregiverMatchService } from './caregiver-match.service.js';
import { VisitsService } from './visits.service.js';

/** Scheduling (DESIGN.md §6.5). Visit notes, vitals and tasks come with EVV (P2-04). */
@ApiTags('schedule')
@Controller('schedule')
export class SchedulingController {
  constructor(
    private readonly visits: VisitsService,
    private readonly match: CaregiverMatchService,
  ) {}

  @Permissions('visits:read')
  @Get('visits')
  list(@CurrentUser() caller: AuthUser, @Query() query: ListVisitsQueryDto) {
    return this.visits.list(caller, query);
  }

  /**
   * Books a visit. Blocking conflicts return 409 SCHEDULE_CONFLICT with the list in `details`, unless
   * `override: true` (needs visits:approve). Warnings come back in `warnings`.
   */
  @Permissions('visits:create')
  @Audit({ action: 'SCHEDULE_VISIT' })
  @Post('visits')
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateVisitDto) {
    return this.visits.create(caller, dto);
  }

  @Permissions('visits:read')
  @Get('visits/:id')
  get(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.visits.get(caller, id);
  }

  /** Who should take this visit: eligible caregivers ranked, with reasons, and who can't and why (D-094). */
  @Permissions('visits:assign')
  @Get('visits/:id/suggestions')
  suggestionsForVisit(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.match.forVisit(caller, id);
  }

  /** The same for a visit not booked yet (date, times, patient, visit type). */
  @Permissions('visits:assign')
  @Post('suggestions')
  @HttpCode(HttpStatus.OK)
  suggestions(@CurrentUser() caller: AuthUser, @Body() dto: SuggestCaregiversDto) {
    return this.match.suggest(caller, { ...dto, agencyId: caller.agencyId });
  }

  /** Reschedule, reassign (staffId, or null to unassign) or edit a scheduled visit. */
  @Permissions('visits:update')
  @Audit({ action: 'UPDATE_VISIT' })
  @Patch('visits/:id')
  update(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateVisitDto) {
    return this.visits.update(caller, id, dto);
  }

  @Permissions('visits:update')
  @Audit({ action: 'CANCEL_VISIT' })
  @Post('visits/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CancelVisitDto) {
    return this.visits.cancel(caller, id, dto.reason);
  }

  /** Visits grouped by day, every day in [from, to] present (max 62 days). Cancelled visits excluded by default. */
  @Permissions('visits:read')
  @Get('calendar')
  calendar(@CurrentUser() caller: AuthUser, @Query() query: CalendarQueryDto) {
    return this.visits.calendar(caller, query);
  }

  /** Checks a proposed visit against the schedule without saving anything. */
  @Permissions('visits:create')
  @Get('conflicts')
  conflicts(@CurrentUser() caller: AuthUser, @Query() query: ConflictCheckQueryDto) {
    return this.visits.checkConflicts(caller, query);
  }
}
