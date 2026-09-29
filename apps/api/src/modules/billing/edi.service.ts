import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { fromDate } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { build837I, validate837I, type Edi837IClaim, type Edi837IInput } from './edi/edi-837i.js';
import { build837, validate837, type Edi837Claim, type Edi837Input } from './edi/edi-837p.js';
import { addLiveInModifier, addRepeatModifiers, virginiaEvvForLine, virginiaEvvRequired, type LineEvv } from './edi/evv-virginia.js';

const EVV_SELECT = {
  clockInTime: true,
  clockOutTime: true,
  status: true,
  clockInWithinGeofence: true,
  clockOutWithinGeofence: true,
} as const;

const CLAIM_INCLUDE = {
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
      liveIn: true,
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
} satisfies Prisma.ClaimInclude;
type ClaimRow = Prisma.ClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

export interface EdiFile {
  fileName: string;
  content: string;
  /** T = test indicator (previews always); P = production. */
  usage: 'T' | 'P';
}

/** A batch file for one payer (D-076). */
export interface Built837 {
  format: '837P' | '837I';
  content: string;
  claimIds: string[];
}

type ClaimData =
  | { format: '837P'; claim: Edi837Claim; problems: string[] }
  | { format: '837I'; claim: Edi837IClaim; problems: string[] };

const incomplete = (problems: string[], many = false) =>
  new UnprocessableEntityException({
    code: 'EDI_INCOMPLETE',
    message: many ? 'Some claims can’t be made into an electronic file yet' : 'This claim can’t be made into an electronic claim yet',
    details: problems,
  });

/**
 * Electronic claims (DESIGN.md §10, DECISIONS D-053, D-061, D-076): an 837P or 837I **preview** of one claim (test
 * indicator, fixed control number), and `build837File` for a real batch file — many claims to one payer, with the
 * agency's next interchange control number (EdiFilesService stores and tracks it).
 */
@Injectable()
export class EdiService {
  constructor(private readonly prisma: PrismaService) {}

