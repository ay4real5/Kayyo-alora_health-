import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { scoreAssessment } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PatientsService } from '../patients/patients.service.js';
import type {
  AssessmentDto,
  CarePlanDto,
  DiscontinueMedicationDto,
  MedicationDto,
  OrderStatusDto,
  PhysicianOrderDto,
  UpdateCarePlanDto,
  UpdateMedicationDto,
} from './dto/clinical.dto.js';

/** Orders not signed this long after being given are overdue (plan-of-care orders need a signature before billing). */
const ORDER_OVERDUE_DAYS = 30;

const physicianRef = { select: { id: true, firstName: true, lastName: true, npi: true } } as const;
const userRef = { select: { id: true, firstName: true, lastName: true } } as const;

const d = (value: Date | null) => fromDate(value);

/**
 * Clinical records (DESIGN.md §6.2, DECISIONS D-055): medications, physician orders, plans of care and assessments.
 * Reading follows patient access (a caregiver sees their own patients'); changing needs the clinical permission for
 * each. Records are kept, not deleted: medications are discontinued, orders cancelled, plans superseded.
 */
@Injectable()
export class ClinicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientsService,
    private readonly clock: AgencyClockService,
  ) {}

  // ── Medications ──────────────────────────────────────────────────────────────────────────────────

  async listMedications(caller: AuthUser, patientId: string, includeInactive = false) {
    await this.patients.assertAccessible(caller, patientId);
    const rows = await this.prisma.medication.findMany({
      where: { patientId, ...(includeInactive ? {} : { isActive: true }) },
      include: { physician: physicianRef },
      orderBy: [{ isActive: 'desc' }, { drugName: 'asc' }],
    });
    return rows.map(medicationView);
  }

  async addMedication(caller: AuthUser, patientId: string, dto: MedicationDto) {
    await this.patients.assertAccessible(caller, patientId);
    await this.assertPhysician(caller, dto.prescribingPhysicianId);
    const row = await this.prisma.medication.create({
      data: {
        patientId,
        drugName: dto.drugName,
        ndcCode: dto.ndcCode ?? null,
        dosage: dto.dosage ?? null,
        frequency: dto.frequency ?? null,
        route: dto.route ?? null,
        prescribingPhysicianId: dto.prescribingPhysicianId ?? null,
        startDate: toDate(dto.startDate) ?? null,
        notes: dto.notes ?? null,
        createdById: caller.userId,
      },
      include: { physician: physicianRef },
    });
    return medicationView(row);
  }

  async updateMedication(
    caller: AuthUser,
    patientId: string,
    id: string,
    dto: UpdateMedicationDto,
  ) {
    const med = await this.medication(caller, patientId, id);
    if (!med.isActive)
      throw new ConflictException('A discontinued medication cannot be changed — add it again');
    const row = await this.prisma.medication.update({
      where: { id },
      data: dto,
      include: { physician: physicianRef },
    });
    return medicationView(row);
  }

  async discontinueMedication(
    caller: AuthUser,
    patientId: string,
    id: string,
    dto: DiscontinueMedicationDto,
  ) {
    const med = await this.medication(caller, patientId, id);
    if (!med.isActive) throw new ConflictException('Already discontinued');
    const endDate = dto.endDate ?? (await this.clock.todayString(caller.agencyId));
    if (med.startDate && endDate < fromDate(med.startDate)!)
      throw new BadRequestException('endDate is before the start date');
    const row = await this.prisma.medication.update({
      where: { id },
      data: { isActive: false, endDate: toDate(endDate)!, discontinuedReason: dto.reason },
      include: { physician: physicianRef },
    });
    return medicationView(row);
  }

  // ── Physician orders ─────────────────────────────────────────────────────────────────────────────

  async listOrders(caller: AuthUser, patientId: string) {
    await this.patients.assertAccessible(caller, patientId);
    const today = await this.clock.todayString(caller.agencyId);
    const rows = await this.prisma.physicianOrder.findMany({
      where: { patientId },
      include: { physician: physicianRef, takenBy: userRef },
      orderBy: { orderedDate: 'desc' },
    });
    return rows.map((r) => orderView(r, today));
  }

  async createOrder(caller: AuthUser, patientId: string, dto: PhysicianOrderDto) {
    await this.patients.assertAccessible(caller, patientId);
    await this.assertPhysician(caller, dto.physicianId);
    const today = await this.clock.todayString(caller.agencyId);
    const orderedDate = dto.orderedDate ?? today;
    if (dto.expiryDate && dto.effectiveDate && dto.expiryDate < dto.effectiveDate) {
      throw new BadRequestException('expiryDate is before effectiveDate');
    }
    const row = await this.prisma.physicianOrder.create({
      data: {
        patientId,
        physicianId: dto.physicianId ?? null,
        orderType: dto.orderType,
        description: dto.description,
        orderedDate: toDate(orderedDate)!,
        effectiveDate: toDate(dto.effectiveDate) ?? null,
        expiryDate: toDate(dto.expiryDate) ?? null,
        takenById: caller.userId,
      },
      include: { physician: physicianRef, takenBy: userRef },
    });
    return orderView(row, today);
  }

  /** pending → sent (to the physician) → signed (returned signed). Cancel before it's signed. */
  async setOrderStatus(caller: AuthUser, patientId: string, id: string, dto: OrderStatusDto) {
    await this.patients.assertAccessible(caller, patientId);
    const order = await this.prisma.physicianOrder.findFirst({ where: { id, patientId } });
    if (!order) throw new NotFoundException('Order not found');
    const allowed: Record<string, string[]> = {
      sent: ['pending'],
      signed: ['pending', 'sent'],
      cancelled: ['pending', 'sent'],
    };
    if (!allowed[dto.status]!.includes(order.status)) {
      throw new ConflictException(`A ${order.status} order can't become ${dto.status}`);
    }
    const today = await this.clock.todayString(caller.agencyId);
    const date = toDate(dto.date ?? today)!;
    if (dto.date && dto.date < fromDate(order.orderedDate)!)
      throw new BadRequestException('date is before the order date');
    const row = await this.prisma.physicianOrder.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === 'sent' ? { sentDate: date } : {}),
        ...(dto.status === 'signed' ? { signedDate: date } : {}),
      },
      include: { physician: physicianRef, takenBy: userRef },
    });
    return orderView(row, today);
  }

  // ── Care plans ───────────────────────────────────────────────────────────────────────────────────

  async listCarePlans(caller: AuthUser, patientId: string) {
    await this.patients.assertAccessible(caller, patientId);
    const rows = await this.prisma.carePlan.findMany({
      where: { patientId },
      include: { physician: physicianRef },
      orderBy: { version: 'desc' },
    });
    return rows.map(carePlanView);
  }

  async getCarePlan(caller: AuthUser, patientId: string, id: string) {
    await this.patients.assertAccessible(caller, patientId);
    return carePlanView(await this.carePlan(patientId, id));
  }

  async createCarePlan(caller: AuthUser, patientId: string, dto: CarePlanDto) {
    await this.patients.assertAccessible(caller, patientId);
    await this.assertPhysician(caller, dto.physicianId);
    assertPeriod(dto.certificationPeriodStart, dto.certificationPeriodEnd);
    const last = await this.prisma.carePlan.aggregate({
      where: { patientId },
      _max: { version: true },
    });
    const row = await this.prisma.carePlan.create({
      data: {
        patientId,
        physicianId: dto.physicianId ?? null,
        certificationPeriodStart: toDate(dto.certificationPeriodStart)!,
        certificationPeriodEnd: toDate(dto.certificationPeriodEnd)!,
        goals: (dto.goals ?? []) as Prisma.InputJsonValue,
        interventions: (dto.interventions ?? []) as unknown as Prisma.InputJsonValue,
        visitFrequency: (dto.visitFrequency ?? []) as unknown as Prisma.InputJsonValue,
        disciplinesRequired: [
          ...new Set(
            [...(dto.interventions ?? []), ...(dto.visitFrequency ?? [])].map((x) => x.discipline),
          ),
        ],
        version: (last._max.version ?? 0) + 1,
        createdById: caller.userId,
      },
      include: { physician: physicianRef },
    });
    return carePlanView(row);
  }

  async updateCarePlan(caller: AuthUser, patientId: string, id: string, dto: UpdateCarePlanDto) {
    await this.patients.assertAccessible(caller, patientId);
    const plan = await this.carePlan(patientId, id);
    if (plan.status !== 'draft')
      throw new ConflictException('Only a draft plan can be edited — start a new version');
    await this.assertPhysician(caller, dto.physicianId);
    const start = dto.certificationPeriodStart ?? fromDate(plan.certificationPeriodStart)!;
    const end = dto.certificationPeriodEnd ?? fromDate(plan.certificationPeriodEnd)!;
    assertPeriod(start, end);
    const interventions =
      dto.interventions ?? (plan.interventions as { discipline: string }[] | null) ?? [];
    const frequency =
      dto.visitFrequency ?? (plan.visitFrequency as { discipline: string }[] | null) ?? [];
    const row = await this.prisma.carePlan.update({
      where: { id },
      data: {
        ...(dto.physicianId !== undefined ? { physicianId: dto.physicianId } : {}),
        certificationPeriodStart: toDate(start)!,
        certificationPeriodEnd: toDate(end)!,
        ...(dto.goals ? { goals: dto.goals } : {}),
        ...(dto.interventions
          ? { interventions: dto.interventions as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.visitFrequency
          ? { visitFrequency: dto.visitFrequency as unknown as Prisma.InputJsonValue }
          : {}),
        disciplinesRequired: [
          ...new Set([...interventions, ...frequency].map((x) => x.discipline)),
        ],
      },
      include: { physician: physicianRef },
    });
    return carePlanView(row);
  }

  /** The physician signed it: this version becomes the active plan and the previous active one is superseded. */
  async activateCarePlan(caller: AuthUser, patientId: string, id: string, signatureDate: string) {
    await this.patients.assertAccessible(caller, patientId);
    const plan = await this.carePlan(patientId, id);
    if (plan.status !== 'draft')
      throw new ConflictException(`A ${plan.status} plan can't be activated`);
    if (!plan.physicianId) throw new BadRequestException('Name the signing physician first');
    const today = await this.clock.todayString(caller.agencyId);
    if (signatureDate > today)
      throw new BadRequestException('physicianSignatureDate cannot be in the future');
    await this.prisma.$transaction([
      this.prisma.carePlan.updateMany({
        where: { patientId, status: 'active' },
        data: { status: 'superseded' },
      }),
      this.prisma.carePlan.update({
        where: { id },
        data: {
          status: 'active',
          physicianSignatureDate: toDate(signatureDate)!,
          signedById: caller.userId,
        },
      }),
    ]);
    return carePlanView(await this.carePlan(patientId, id));
  }

  async endCarePlan(caller: AuthUser, patientId: string, id: string) {
    await this.patients.assertAccessible(caller, patientId);
    const plan = await this.carePlan(patientId, id);
    if (plan.status !== 'active') throw new ConflictException('Only the active plan can be ended');
    await this.prisma.carePlan.update({ where: { id }, data: { status: 'ended' } });
    return carePlanView(await this.carePlan(patientId, id));
  }

  // ── Assessments ──────────────────────────────────────────────────────────────────────────────────

  async listAssessments(caller: AuthUser, patientId: string, type?: string) {
    await this.patients.assertAccessible(caller, patientId);
    const rows = await this.prisma.assessment.findMany({
      where: { patientId, ...(type ? { type } : {}) },
      include: { assessor: userRef, qaReviewedBy: userRef },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(assessmentView);
  }

  async getAssessment(caller: AuthUser, patientId: string, id: string) {
    await this.patients.assertAccessible(caller, patientId);
    return assessmentView(await this.assessment(patientId, id));
  }

  async createAssessment(caller: AuthUser, patientId: string, dto: AssessmentDto) {
    await this.patients.assertAccessible(caller, patientId);
    if (dto.visitId) {
      const visit = await this.prisma.visit.count({
        where: { id: dto.visitId, patientId, agencyId: caller.agencyId },
      });
      if (!visit) throw new BadRequestException('visitId does not match a visit for this patient');
    }
    const row = await this.prisma.assessment.create({
      data: {
        patientId,
        visitId: dto.visitId ?? null,
        assessorId: caller.userId,
        type: dto.type,
        data: dto.data as Prisma.InputJsonValue,
        score: scoreOf(dto.type, dto.data),
      },
      include: { assessor: userRef, qaReviewedBy: userRef },
    });
    return assessmentView(row);
  }

  async updateAssessment(
    caller: AuthUser,
    patientId: string,
    id: string,
    data: Record<string, unknown>,
  ) {
    await this.patients.assertAccessible(caller, patientId);
    const a = await this.ownDraft(caller, patientId, id);
    const row = await this.prisma.assessment.update({
      where: { id },
      data: { data: data as Prisma.InputJsonValue, score: scoreOf(a.type, data) },
      include: { assessor: userRef, qaReviewedBy: userRef },
    });
    return assessmentView(row);
  }

  /** The assessor finishes it. Scored scales must be fully answered. */
  async completeAssessment(caller: AuthUser, patientId: string, id: string) {
    await this.patients.assertAccessible(caller, patientId);
    const a = await this.ownDraft(caller, patientId, id);
    const scored = scoreAssessment(a.type, a.data as Record<string, unknown>);
    if (scored && !scored.ok) {
      throw new BadRequestException({
        message: 'Some answers are missing',
        code: 'ASSESSMENT_INCOMPLETE',
        details: scored.missing,
      });
    }
    const row = await this.prisma.assessment.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date() },
      include: { assessor: userRef, qaReviewedBy: userRef },
    });
    return assessmentView(row);
  }

  /** QA sign-off by someone other than the assessor. */
  async approveAssessment(caller: AuthUser, patientId: string, id: string, notes?: string) {
    await this.patients.assertAccessible(caller, patientId);
    const a = await this.assessment(patientId, id);
    if (a.status !== 'completed')
      throw new ConflictException(`A ${a.status} assessment can't be approved`);
    if (a.assessorId === caller.userId)
      throw new ForbiddenException('Someone other than the assessor must approve it');
    const row = await this.prisma.assessment.update({
      where: { id },
      data: {
        status: 'approved',
        qaReviewedById: caller.userId,
        qaReviewedAt: new Date(),
        qaNotes: notes ?? null,
      },
      include: { assessor: userRef, qaReviewedBy: userRef },
    });
    return assessmentView(row);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

  private async medication(caller: AuthUser, patientId: string, id: string) {
    await this.patients.assertAccessible(caller, patientId);
    const med = await this.prisma.medication.findFirst({ where: { id, patientId } });
    if (!med) throw new NotFoundException('Medication not found');
    return med;
  }

  private async carePlan(patientId: string, id: string) {
    const plan = await this.prisma.carePlan.findFirst({
      where: { id, patientId },
      include: { physician: physicianRef },
    });
    if (!plan) throw new NotFoundException('Care plan not found');
    return plan;
  }

  private async assessment(patientId: string, id: string) {
    const a = await this.prisma.assessment.findFirst({
      where: { id, patientId },
      include: { assessor: userRef, qaReviewedBy: userRef },
    });
    if (!a) throw new NotFoundException('Assessment not found');
    return a;
  }

  private async ownDraft(caller: AuthUser, patientId: string, id: string) {
    const a = await this.assessment(patientId, id);
    if (a.assessorId !== caller.userId)
      throw new ForbiddenException('Only the assessor can change this assessment');
    if (a.status !== 'draft') throw new ConflictException(`This assessment is ${a.status}`);
    return a;
  }

  private async assertPhysician(caller: AuthUser, physicianId?: string | null): Promise<void> {
    if (!physicianId) return;
    const found = await this.prisma.physician.count({
      where: { id: physicianId, agencyId: caller.agencyId },
    });
    if (!found) throw new BadRequestException('The physician is not in this agency');
  }
}

