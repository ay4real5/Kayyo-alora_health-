import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import {
  CreateRecurringDto,
  GenerateRecurringDto,
  ListRecurringQueryDto,
  UpdateRecurringDto,
} from './dto/recurring.dto.js';
import { RecurringService } from './recurring.service.js';

/**
 * Recurring visit series (DESIGN.md §6.5). Create/update respond with the rule plus a generation report:
 * `created` visits, `skipped` dates (blocking conflicts) and dates booked with `warnings`.
 */
@ApiTags('schedule')
@Controller('schedule/recurring')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Permissions('visits:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListRecurringQueryDto) {
    return this.recurring.list(caller, query);
  }

  @Permissions('visits:create')
  @Audit({ action: 'CREATE_RECURRING_SCHEDULE', resourceType: 'visits' })
  @Post()
  create(@CurrentUser() caller: AuthUser, @Body() dto: CreateRecurringDto) {
    return this.recurring.create(caller, dto);
  }

  @Permissions('visits:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.recurring.get(caller, id);
  }

  @Permissions('visits:update')
  @Audit({ action: 'UPDATE_RECURRING_SCHEDULE', resourceType: 'visits' })
  @Patch(':id')
  update(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRecurringDto) {
    return this.recurring.update(caller, id, dto);
  }

  /** Ends the series and cancels its future scheduled visits. */
  @Permissions('visits:update')
  @Audit({ action: 'END_RECURRING_SCHEDULE', resourceType: 'visits' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  end(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.recurring.end(caller, id);
  }

  /** Creates occurrences further ahead (default 4 weeks from today). A nightly job will do this automatically. */
  @Permissions('visits:create')
  @Audit({ action: 'GENERATE_RECURRING_VISITS', resourceType: 'visits' })
  @Post(':id/generate')
  @HttpCode(HttpStatus.OK)
  generate(@CurrentUser() caller: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: GenerateRecurringDto) {
    return this.recurring.generate(caller, id, dto.until);
  }
}