  async preview837(caller: AuthUser, claimId: string): Promise<EdiFile> {
    const claim = await this.prisma.claim.findFirst({ where: { id: claimId, agencyId: caller.agencyId }, include: CLAIM_INCLUDE });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === 'void') throw new ConflictException('This claim is void');
    const data = await this.claimData(caller, claim);
    // Previews use a fixed control number and the test indicator; they're never production interchanges.
    const header = envelope(claim, 1, 'T');
    if (data.format === '837I') {
      const input: Edi837IInput = { ...header, claims: [data.claim] };
      const problems = [...data.problems, ...validate837I(input)];
      if (problems.length) throw incomplete(problems);
      return { fileName: `837I-${claim.claimNumber}-preview.edi`, content: build837I(input), usage: 'T' };
    }
    const input: Edi837Input = { ...header, claims: [data.claim] };
    const problems = [...data.problems, ...validate837(input)];
    if (problems.length) throw incomplete(problems);
    return { fileName: `837P-${claim.claimNumber}-preview.edi`, content: build837(input), usage: 'T' };
  }

  /**
   * One 837 file for several claims to the same payer and of the same form. Throws 409 if they don't belong
   * together and 422 listing everything missing (per claim) — nothing is half-built.
   */
  async build837File(caller: AuthUser, claimIds: string[], controlNumber: number, usage: 'T' | 'P'): Promise<Built837> {
    const claims = await this.prisma.claim.findMany({
      where: { id: { in: claimIds }, agencyId: caller.agencyId },
      include: CLAIM_INCLUDE,
      orderBy: { claimNumber: 'asc' },
    });
    if (claims.length !== new Set(claimIds).size) throw new NotFoundException('Claim not found');
    const first = claims[0]!;
    if (claims.some((c) => c.payerId !== first.payerId)) throw new ConflictException('A file goes to one payer — pick claims for one payer');
    if (claims.some((c) => c.claimType !== first.claimType)) throw new ConflictException('837P and 837I claims go in separate files');
    const notReady = claims.filter((c) => c.status !== 'ready');
    if (notReady.length) {
      throw new ConflictException(`Only ready claims can go in a file: ${notReady.map((c) => `${c.claimNumber} is ${c.status}`).join(', ')}`);
    }
    const data = await Promise.all(claims.map((c) => this.claimData(caller, c)));
    const evvProblems = data.flatMap((d, i) => d.problems.map((p) => `Claim ${claims[i]!.claimNumber}: ${p}`));
    const header = envelope(first, controlNumber, usage);
    let content: string;
    if (first.claimType === '837I') {
      const input: Edi837IInput = { ...header, claims: data.map((d) => d.claim as Edi837IClaim) };
      const problems = [...evvProblems, ...validate837I(input)];
      if (problems.length) throw incomplete(problems, true);
      content = build837I(input);
    } else {
      const input: Edi837Input = { ...header, claims: data.map((d) => d.claim as Edi837Claim) };
      const problems = [...evvProblems, ...validate837(input)];
      if (problems.length) throw incomplete(problems, true);
      content = build837(input);
    }
    return { format: first.claimType as '837P' | '837I', content, claimIds: claims.map((c) => c.id) };
  }

  /** One claim as 837 data, with Virginia EVV problems (D-069) listed rather than thrown. */
  private async claimData(caller: AuthUser, claim: ClaimRow): Promise<ClaimData> {
    if (claim.claimType !== '837P' && claim.claimType !== '837I')
      throw new ConflictException(`${claim.claimType} claims aren't supported yet`);
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
    const problems: string[] = [];
    const lineEvv = (l: ClaimRow['lines'][number], revenueCode: string | null): LineEvv | null => {
      const format = claim.claimType as '837P' | '837I';
      if (claim.payer.evvClaimProfile !== 'va_dmas') return null;
      if (!virginiaEvvRequired(format, { serviceCode: l.serviceCode, revenueCode }, claim.typeOfBill)) return null;
      const record = l.visit?.evvRecords[0];
      const staff = l.visit?.staff;
      const result = virginiaEvvForLine({
        format,
        serviceDate: fromDate(l.serviceDate)!,
        timeZone: claim.agency.timezone,
        window: l.evvStart && l.evvEnd ? { start: l.evvStart, end: l.evvEnd } : null,
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
      problems.push(...result.problems.map((p) => `Line ${l.lineNumber} (${l.serviceCode} on ${fromDate(l.serviceDate)}): ${p}`));
      return result.evv;
    };

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
      return {
        format: '837I',
        problems,
        claim: {
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
      };
    }

    const lines = claim.lines.map((l) => ({
      serviceCode: l.serviceCode,
      modifiers: [l.modifier1, l.modifier2].filter((m): m is string => Boolean(m)),
      serviceDate: fromDate(l.serviceDate)!,
      units: Number(l.units),
      chargeAmount: Number(l.chargeAmount),
      evv: lineEvv(l, null),
    }));
    if (claim.payer.evvClaimProfile === 'va_dmas') {
      if (claim.patient.liveIn) addLiveInModifier(lines);
      addRepeatModifiers(lines);
    }
    return {
      format: '837P',
      problems,
      claim: {
        claimNumber: claim.claimNumber,
        frequencyCode: claim.frequencyCode,
        totalCharges: Number(claim.totalCharges),
        diagnosisCodes: claim.diagnosisCodes,
        priorAuthorization,
        originalReference: claim.frequencyCode === '7' || claim.frequencyCode === '8' ? claim.payerClaimNumber : null,
        patient,
        lines,
      },
    };
  }
}

/** Interchange envelope: the agency as billing provider, the claim's payer as receiver. */
function envelope(claim: ClaimRow, controlNumber: number, usage: 'T' | 'P') {
  const a = claim.agency;
  return {
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
    controlNumber,
    createdAt: new Date(),
    usage,
  };
}