function assertPeriod(start: string, end: string): void {
  if (end < start) throw new BadRequestException('The certification period ends before it starts');
  if (end > addDays(start, 365))
    throw new BadRequestException('A certification period can be at most a year');
}

function scoreOf(type: string, data: Record<string, unknown>): number | null {
  const scored = scoreAssessment(type, data);
  return scored?.ok ? scored.result.score : null;
}

type PhysicianRef = { id: string; firstName: string; lastName: string; npi: string | null } | null;

function medicationView(
  m: Prisma.MedicationGetPayload<{ include: { physician: typeof physicianRef } }>,
) {
  return {
    id: m.id,
    drugName: m.drugName,
    ndcCode: m.ndcCode,
    dosage: m.dosage,
    frequency: m.frequency,
    route: m.route,
    physician: m.physician as PhysicianRef,
    startDate: d(m.startDate),
    endDate: d(m.endDate),
    isActive: m.isActive,
    discontinuedReason: m.discontinuedReason,
    notes: m.notes,
  };
}

function orderView(
  o: Prisma.PhysicianOrderGetPayload<{
    include: { physician: typeof physicianRef; takenBy: typeof userRef };
  }>,
  today: string,
) {
  const ordered = d(o.orderedDate)!;
  return {
    id: o.id,
    orderType: o.orderType,
    description: o.description,
    status: o.status,
    physician: o.physician as PhysicianRef,
    takenBy: o.takenBy,
    orderedDate: ordered,
    sentDate: d(o.sentDate),
    signedDate: d(o.signedDate),
    effectiveDate: d(o.effectiveDate),
    expiryDate: d(o.expiryDate),
    /** Not back signed within 30 days. */
    overdue:
      ['pending', 'sent'].includes(o.status) && ordered < addDays(today, -ORDER_OVERDUE_DAYS),
  };
}

