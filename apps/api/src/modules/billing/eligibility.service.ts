import { randomBytes, randomInt } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { memberIdFor } from './billing-readiness.js';
import { build270, validate270 } from './edi/edi-270.js';
import { Edi271Error, parse271, type Eligibility271 } from './edi/edi-271.js';

const CHECK_INCLUDE = {
  payer: { select: { id: true, name: true, payerType: true } },
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.EligibilityCheckInclude;
type CheckRow = Prisma.EligibilityCheckGetPayload<{ include: typeof CHECK_INCLUDE }>;

export interface EligibilityView {
  id: string;
  patientId: string;
  payer: { id: string; name: string; payerType: string };
  traceNumber: string;
  serviceDate: string;
  memberId: string;
  status: string;
  coverageActive: boolean | null;
  planName: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  copay: number | null;
  coinsurancePercent: number | null;
  deductible: number | null;
  deductibleRemaining: number | null;
  errorMessage: string | null;
  benefits: Eligibility271['benefits'];
  respondedAt: Date | null;
  requestedBy: { id: string; firstName: string; lastName: string };
  createdAt: Date;
}

/** ELG + yymmdd + 6 random — fits X12 TRN02/BHT03 and is unique per agency. */
function newTraceNumber(today: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `ELG${today.slice(2).replaceAll('-', '')}${Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('')}`;
}

/**
 * Eligibility checks (DESIGN.md §10, DECISIONS D-060). Makes the 270 question for a patient's primary payer and reads
 * the payer's 271 answer. Until a clearinghouse is connected (P3-08) staff download the 270 and upload the 271; the
 * answer is matched to its question by trace number.
 */
@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
  ) {}

  async list(caller: AuthUser, patientId: string): Promise<EligibilityView[]> {
    const rows = await this.prisma.eligibilityCheck.findMany({
      where: { agencyId: caller.agencyId, patientId },
      include: CHECK_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(toView);
  }

  async get(caller: AuthUser, id: string): Promise<EligibilityView> {
    return toView(await this.find(caller, id));
  }

  /** Makes (and stores) the 270 for the patient's primary payer. 422 lists what's missing. */
  async create(caller: AuthUser, patientId: string, serviceDate?: string): Promise<EligibilityView> {
    const [patient, agency, today] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { id: patientId, agencyId: caller.agencyId },
        select: {
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
          medicaidId: true,
          medicareBeneficiaryId: true,
          insuranceMemberId: true,
          payerPrimary: {
            select: { id: true, name: true, payerType: true, payerIdCode: true, ediSubmitterId: true, ediReceiverId: true, isActive: true },
          },
        },
      }),
      this.prisma.agency.findUniqueOrThrow({ where: { id: caller.agencyId }, select: { name: true, npi: true, taxId: true } }),
      this.clock.todayString(caller.agencyId),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    const payer = patient.payerPrimary;
    if (!payer) throw new BadRequestException('The patient has no primary payer');
    if (payer.payerType === 'private_pay') throw new BadRequestException('Private pay — there is no insurance to check');
    const memberId = memberIdFor(payer.payerType, patient) ?? '';
    const traceNumber = newTraceNumber(today);
    const input = {
      sender: { id: payer.ediSubmitterId ?? '' },
      receiver: { id: payer.ediReceiverId ?? '' },
      payer: { name: payer.name, payerId: payer.payerIdCode ?? '' },
      provider: { name: agency.name, npi: agency.npi ?? '', taxId: agency.taxId },
      subscriber: {
        firstName: patient.firstName,
        lastName: patient.lastName,
        memberId,
        dateOfBirth: fromDate(patient.dateOfBirth),
        gender: patient.gender,
      },
      serviceDate: serviceDate ?? today,
      traceNumber,
      controlNumber: randomInt(1, 999_999_999),
      createdAt: new Date(),
      usage: 'T' as const, // 'P' once the clearinghouse account is live (P3-08)
    };
    const problems = validate270(input);
    if (problems.length) {
      throw new UnprocessableEntityException({ code: 'ELIGIBILITY_INCOMPLETE', message: 'The eligibility request is missing information', details: { problems } });
    }
    const row = await this.prisma.eligibilityCheck.create({
      data: {
        agencyId: caller.agencyId,
        patientId,
        payerId: payer.id,
        traceNumber,
        serviceDate: toDate(input.serviceDate)!,
        memberId,
        request270: build270(input),
        requestedById: caller.userId,
      },
      include: CHECK_INCLUDE,
    });
    return toView(row);
  }

  async request270(caller: AuthUser, id: string): Promise<{ fileName: string; content: string }> {
    const check = await this.find(caller, id);
    return { fileName: `270-${check.traceNumber}.x12`, content: check.request270 };
  }

  /** Reads a 271 and files it on the check with the same trace number. */
  async recordResponse(caller: AuthUser, content: string): Promise<EligibilityView> {
    let answer: Eligibility271;
    try {
      answer = parse271(content);
    } catch (error) {
      if (error instanceof Edi271Error) throw new BadRequestException(error.message);
      throw error;
    }
    if (!answer.traceNumber) throw new BadRequestException('The 271 has no trace number to match');
    const check = await this.prisma.eligibilityCheck.findFirst({
      where: { agencyId: caller.agencyId, traceNumber: answer.traceNumber },
      select: { id: true },
    });
    if (!check) throw new NotFoundException(`No eligibility request with trace number ${answer.traceNumber}`);
    const status = answer.rejections.length
      ? 'rejected'
      : answer.coverageActive === true
        ? 'active'
        : answer.coverageActive === false
          ? 'inactive'
          : 'unknown';
    const row = await this.prisma.eligibilityCheck.update({
      where: { id: check.id },
      data: {
        status,
        responseData: answer as unknown as Prisma.InputJsonValue,
        coverageActive: answer.coverageActive,
        planName: answer.planName?.slice(0, 100) ?? null,
        coverageStart: toDate(answer.coverageStart ?? undefined) ?? null,
        coverageEnd: toDate(answer.coverageEnd ?? undefined) ?? null,
        copay: answer.copay,
        coinsurancePercent: answer.coinsurancePercent,
        deductible: answer.deductible,
        deductibleRemaining: answer.deductibleRemaining,
        errorMessage: answer.rejections.map((r) => r.reason).join('; ') || null,
        respondedAt: new Date(),
      },
      include: CHECK_INCLUDE,
    });
    return toView(row);
  }

  private async find(caller: AuthUser, id: string): Promise<CheckRow> {
    const row = await this.prisma.eligibilityCheck.findFirst({ where: { id, agencyId: caller.agencyId }, include: CHECK_INCLUDE });
    if (!row) throw new NotFoundException('Eligibility check not found');
    return row;
  }
}

const dec = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

function toView(r: CheckRow): EligibilityView {
  return {
    id: r.id,
    patientId: r.patientId,
    payer: r.payer,
    traceNumber: r.traceNumber,
    serviceDate: fromDate(r.serviceDate)!,
    memberId: r.memberId,
    status: r.status,
    coverageActive: r.coverageActive,
    planName: r.planName,
    coverageStart: fromDate(r.coverageStart),
    coverageEnd: fromDate(r.coverageEnd),
    copay: dec(r.copay),
    coinsurancePercent: dec(r.coinsurancePercent),
    deductible: dec(r.deductible),
    deductibleRemaining: dec(r.deductibleRemaining),
    errorMessage: r.errorMessage,
    benefits: (r.responseData as Eligibility271 | null)?.benefits ?? [],
    respondedAt: r.respondedAt,
    requestedBy: r.requestedBy,
    createdAt: r.createdAt,
  };
}
