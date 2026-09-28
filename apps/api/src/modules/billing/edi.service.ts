import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { fromDate } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import { build837, validate837, type Edi837Input } from './edi/edi-837p.js';

export interface EdiFile {
  fileName: string;
  content: string;
  /** T = test indicator: previews are never production interchanges (submission assigns real control numbers). */
  usage: 'T' | 'P';
}

/**
 * Electronic claims (DESIGN.md §10, DECISIONS D-053). For now: an 837P **preview** of one claim — valid X12 with the
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
          },
        },
        lines: {
          where: { active: true },
          orderBy: { lineNumber: 'asc' },
          include: {
            visit: { select: { authorization: { select: { authorizationNumber: true } } } },
          },
        },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === 'void') throw new ConflictException('This claim is void');
    if (claim.claimType !== '837P')
      throw new ConflictException(`${claim.claimType} claims aren't supported yet`);

    const a = claim.agency;
    const input: Edi837Input = {
      sender: { name: a.name, id: claim.payer.ediSubmitterId ?? '' },
      receiver: { name: claim.payer.name, id: claim.payer.ediReceiverId ?? '' },
      payer: {
        name: claim.payer.name,
        payerId: claim.payer.payerIdCode ?? '',
        payerType: claim.payer.payerType,
      },
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
      claims: [
        {
          claimNumber: claim.claimNumber,
          frequencyCode: claim.frequencyCode,
          totalCharges: Number(claim.totalCharges),
          diagnosisCodes: claim.diagnosisCodes,
          priorAuthorization:
            claim.lines.find((l) => l.visit?.authorization?.authorizationNumber)?.visit
              ?.authorization?.authorizationNumber ?? null,
          patient: {
            lastName: claim.patient.lastName,
            firstName: claim.patient.firstName,
            memberId: claim.memberId ?? '',
            dateOfBirth: fromDate(claim.patient.dateOfBirth) ?? '',
            gender: claim.patient.gender,
            addressLine1: claim.patient.addressLine1,
            city: claim.patient.city,
            state: claim.patient.state,
            zip: claim.patient.zip,
          },
          lines: claim.lines.map((l) => ({
            serviceCode: l.serviceCode,
            modifiers: [l.modifier1, l.modifier2].filter((m): m is string => Boolean(m)),
            serviceDate: fromDate(l.serviceDate)!,
            units: Number(l.units),
            chargeAmount: Number(l.chargeAmount),
          })),
        },
      ],
      // Previews use a fixed control number and the test indicator; they're never production interchanges.
      controlNumber: 1,
      createdAt: new Date(),
      usage: 'T',
    };
    const problems = validate837(input);
    if (problems.length) {
      throw new UnprocessableEntityException({
        code: 'EDI_INCOMPLETE',
        message: 'This claim can’t be made into an electronic claim yet',
        details: problems,
      });
    }
    return {
      fileName: `837P-${claim.claimNumber}-preview.edi`,
      content: build837(input),
      usage: 'T',
    };
  }
}
