/**
 * Patient shapes as returned by the API (apps/api/src/modules/patients/patients.service.ts). Kept in sync by hand
 * until response schemas are generated from the OpenAPI spec (DECISIONS D-035).
 */
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

export interface Diagnosis {
  id: string;
  icd10Code: string;
  description: string | null;
  isPrimary: boolean;
  sequenceOrder: number;
  onsetDate: string | null;
  resolvedDate: string | null;
}

export interface Allergy {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: string | null;
}

export interface PatientDetail extends PatientSummary {
  gender: string | null;
  ssnLast4: string | null;
  phoneHome: string | null;
  liveIn: boolean;
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
  diagnoses: Diagnosis[];
  allergies: Allergy[];
}

export interface PhysicianOption {
  id: string;
  firstName: string;
  lastName: string;
  practiceName: string | null;
  isActive: boolean;
}
