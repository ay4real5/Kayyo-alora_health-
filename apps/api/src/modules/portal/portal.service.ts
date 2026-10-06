import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { addDays, fromDate, fromTime, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { ListMessagesQueryDto } from '../messaging/dto/messaging.dto.js';
import { MessagingService } from '../messaging/messaging.service.js';

/** How far the visit schedule looks ahead and back. */
const VISIT_WINDOW_DAYS = 30;

/**
 * What a patient or family member sees in the portal (DESIGN.md §6.14, DECISIONS D-058). Every method starts from
 * `patient()`, which only finds a patient linked to this portal user — anything else is 404. Deliberately narrow:
 * no SSN, insurance IDs, clinical notes, assessments, EVV locations or staff contact details.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly docs: DocumentsService,
    private readonly messaging: MessagingService,
  ) {}

  async me(caller: AuthUser) {
    const [user, agency, patients] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: caller.userId },
        select: { firstName: true, lastName: true, email: true },
      }),
      this.prisma.agency.findUniqueOrThrow({ where: { id: caller.agencyId }, select: { name: true, phone: true, email: true } }),
      this.prisma.patient.findMany({
        where: { agencyId: caller.agencyId, portalUserId: caller.userId },
        select: { id: true, firstName: true, lastName: true, status: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
    ]);
    return { ...user, agency, patients };
  }

  async profile(caller: AuthUser, patientId: string) {
    await this.patient(caller, patientId);
    const p = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: {
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        phoneHome: true,
        phoneCell: true,
        email: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zip: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        emergencyContactRelation: true,
        admissionDate: true,
        status: true,
        primaryPhysician: { select: { firstName: true, lastName: true, phone: true } },
      },
    });
    return { ...p, dateOfBirth: fromDate(p.dateOfBirth), admissionDate: fromDate(p.admissionDate) };
  }

  /** Upcoming visits (next 30 days) and recent ones (last 30 days). Caregivers by first name and last initial. */
  async visits(caller: AuthUser, patientId: string) {
    await this.patient(caller, patientId);
    const today = await this.clock.todayString(caller.agencyId);
    const rows = await this.prisma.visit.findMany({
      where: {
        agencyId: caller.agencyId,
        patientId,
        scheduledDate: { gte: toDate(addDays(today, -VISIT_WINDOW_DAYS))!, lte: toDate(addDays(today, VISIT_WINDOW_DAYS))! },
      },
      select: {
        id: true,
        visitType: true,
        status: true,
        scheduledDate: true,
        scheduledStart: true,
        scheduledEnd: true,
        staff: { select: { user: { select: { firstName: true, lastName: true } } } },
        careUpdates: { select: { summary: true, mood: true, createdAt: true } },
      },
      orderBy: [{ scheduledDate: 'asc' }, { scheduledStart: 'asc' }],
    });
    const views = rows.map((v) => ({
      id: v.id,
      visitType: v.visitType,
      status: v.status,
      date: fromDate(v.scheduledDate)!,
      start: fromTime(v.scheduledStart),
      end: fromTime(v.scheduledEnd),
      caregiver: v.staff ? `${v.staff.user.firstName} ${v.staff.user.lastName.charAt(0)}.` : null,
      /** The caregiver's update for the family (D-096), if they sent one. */
      careUpdate: v.careUpdates[0] ? { summary: v.careUpdates[0].summary, mood: v.careUpdates[0].mood, at: v.careUpdates[0].createdAt } : null,
    }));
    return {
      upcoming: views.filter((v) => v.date >= today && (v.status === 'scheduled' || v.status === 'in_progress')),
      recent: views.filter((v) => v.date < today || v.status === 'completed' || v.status === 'missed').reverse(),
    };
  }

  /** The active plan of care (read-only), or null. */
  async carePlan(caller: AuthUser, patientId: string) {
    await this.patient(caller, patientId);
    const plan = await this.prisma.carePlan.findFirst({
      where: { patientId, status: 'active' },
      select: {
        certificationPeriodStart: true,
        certificationPeriodEnd: true,
        goals: true,
        interventions: true,
        visitFrequency: true,
        physician: { select: { firstName: true, lastName: true } },
      },
    });
    if (!plan) return null;
    return {
      ...plan,
      certificationPeriodStart: fromDate(plan.certificationPeriodStart),
      certificationPeriodEnd: fromDate(plan.certificationPeriodEnd),
    };
  }

  async medications(caller: AuthUser, patientId: string) {
    await this.patient(caller, patientId);
    return this.prisma.medication.findMany({
      where: { patientId, isActive: true },
      select: { id: true, drugName: true, dosage: true, frequency: true, route: true },
      orderBy: { drugName: 'asc' },
    });
  }

  async documents(caller: AuthUser, patientId: string) {
    await this.patient(caller, patientId);
    return this.docs.listSharedWithPatient(caller.agencyId, patientId);
  }

  async download(caller: AuthUser, patientId: string, documentId: string) {
    await this.patient(caller, patientId);
    return this.docs.downloadSharedWithPatient(caller.agencyId, patientId, documentId);
  }

  async messages(caller: AuthUser, patientId: string, query: ListMessagesQueryDto) {
    await this.patient(caller, patientId);
    return this.messaging.portalThread(caller, patientId, query);
  }

  async send(caller: AuthUser, patientId: string, content: string) {
    await this.patient(caller, patientId);
    return this.messaging.portalSend(caller, patientId, content);
  }

  async markRead(caller: AuthUser, patientId: string) {
    await this.patient(caller, patientId);
    await this.messaging.portalMarkRead(caller, patientId);
  }

  /** 404 unless this patient is linked to the portal user. */
  private async patient(caller: AuthUser, patientId: string): Promise<void> {
    const found = await this.prisma.patient.count({
      where: { id: patientId, agencyId: caller.agencyId, portalUserId: caller.userId },
    });
    if (!found) throw new NotFoundException('Patient not found');
  }
}
