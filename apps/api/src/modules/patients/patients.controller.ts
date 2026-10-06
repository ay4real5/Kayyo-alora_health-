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
import {
  CaregiverPreferenceDto,
  CreateAllergyDto,
  CreateDiagnosisDto,
  CreatePatientDto,
  DischargePatientDto,
  ListPatientsQueryDto,
  ReadmitPatientDto,
  UpdatePatientDto,
} from './dto/patients.dto.js';
import { PatientsService } from './patients.service.js';

const uuid = () => new ParseUUIDPipe();

/**
 * Patients (DESIGN.md §6.3). Every route is PHI: all are permission-guarded and audited automatically.
 * Which patients a caller sees is decided in PatientsService.scope (DECISIONS D-027).
 */
@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Permissions('patients:read')
  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListPatientsQueryDto) {
    return this.patients.list(caller, query);
  }

  @Permissions('patients:create')
  @Audit({ action: 'ADMIT_PATIENT' })
  @Post()
  admit(@CurrentUser() caller: AuthUser, @Body() dto: CreatePatientDto) {
    return this.patients.admit(caller, dto);
  }

  @Permissions('patients:read')
  @Get(':id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.patients.get(caller, id);
  }

  @Permissions('patients:update')
  @Patch(':id')
  update(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: UpdatePatientDto) {
    return this.patients.update(caller, id, dto);
  }

  @Permissions('patients:update')
  @Audit({ action: 'DISCHARGE_PATIENT' })
  @Post(':id/discharge')
  @HttpCode(HttpStatus.OK)
  discharge(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: DischargePatientDto) {
    return this.patients.discharge(caller, id, dto.dischargeDate);
  }

  @Permissions('patients:update')
  @Audit({ action: 'READMIT_PATIENT' })
  @Post(':id/readmit')
  @HttpCode(HttpStatus.OK)
  readmit(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: ReadmitPatientDto) {
    return this.patients.readmit(caller, id, dto.admissionDate);
  }

  @Permissions('patients:read')
  @Get(':id/caregiver-preferences')
  caregiverPreferences(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.patients.listCaregiverPreferences(caller, id);
  }

  /** Prefer or decline a caregiver for this patient (D-094); declined caregivers are never suggested. */
  @Permissions('patients:update')
  @Audit({ action: 'SET_CAREGIVER_PREFERENCE', resourceType: 'patients' })
  @Put(':id/caregiver-preferences/:staffId')
  setCaregiverPreference(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('staffId', uuid()) staffId: string,
    @Body() dto: CaregiverPreferenceDto,
  ) {
    return this.patients.setCaregiverPreference(caller, id, staffId, dto);
  }

  @Permissions('patients:update')
  @Audit({ action: 'REMOVE_CAREGIVER_PREFERENCE', resourceType: 'patients' })
  @Delete(':id/caregiver-preferences/:staffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCaregiverPreference(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Param('staffId', uuid()) staffId: string) {
    await this.patients.removeCaregiverPreference(caller, id, staffId);
  }

  @Permissions('patients:read')
  @Audit({ action: 'VIEW_PATIENT_DIAGNOSES', resourceType: 'patients' })
  @Get(':id/diagnoses')
  diagnoses(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.patients.listDiagnoses(caller, id);
  }

  @Permissions('patients:update')
  @Audit({ action: 'ADD_PATIENT_DIAGNOSIS', resourceType: 'patients' })
  @Post(':id/diagnoses')
  addDiagnosis(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: CreateDiagnosisDto) {
    return this.patients.addDiagnosis(caller, id, dto);
  }

  @Permissions('patients:update')
  @Audit({ action: 'REMOVE_PATIENT_DIAGNOSIS', resourceType: 'patients' })
  @Delete(':id/diagnoses/:diagnosisId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDiagnosis(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('diagnosisId', uuid()) diagnosisId: string,
  ): Promise<void> {
    await this.patients.removeDiagnosis(caller, id, diagnosisId);
  }

  @Permissions('patients:read')
  @Audit({ action: 'VIEW_PATIENT_ALLERGIES', resourceType: 'patients' })
  @Get(':id/allergies')
  allergies(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.patients.listAllergies(caller, id);
  }

  @Permissions('patients:update')
  @Audit({ action: 'ADD_PATIENT_ALLERGY', resourceType: 'patients' })
  @Post(':id/allergies')
  addAllergy(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: CreateAllergyDto) {
    return this.patients.addAllergy(caller, id, dto);
  }

  @Permissions('patients:update')
  @Audit({ action: 'REMOVE_PATIENT_ALLERGY', resourceType: 'patients' })
  @Delete(':id/allergies/:allergyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAllergy(
    @CurrentUser() caller: AuthUser,
    @Param('id', uuid()) id: string,
    @Param('allergyId', uuid()) allergyId: string,
  ): Promise<void> {
    await this.patients.removeAllergy(caller, id, allergyId);
  }
}
