import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeIcd10 } from '@alora/shared';
import { PhiContext, PhiCryptoService } from '../../common/crypto/phi-crypto.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import type {
  CreateAllergyDto,
  CreateDiagnosisDto,
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './dto/patients.dto.js';

export interface PatientSummary {
  id: string;
  mrn: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  status: string;
  city: string | null;
  admissionDate: string | null;
}

export interface PatientDetail extends PatientSummary {
  gender: string | null;
  /** Never the full SSN. */
  ssnLast4: string | null;
  phoneHome: string | null;
  phoneCell: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  zip: string | null;
  geoFenceRadiusMeters: number;
  latitude: number | null;
  longitude: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  primaryPhysicianId: string | null;
  medicareBeneficiaryId: string | null;
  medicaidId: string | null;
  insuranceMemberId: string | null;
  insuranceGroupNumber: string | null;
  dischargeDate: string | null;
  notes: string | null;
  diagnoses: DiagnosisView[];
  allergies: AllergyView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DiagnosisView {
  id: string;
  icd10Code: string;
  description: string | null;
  isPrimary: boolean;
  sequenceOrder: number;
  onsetDate: string | null;
  resolvedDate: string | null;
}

export interface AllergyView {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: string | null;
}

const DETAIL_INCLUDE = {
  diagnoses: { orderBy: [{ isPrimary: 'desc' }, { sequenceOrder: 'asc' }] },
  allergies: { orderBy: { allergen: 'asc' } },
} satisfies Prisma.PatientInclude;

type PatientWithChildren = Prisma.PatientGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/**
 * Patients (DESIGN.md §6.3). Access (DECISIONS D-027):
 *  - always limited to the caller's agency;
 *  - with `patients:read_all` (admin, supervisor, office, billing) every agency patient is visible;
 *  - otherwise (field staff) only patients the caller has at least one visit with.
 * A patient outside that scope is a 404, indistinguishable from one that doesn't exist.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PhiCryptoService,
    private readonly permissions: PermissionsService,
    private readonly clock: AgencyClockService,
  ) {}

  async list(caller: AuthUser, query: ListPatientsQueryDto): Promise<Paginated<PatientSummary>> {
    const where: Prisma.PatientWhereInput = {
      AND: [
        await this.scope(caller),
        query.status ? { status: query.status } : {},
        query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { mrn: { equals: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const [patients, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.patient.count({ where }),
    ]);
    return Paginated.of(patients.map(toSummary), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<PatientDetail> {
    return this.toDetail(await this.find(caller, id));
  }

  /** Admit a new patient (status active). */
  async admit(caller: AuthUser, dto: CreatePatientDto): Promise<PatientDetail> {
    await this.assertPhysician(caller, dto.primaryPhysicianId);
    const admissionDate = toDate(dto.admissionDate) ?? (await this.clock.today(caller.agencyId));
    const patient = await this.saveOrConflict(() =>
      this.prisma.patient.create({
        data: {
          ...this.fields(dto),
          agencyId: caller.agencyId,
          status: 'active',
          admissionDate,
        },
        include: DETAIL_INCLUDE,
      }),
    );
    return this.toDetail(patient);
  }

  async update(caller: AuthUser, id: string, dto: UpdatePatientDto): Promise<PatientDetail> {
    await this.find(caller, id);
    await this.assertPhysician(caller, dto.primaryPhysicianId);
    const patient = await this.saveOrConflict(() =>
      this.prisma.patient.update({ where: { id }, data: this.fields(dto), include: DETAIL_INCLUDE }),
    );
    return this.toDetail(patient);
  }

  async discharge(caller: AuthUser, id: string, dischargeDate?: string): Promise<PatientDetail> {
    const patient = await this.find(caller, id);
    if (patient.status === 'discharged') throw new ConflictException('Patient is already discharged');
    const date = toDate(dischargeDate) ?? (await this.clock.today(caller.agencyId));
    if (patient.admissionDate && date < patient.admissionDate) {
      throw new BadRequestException('Discharge date cannot be before the admission date');
    }
    return this.toDetail(
      await this.prisma.patient.update({
        where: { id },
        data: { status: 'discharged', dischargeDate: date },
        include: DETAIL_INCLUDE,
      }),
    );
  }

