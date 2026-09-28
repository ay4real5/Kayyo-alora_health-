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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import {
  AddTasksDto,
  CreateVisitNoteDto,
  CreateVitalsDto,
  EnteredInErrorDto,
  UpdateTaskDto,
  UpdateVisitNoteDto,
} from './dto/visit-docs.dto.js';
import { VisitDocsService } from './visit-docs.service.js';

const visitId = () => new ParseUUIDPipe();

/**
 * Visit documentation (DESIGN.md §6.5, DECISIONS D-039). Reads follow visit access; writes are the visit's own
 * caregiver's, once clocked in. Audit entries are keyed to the visit.
 */
@ApiTags('visit documentation')
@Controller('schedule/visits/:visitId')
export class VisitDocsController {
  constructor(private readonly docs: VisitDocsService) {}

  @Permissions('visits:read')
  @Audit({ action: 'VIEW_VISIT_NOTES', resourceType: 'visits', idParam: 'visitId' })
  @Get('notes')
  listNotes(@CurrentUser() caller: AuthUser, @Param('visitId', visitId()) id: string) {
    return this.docs.listNotes(caller, id);
  }

  @Permissions('visit_notes:create')
  @Audit({ action: 'CREATE_VISIT_NOTE', resourceType: 'visits', idParam: 'visitId' })
  @Post('notes')
  createNote(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Body() dto: CreateVisitNoteDto,
  ) {
    return this.docs.createNote(caller, id, dto);
  }

  /** Drafts only, by their author. */
  @Permissions('visit_notes:update')
  @Audit({ action: 'UPDATE_VISIT_NOTE', idParam: 'noteId' })
  @Patch('notes/:noteId')
  updateNote(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
    @Body() dto: UpdateVisitNoteDto,
  ) {
    return this.docs.updateNote(caller, id, noteId, dto);
  }

  /** Discards a draft (author only). */
  @Permissions('visit_notes:update')
  @Audit({ action: 'DELETE_VISIT_NOTE', idParam: 'noteId' })
  @Delete('notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteNote(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ) {
    return this.docs.deleteNote(caller, id, noteId);
  }

  /** Clinician signature; the note is locked afterwards (amend with an addendum). */
  @Permissions('visit_notes:sign')
  @Audit({ action: 'SIGN_VISIT_NOTE', idParam: 'noteId' })
  @Post('notes/:noteId/sign')
  @HttpCode(HttpStatus.OK)
  signNote(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ) {
    return this.docs.signNote(caller, id, noteId);
  }

  /** Finalises a note without a clinical signature (aides); locked afterwards. */
  @Permissions('visit_notes:create')
  @Audit({ action: 'SUBMIT_VISIT_NOTE', idParam: 'noteId' })
  @Post('notes/:noteId/submit')
  @HttpCode(HttpStatus.OK)
  submitNote(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ) {
    return this.docs.submitNote(caller, id, noteId);
  }

  @Permissions('visits:read')
  @Audit({ action: 'VIEW_VITALS', resourceType: 'visits', idParam: 'visitId' })
  @Get('vitals')
  listVitals(@CurrentUser() caller: AuthUser, @Param('visitId', visitId()) id: string) {
    return this.docs.listVitals(caller, id);
  }

  @Permissions('vitals:create')
  @Audit({ action: 'RECORD_VITALS', resourceType: 'visits', idParam: 'visitId' })
  @Post('vitals')
  recordVitals(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Body() dto: CreateVitalsDto,
  ) {
    return this.docs.recordVitals(caller, id, dto);
  }

  /** Vitals are never edited; a wrong entry is marked (by its recorder or a supervisor) and stays visible. */
  @Permissions('vitals:create')
  @Audit({ action: 'VITALS_ENTERED_IN_ERROR', idParam: 'vitalId' })
  @Post('vitals/:vitalId/entered-in-error')
  @HttpCode(HttpStatus.OK)
  markVitalInError(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Param('vitalId', new ParseUUIDPipe()) vitalId: string,
    @Body() dto: EnteredInErrorDto,
  ) {
    return this.docs.markVitalInError(caller, id, vitalId, dto.reason);
  }

  @Permissions('visits:read')
  @Audit({ action: 'VIEW_VISIT_TASKS', resourceType: 'visits', idParam: 'visitId' })
  @Get('tasks')
  listTasks(@CurrentUser() caller: AuthUser, @Param('visitId', visitId()) id: string) {
    return this.docs.listTasks(caller, id);
  }

  /** Office: adds checklist items to a scheduled or in-progress visit. Returns the whole checklist. */
  @Permissions('visits:update')
  @Audit({ action: 'ADD_VISIT_TASKS', resourceType: 'visits', idParam: 'visitId' })
  @Post('tasks')
  addTasks(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Body() dto: AddTasksDto,
  ) {
    return this.docs.addTasks(caller, id, dto);
  }

  /** Office: removes a task the caregiver hasn't recorded yet. */
  @Permissions('visits:update')
  @Audit({ action: 'REMOVE_VISIT_TASK', resourceType: 'visit_tasks', idParam: 'taskId' })
  @Delete('tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTask(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
  ) {
    return this.docs.removeTask(caller, id, taskId);
  }

  /** Caregiver: done, not done (with a reason), or back to open. */
  @Permissions('visit_notes:update')
  @Audit({ action: 'UPDATE_VISIT_TASK', resourceType: 'visit_tasks', idParam: 'taskId' })
  @Patch('tasks/:taskId')
  updateTask(
    @CurrentUser() caller: AuthUser,
    @Param('visitId', visitId()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.docs.updateTask(caller, id, taskId, dto);
  }
}