function carePlanView(
  p: Prisma.CarePlanGetPayload<{ include: { physician: typeof physicianRef } }>,
) {
  return {
    id: p.id,
    version: p.version,
    status: p.status,
    physician: p.physician as PhysicianRef,
    certificationPeriodStart: d(p.certificationPeriodStart),
    certificationPeriodEnd: d(p.certificationPeriodEnd),
    goals: (p.goals ?? []) as string[],
    interventions: (p.interventions ?? []) as { discipline: string; description: string }[],
    visitFrequency: (p.visitFrequency ?? []) as { discipline: string; frequency: string }[],
    disciplinesRequired: (p.disciplinesRequired ?? []) as string[],
    physicianSignatureDate: d(p.physicianSignatureDate),
    createdAt: p.createdAt,
  };
}

function assessmentView(
  a: Prisma.AssessmentGetPayload<{
    include: { assessor: typeof userRef; qaReviewedBy: typeof userRef };
  }>,
) {
  const scored = scoreAssessment(a.type, a.data as Record<string, unknown>);
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    visitId: a.visitId,
    assessor: a.assessor,
    data: a.data,
    score: a.score === null ? null : Number(a.score),
    risk: scored?.ok ? scored.result.risk : null,
    qaReviewedBy: a.qaReviewedBy,
    qaReviewedAt: a.qaReviewedAt,
    qaNotes: a.qaNotes,
    completedAt: a.completedAt,
    createdAt: a.createdAt,
  };
}
