import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { fromDate } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import { build837I, validate837I, type Edi837IInput } from './edi/edi-837i.js';
import { build837, validate837, type Edi837Input } from './edi/edi-837p.js';
import { virginiaEvvForLine, virginiaEvvRequired, type LineEvv } from './edi/evv-virginia.js';

const EVV_SELECT = {
  clockInTime: true,
  clockOutTime: true,
  status: true,
  clockInWithinGeofence: true,
  clockOutWithinGeofence: true,
} as const;

export interface EdiFile {
  fileName: string;
  content: string;
  /** T = test indicator: previews are never production interchanges (submission assigns real control numbers). */
  usage: 'T' | 'P';
}

/**
 * Electronic claims (DESIGN.md §10, DECISIONS D-053, D-061). For now: an 837P or 837I **preview** of one claim — valid X12 with the
 * test indicator — so billing can check it or send it to a clearinghouse's test channel. Submission with real control
 * numbers, file storage and acknowledgments come with the clearinghouse (P3-08/P3-09).
 */
@Injectable()
export class EdiService {
  constructor(private readonly prisma: PrismaService) {}

  async preview837(caller: AuthUser, claimId: string): Promise<EdiFile> {
    const claim = await this.prisma.claim.findFirst({
      where: { id: claimId, agencyId: caller.agencyId },
      include: {
        agency: true,
        payer: true,
        patient: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            gender: true,
            addressLine1: true,
            city: true,
            state: true,
            zip: true,
            mrn: true,
            admissionDate: true,
            primaryPhysician: { select: { firstName: true, lastName: true, npi: true } },
          },
        },
        lines: {
          where: { active: true },
          orderBy: { lineNumber: 'asc' },
          include: {
            visit: {
              select: {
                authorization: { select: { authorizationNumber: true } },
                evvRecords: { select: EVV_SELECT, take: 1 },
                staff: { select: { employeeId: true, user: { select: { firstName: true, lastName: true } } } },
              },
            },
          },
        },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === 'void') throw new ConflictException('This claim is void');
    if (claim.claimType !== '837P' && claim.claimType !== '837I')
      throw new ConflictException(`${claim.claimType} claims aren't supported yet`);

    const a = claim.agency;
    const envelope = {
      sender: { name: a.name, id: claim.payer.ediSubmitterId ?? '' },
      receiver: { name: claim.payer.name, id: claim.payer.ediReceiverId ?? '' },
      payer: { name: claim.payer.name, payerId: claim.payer.payerIdCode ?? '', payerType: claim.payer.payerType },
      provider: {
        name: a.name,
        npi: a.npi ?? '',
        taxId: a.taxId ?? '',
        addressLine1: a.addressLine1 ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
        zip: a.zip ?? '',
        contactName: 'Billing Office',
        phone: a.phone ?? '',
      },
      // Previews use a fixed control number and the test indicator; they're never production interchanges.
      controlNumber: 1,
      createdAt: new Date(),
      usage: 'T' as const,
    };
    const priorAuthorization =
      claim.lines.find((l) => l.visit?.authorization?.authorizationNumber)?.visit?.authorization?.authorizationNumber ?? null;
    const patient = {
      lastName: claim.patient.lastName,
      firstName: claim.patient.firstName,
      memberId: claim.memberId ?? '',
      dateOfBirth: fromDate(claim.patient.dateOfBirth) ?? '',
      gender: claim.patient.gender,
      addressLine1: claim.patient.addressLine1,
      city: claim.patient.city,
      state: claim.patient.state,
      zip: claim.patient.zip,
    };

    // Virginia Medicaid: EVV data rides on the claim (D-069). Lines that need it and can't have it are listed with
    // the DMAS edit they would be denied with, alongside the other EDI problems.
    const evvProblems: string[] = [];
    const lineEvv = (l: (typeof claim.lines)[number], revenueCode: string | null): LineEvv | null => {
      const format = claim.claimType as '837P' | '837I';
      if (claim.payer.evvClaimProfile !== 'va_dmas') return null;
      if (!virginiaEvvRequired(format, { serviceCode: l.serviceCode, revenueCode }, claim.typeOfBill)) return null;
      const record = l.visit?.evvRecords[0];
      const staff = l.visit?.staff;
      const { evv, problems } = virginiaEvvForLine({
        format,
        serviceDate: fromDate(l.serviceDate)!,
        timeZone: a.timezone,
        record: record
          ? {
              clockIn: record.clockInTime,
              clockOut: record.clockOutTime,
              status: record.status,
              clockInWithinGeofence: record.clockInWithinGeofence,
              clockOutWithinGeofence: record.clockOutWithinGeofence,
            }
          : null,
        attendant: staff ? { lastName: staff.user.lastName, firstName: staff.user.firstName, employeeId: staff.employeeId } : null,
        serviceAddress: patient,
      });
      evvProblems.push(...problems.map((p) => `Line ${l.lineNumber} (${l.serviceCode} on ${fromDate(l.serviceDate)}): ${p}`));
      return evv;
    };
    const incomplete = (problems: string[]) =>
      new UnprocessableEntityException({
        code: 'EDI_INCOMPLETE',
        message: 'This claim can’t be made into an electronic claim yet',
        details: problems,
      });

    if (claim.claimType === '837I') {
      const codes = await this.prisma.serviceCode.findMany({
        where: { agencyId: caller.agencyId, code: { in: claim.lines.map((l) => l.serviceCode) } },
        select: { code: true, revenueCode: true },
      });
      const revenue = new Map(codes.map((c) => [c.code, c.revenueCode ?? '']));
      const doctor = claim.patient.primaryPhysician;
      const lines = claim.lines.map((l) => {
        const revenueCode = revenue.get(l.serviceCode) ?? '';
        const evv = lineEvv(l, revenueCode);
        return {
          revenueCode,
          serviceCode: l.serviceCode,
          modifiers: [l.modifier1, l.modifier2].filter((m): m is string => Boolean(m)),
          serviceDate: fromDate(l.serviceDate)!,
          units: Number(l.units),
          chargeAmount: Number(l.chargeAmount),
          evv: evv ? { times: evv.times, attendant: evv.attendant } : null,
        };
      });
      const inst: Edi837IInput = {
        ...envelope,
        claims: [
          {
            claimNumber: claim.claimNumber,
            typeOfBill: claim.typeOfBill ?? '',
            totalCharges: Number(claim.totalCharges),
            statementFrom: fromDate(claim.billingPeriodStart)!,
            statementTo: fromDate(claim.billingPeriodEnd)!,
            admissionDate: fromDate(claim.patient.admissionDate),
            patientStatus: claim.patientStatus ?? '30',
            diagnosisCodes: claim.diagnosisCodes,
            priorAuthorization,
            originalReference: /[78]$/.test(claim.typeOfBill ?? '') ? claim.payerClaimNumber : null,
            medicalRecordNumber: claim.patient.mrn,
            hippsCode: claim.hippsCode,
            valueCodes: claim.cbsaCode ? [{ code: '61', amount: Number(claim.cbsaCode) }] : [],
            patient,
            attending: doctor ? { lastName: doctor.lastName, firstName: doctor.firstName, npi: doctor.npi ?? '' } : null,
            // One service location per claim: the patient's home, where every visit on it began (DMAS 837I guide).
            evvServiceLocation: lines.some((l) => l.evv)
              ? { addressLine1: patient.addressLine1!, city: patient.city!, state: patient.state!, zip: patient.zip! }
              : null,
            lines,
          },
        ],
      };
      const problems = [...evvProblems, ...validate837I(inst)];
      if (problems.length) throw incomplete(problems);
      return { fileName: `837I-${claim.claimNumber}-preview.edi`, content: build837I(inst), usage: 'T' };
    }

    const input: Edi837Input = {
      ...envelope,
      claims: [
        {
          claimNumber: claim.claimNumber,
          frequencyCode: claim.frequencyCode,
          totalCharges: Number(claim.totalCharges),
          diagnosisCodes: claim.diagnosisCodes,
          priorAuthorization,
          originalReference: claim.frequencyCode === '7' || claim.frequencyCode === '8' ? claim.payerClaimNumber : null,
          patient,
          lines: claim.lines.map((l) => ({
            serviceCode: l.serviceCode,
            modifiers: [l.modifier1, l.modifier2].filter((m): m is string => Boolean(m)),
            serviceDate: fromDate(l.serviceDate)!,
            units: Number(l.units),
            chargeAmount: Number(l.chargeAmount),
            evv: lineEvv(l, null),
          })),
        },
      ],
    };
    const problems = [...evvProblems, ...validate837(input)];
    if (problems.length) throw incomplete(problems);
    return {
      fileName: `837P-${claim.claimNumber}-preview.edi`,
      content: build837(input),
      usage: 'T',
    };
  }
}