  async readmit(caller: AuthUser, id: string, admissionDate?: string): Promise<PatientDetail> {
    const patient = await this.find(caller, id);
    if (patient.status !== 'discharged') throw new ConflictException('Only a discharged patient can be readmitted');
    return this.toDetail(
      await this.prisma.patient.update({
        where: { id },
        data: { status: 'active', admissionDate: toDate(admissionDate) ?? (await this.clock.today(caller.agencyId)), dischargeDate: null },
        include: DETAIL_INCLUDE,
      }),
    );
  }

  async listDiagnoses(caller: AuthUser, patientId: string): Promise<DiagnosisView[]> {
    return (await this.find(caller, patientId)).diagnoses.map(toDiagnosis);
  }

  async addDiagnosis(caller: AuthUser, patientId: string, dto: CreateDiagnosisDto): Promise<DiagnosisView> {
    await this.find(caller, patientId);
    const icd10Code = normalizeIcd10(dto.icd10Code);
    if (!icd10Code) throw new BadRequestException('icd10Code must be an ICD-10-CM code such as E11.9');

    const diagnosis = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.patientDiagnosis.updateMany({ where: { patientId, isPrimary: true }, data: { isPrimary: false } });
      }
      const last = await tx.patientDiagnosis.aggregate({ where: { patientId }, _max: { sequenceOrder: true } });
      return tx.patientDiagnosis.create({
        data: {
          patientId,
          icd10Code,
          description: dto.description ?? null,
          isPrimary: dto.isPrimary ?? false,
          sequenceOrder: (last._max.sequenceOrder ?? 0) + 1,
          onsetDate: toDate(dto.onsetDate) ?? null,
        },
      });
    });
    return toDiagnosis(diagnosis);
  }

  async removeDiagnosis(caller: AuthUser, patientId: string, diagnosisId: string): Promise<void> {
    await this.find(caller, patientId);
    const removed = await this.prisma.patientDiagnosis.deleteMany({ where: { id: diagnosisId, patientId } });
    if (removed.count === 0) throw new NotFoundException('Diagnosis not found');
  }

  async listAllergies(caller: AuthUser, patientId: string): Promise<AllergyView[]> {
    return (await this.find(caller, patientId)).allergies.map(toAllergy);
  }

  async addAllergy(caller: AuthUser, patientId: string, dto: CreateAllergyDto): Promise<AllergyView> {
    await this.find(caller, patientId);
    return toAllergy(
      await this.prisma.patientAllergy.create({
        data: { patientId, allergen: dto.allergen, reaction: dto.reaction ?? null, severity: dto.severity ?? null },
      }),
    );
  }

  async removeAllergy(caller: AuthUser, patientId: string, allergyId: string): Promise<void> {
    await this.find(caller, patientId);
    const removed = await this.prisma.patientAllergy.deleteMany({ where: { id: allergyId, patientId } });
    if (removed.count === 0) throw new NotFoundException('Allergy not found');
  }

  /** The record-level access rule. Every query goes through this. */
  private async scope(caller: AuthUser): Promise<Prisma.PatientWhereInput> {
    const access = await this.permissions.forUser(caller);
    if (access.permissions.has('patients:read_all')) return { agencyId: caller.agencyId };
    // A cancelled visit doesn't give a caregiver access to the patient (D-030).
    return {
      agencyId: caller.agencyId,
      visits: { some: { staff: { userId: caller.userId }, status: { not: 'cancelled' } } },
    };
  }

  private async find(caller: AuthUser, id: string): Promise<PatientWithChildren> {
    const patient = await this.prisma.patient.findFirst({
      where: { AND: [{ id }, await this.scope(caller)] },
      include: DETAIL_INCLUDE,
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  private async assertPhysician(caller: AuthUser, physicianId: string | undefined): Promise<void> {
    if (!physicianId) return;
    const exists = await this.prisma.physician.count({ where: { id: physicianId, agencyId: caller.agencyId } });
    if (!exists) throw new BadRequestException('primaryPhysicianId does not match a physician in this agency');
  }

  /** Maps DTO fields to columns; only fields present in the DTO are written. */
  private fields(dto: UpdatePatientDto): Prisma.PatientUncheckedUpdateInput & Prisma.PatientUncheckedCreateInput {
    const data: Record<string, unknown> = {};
    const copy = [
      'firstName', 'lastName', 'gender', 'mrn', 'phoneHome', 'phoneCell', 'email', 'addressLine1',
      'addressLine2', 'city', 'state', 'zip', 'latitude', 'longitude', 'geoFenceRadiusMeters', 'emergencyContactName',
      'emergencyContactPhone', 'emergencyContactRelation', 'primaryPhysicianId', 'medicareBeneficiaryId',
      'medicaidId', 'insuranceMemberId', 'insuranceGroupNumber', 'notes',
    ] as const;
    for (const key of copy) if (dto[key] !== undefined) data[key] = dto[key];
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = toDate(dto.dateOfBirth);
    if (dto.ssn !== undefined) {
      data.ssnEncrypted = this.crypto.encrypt(dto.ssn.replaceAll('-', ''), PhiContext.PatientSsn);
    }
    return data as Prisma.PatientUncheckedUpdateInput & Prisma.PatientUncheckedCreateInput;
  }

  private async saveOrConflict<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another patient in this agency already has this MRN');
      }
      throw error;
    }
  }

  private toDetail(patient: PatientWithChildren): PatientDetail {
    const ssn = patient.ssnEncrypted ? this.crypto.decrypt(patient.ssnEncrypted, PhiContext.PatientSsn) : null;
    return {
      ...toSummary(patient),
      gender: patient.gender,
      ssnLast4: ssn ? ssn.slice(-4) : null,
      phoneHome: patient.phoneHome,
      phoneCell: patient.phoneCell,
      email: patient.email,
      addressLine1: patient.addressLine1,
      addressLine2: patient.addressLine2,
      state: patient.state,
      zip: patient.zip,
      geoFenceRadiusMeters: patient.geoFenceRadiusMeters,
      latitude: patient.latitude === null ? null : Number(patient.latitude),
      longitude: patient.longitude === null ? null : Number(patient.longitude),
      emergencyContactName: patient.emergencyContactName,
      emergencyContactPhone: patient.emergencyContactPhone,
      emergencyContactRelation: patient.emergencyContactRelation,
      primaryPhysicianId: patient.primaryPhysicianId,
      medicareBeneficiaryId: patient.medicareBeneficiaryId,
      medicaidId: patient.medicaidId,
      insuranceMemberId: patient.insuranceMemberId,
      insuranceGroupNumber: patient.insuranceGroupNumber,
      dischargeDate: fromDate(patient.dischargeDate),
      notes: patient.notes,
      diagnoses: patient.diagnoses.map(toDiagnosis),
      allergies: patient.allergies.map(toAllergy),
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }
}

function toSummary(patient: {
  id: string;
  mrn: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  status: string;
  city: string | null;
  admissionDate: Date | null;
}): PatientSummary {
  return {
    id: patient.id,
    mrn: patient.mrn,
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: fromDate(patient.dateOfBirth)!,
    status: patient.status,
    city: patient.city,
    admissionDate: fromDate(patient.admissionDate),
  };
}

function toDiagnosis(d: {
  id: string;
  icd10Code: string;
  description: string | null;
  isPrimary: boolean;
  sequenceOrder: number;
  onsetDate: Date | null;
  resolvedDate: Date | null;
}): DiagnosisView {
  return {
    id: d.id,
    icd10Code: d.icd10Code,
    description: d.description,
    isPrimary: d.isPrimary,
    sequenceOrder: d.sequenceOrder,
    onsetDate: fromDate(d.onsetDate),
    resolvedDate: fromDate(d.resolvedDate),
  };
}

function toAllergy(a: { id: string; allergen: string; reaction: string | null; severity: string | null }): AllergyView {
  return { id: a.id, allergen: a.allergen, reaction: a.reaction, severity: a.severity };
}
