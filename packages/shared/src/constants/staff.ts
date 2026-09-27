/** Clinical disciplines (DESIGN.md §5.3 staff_profiles.discipline). */
export const DISCIPLINES = [
  'RN', // registered nurse
  'LPN', // licensed practical/vocational nurse
  'PT', // physical therapist
  'PTA', // physical therapist assistant
  'OT', // occupational therapist
  'COTA', // certified occupational therapy assistant
  'SLP', // speech-language pathologist
  'MSW', // medical social worker
  'HHA', // home health aide
  'CNA', // certified nursing assistant
  'PCA', // personal care aide
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'per_diem', 'contractor'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const TIME_OFF_TYPES = ['vacation', 'sick', 'personal', 'bereavement', 'other'] as const;
export type TimeOffType = (typeof TIME_OFF_TYPES)[number];

export const TIME_OFF_STATUSES = ['pending', 'approved', 'denied', 'cancelled'] as const;
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number];

/** Derived from expiry date and the credential's alert window; never stored. */
export type CredentialState = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';

export function credentialState(expiryDate: string | null, alertDaysBefore: number, today: string): CredentialState {
  if (!expiryDate) return 'no_expiry';
  if (expiryDate < today) return 'expired';
  const alertFrom = new Date(`${expiryDate}T00:00:00Z`);
  alertFrom.setUTCDate(alertFrom.getUTCDate() - alertDaysBefore);
  return today >= alertFrom.toISOString().slice(0, 10) ? 'expiring_soon' : 'valid';
}
