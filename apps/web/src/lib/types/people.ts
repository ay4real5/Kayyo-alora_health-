/**
 * Staff, user and physician shapes as returned by the API (see apps/api/src/modules/{staff,users,physicians}).
 * Kept in sync by hand for now (DECISIONS D-035).
 */

export interface Physician {
  id: string;
  npi: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  fax: string | null;
  email: string | null;
  practiceName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  isActive: boolean;
}

export interface RoleOption {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export interface UserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  is2faEnabled: boolean;
  isLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { id: string; name: string }[];
}

export interface ActivityEntry {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface StaffSummary {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  employeeId: string | null;
  discipline: string;
  employmentType: string;
  isActive: boolean;
  skills: string[];
  languages: string[];
}

export interface StaffDetail extends StaffSummary {
  email: string;
  phone: string | null;
  /** A phone check-in (IVR) code is set; the code itself is never sent (D-073). */
  hasPhoneCheckInCode: boolean;
  hireDate: string | null;
  terminationDate: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Caregiver matching (D-094): home location and gender, optional. */
  latitude: number | null;
  longitude: number | null;
  gender: string | null;
  serviceAreaZipCodes: string[];
  maxPatients: number | null;
  notes: string | null;
  /** Only present for payroll roles and the person themselves. */
  pay?: {
    hourlyRate: string | null;
    perVisitRate: string | null;
    overtimeRate: string | null;
    mileageRate: string | null;
    taxFilingStatus: string | null;
    ssnLast4: string | null;
  };
}

export interface Credential {
  id: string;
  credentialType: string;
  credentialName: string;
  credentialNumber: string | null;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  alertDaysBefore: number;
  state: 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';
  verifiedById: string | null;
  verifiedAt: string | null;
  notes: string | null;
}

export interface ExpiringCredential extends Credential {
  staff: { id: string; firstName: string; lastName: string; discipline: string };
}

export interface AvailabilitySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface TimeOff {
  id: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
  notes: string | null;
  approvedById: string | null;
  createdAt: string;
}

export interface StaffCandidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** A time-off request as returned by `GET /time-off` (D-090). */
export interface TimeOffRequest {
  id: string;
  staff: { id: string; userId: string; firstName: string; lastName: string; discipline: string };
  startDate: string;
  endDate: string;
  days: number;
  type: string;
  status: string;
  notes: string | null;
  decidedBy: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
  /** For approvers on pending requests: the person's visits already booked in those days. */
  bookedVisits?: number;
}
