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
import { ClinicalService } from './clinical.service.js';
import {
  ActivateCarePlanDto,
  ApproveAssessmentDto,
  AssessmentDto,
  CarePlanDto,
  DiscontinueMedicationDto,
  ListAssessmentsQueryDto,
  ListMedicationsQueryDto,
  MedicationDto,
  OrderStatusDto,
  PhysicianOrderDto,
  UpdateAssessmentDto,
  UpdateCarePlanDto,
  UpdateMedicationDto,
} from './dto/clinical.dto.js';

const uuid = () => new ParseUUIDPipe();

/**
 * Clinical records under a patient (DESIGN.md §6.2, DECISIONS D-055). Reads: `patients:read` + patient access.
 * Writes: `medications:manage`, `orders:*`, `care_plans:*`, `assessments:*`. Audit entries are keyed to the patient.
 */
@ApiTags('clinical')
@Controller('patients/:patientId')
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  // Medications
  @Permissions('patients:read')
  @Audit({ action: 'VIEW_MEDICATIONS', resourceType: 'patients', idParam: 'patientId' })
  @Get('medications')
  listMedications(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Query() query: ListMedicationsQueryDto,
  ) {
    return this.clinical.listMedications(caller, patientId, query.includeInactive);
  }

  @Permissions('medications:manage')
  @Audit({ action: 'ADD_MEDICATION', resourceType: 'patients', idParam: 'patientId' })
  @Post('medications')
  addMedication(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Body() dto: MedicationDto,
  ) {
    return this.clinical.addMedication(caller, patientId, dto);
  }

  @Permissions('medications:manage')
  @Audit({ action: 'UPDATE_MEDICATION', resourceType: 'medications' })
  @Patch('medications/:id')
  updateMedication(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateMedicationDto,
  ) {
    return this.clinical.updateMedication(caller, patientId, id, dto);
  }

  @Permissions('medications:manage')
  @Audit({ action: 'DISCONTINUE_MEDICATION', resourceType: 'medications' })
  @Post('medications/:id/discontinue')
  @HttpCode(HttpStatus.OK)
  discontinueMedication(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: DiscontinueMedicationDto,
  ) {
    return this.clinical.discontinueMedication(caller, patientId, id, dto);
  }

  // Physician orders
  @Permissions('patients:read')
  @Audit({ action: 'VIEW_ORDERS', resourceType: 'patients', idParam: 'patientId' })
  @Get('orders')
  listOrders(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.clinical.listOrders(caller, patientId);
  }

  @Permissions('orders:create')
  @Audit({ action: 'CREATE_ORDER', resourceType: 'patients', idParam: 'patientId' })
  @Post('orders')
  createOrder(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Body() dto: PhysicianOrderDto,
  ) {
    return this.clinical.createOrder(caller, patientId, dto);
  }

  /** pending → sent → signed; cancel before signed. */
  @Permissions('orders:update')
  @Audit({ action: 'UPDATE_ORDER_STATUS', resourceType: 'physician_orders' })
  @Post('orders/:id/status')
  @HttpCode(HttpStatus.OK)
  setOrderStatus(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: OrderStatusDto,
  ) {
    return this.clinical.setOrderStatus(caller, patientId, id, dto);
  }

  // Care plans
  @Permissions('patients:read')
  @Audit({ action: 'VIEW_CARE_PLANS', resourceType: 'patients', idParam: 'patientId' })
  @Get('care-plans')
  listCarePlans(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.clinical.listCarePlans(caller, patientId);
  }

  @Permissions('patients:read')
  @Audit({ action: 'VIEW_CARE_PLAN', resourceType: 'care_plans' })
  @Get('care-plans/:id')
  getCarePlan(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
  ) {
    return this.clinical.getCarePlan(caller, patientId, id);
  }

  @Permissions('care_plans:create')
  @Audit({ action: 'CREATE_CARE_PLAN', resourceType: 'patients', idParam: 'patientId' })
  @Post('care-plans')
  createCarePlan(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Body() dto: CarePlanDto,
  ) {
    return this.clinical.createCarePlan(caller, patientId, dto);
  }

  @Permissions('care_plans:update')
  @Audit({ action: 'UPDATE_CARE_PLAN', resourceType: 'care_plans' })
  @Patch('care-plans/:id')
  updateCarePlan(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateCarePlanDto,
  ) {
    return this.clinical.updateCarePlan(caller, patientId, id, dto);
  }

  /** Physician signed: becomes the active plan (the previous one is superseded). */
  @Permissions('care_plans:update')
  @Audit({ action: 'ACTIVATE_CARE_PLAN', resourceType: 'care_plans' })
  @Post('care-plans/:id/activate')
  @HttpCode(HttpStatus.OK)
  activateCarePlan(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: ActivateCarePlanDto,
  ) {
    return this.clinical.activateCarePlan(caller, patientId, id, dto.physicianSignatureDate);
  }

  @Permissions('care_plans:update')
  @Audit({ action: 'END_CARE_PLAN', resourceType: 'care_plans' })
  @Post('care-plans/:id/end')
  @HttpCode(HttpStatus.OK)
  endCarePlan(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
  ) {
    return this.clinical.endCarePlan(caller, patientId, id);
  }

  // Assessments
  @Permissions('patients:read')
  @Audit({ action: 'VIEW_ASSESSMENTS', resourceType: 'patients', idParam: 'patientId' })
  @Get('assessments')
  listAssessments(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Query() query: ListAssessmentsQueryDto,
  ) {
    return this.clinical.listAssessments(caller, patientId, query.type);
  }

  @Permissions('patients:read')
  @Audit({ action: 'VIEW_ASSESSMENT', resourceType: 'assessments' })
  @Get('assessments/:id')
  getAssessment(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
  ) {
    return this.clinical.getAssessment(caller, patientId, id);
  }

  @Permissions('assessments:create')
  @Audit({ action: 'CREATE_ASSESSMENT', resourceType: 'patients', idParam: 'patientId' })
  @Post('assessments')
  createAssessment(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Body() dto: AssessmentDto,
  ) {
    return this.clinical.createAssessment(caller, patientId, dto);
  }

  @Permissions('assessments:update')
  @Audit({ action: 'UPDATE_ASSESSMENT', resourceType: 'assessments' })
  @Patch('assessments/:id')
  updateAssessment(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateAssessmentDto,
  ) {
    return this.clinical.updateAssessment(caller, patientId, id, dto.data);
  }

  @Permissions('assessments:update')
  @Audit({ action: 'COMPLETE_ASSESSMENT', resourceType: 'assessments' })
  @Post('assessments/:id/complete')
  @HttpCode(HttpStatus.OK)
  completeAssessment(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
  ) {
    return this.clinical.completeAssessment(caller, patientId, id);
  }

  @Permissions('assessments:approve')
  @Audit({ action: 'APPROVE_ASSESSMENT', resourceType: 'assessments' })
  @Post('assessments/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveAssessment(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('id', uuid()) id: string,
    @Body() dto: ApproveAssessmentDto,
  ) {
    return this.clinical.approveAssessment(caller, patientId, id, dto.notes);
  }
}
