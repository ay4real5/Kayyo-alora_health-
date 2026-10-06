import type { Discipline } from './staff.js';

/**
 * Credentials each discipline needs before working (D-101). Agencies can change this in Settings → Agency; these are
 * the defaults. Values are credential types as entered on a staff member's credentials (compared lower-case).
 */
export const DEFAULT_REQUIRED_CREDENTIALS: Record<Discipline, string[]> = {
  RN: ['license', 'cpr', 'tb_test', 'background_check'],
  LPN: ['license', 'cpr', 'tb_test', 'background_check'],
  PT: ['license', 'cpr', 'background_check'],
  PTA: ['license', 'cpr', 'background_check'],
  OT: ['license', 'cpr', 'background_check'],
  COTA: ['license', 'cpr', 'background_check'],
  SLP: ['license', 'cpr', 'background_check'],
  MSW: ['license', 'background_check'],
  HHA: ['hha_certificate', 'cpr', 'tb_test', 'background_check'],
  CNA: ['cna_certificate', 'cpr', 'tb_test', 'background_check'],
  PCA: ['cpr', 'tb_test', 'background_check'],
};

export const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  license: 'Professional license',
  cpr: 'CPR / BLS',
  tb_test: 'TB test',
  background_check: 'Background check',
  hha_certificate: 'HHA certificate',
  cna_certificate: 'CNA certificate',
};

export function credentialTypeLabel(type: string): string {
  return CREDENTIAL_TYPE_LABELS[type] ?? type.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface OnboardingFacts {
  signedIn: boolean;
  hasPhone: boolean;
  hasAddress: boolean;
  hasHireDate: boolean;
  hasPayRate: boolean;
  hasAvailability: boolean;
  hasServiceArea: boolean;
  hasPhoneCheckInCode: boolean;
  /** Credential types (lower-case) with an active, unexpired credential. */
  validCredentialTypes: string[];
  /** Credential types on file but expired. */
  expiredCredentialTypes: string[];
}

export interface OnboardingItem {
  key: string;
  label: string;
  done: boolean;
  /** Optional items are shown but don't count towards "ready". */
  required: boolean;
  detail: string | null;
  /** Who usually fixes it. */
  owner: 'caregiver' | 'office';
}

export interface OnboardingChecklist {
  percent: number;
  ready: boolean;
  items: OnboardingItem[];
}

/** The checklist from facts about one staff member (pure; D-101). */
export function onboardingChecklist(facts: OnboardingFacts, requiredCredentials: string[]): OnboardingChecklist {
  const item = (key: string, label: string, done: boolean, owner: OnboardingItem['owner'], detail: string | null = null, required = true): OnboardingItem => ({
    key,
    label,
    done,
    required,
    detail: done ? null : detail,
    owner,
  });
  const valid = new Set(facts.validCredentialTypes);
  const expired = new Set(facts.expiredCredentialTypes);
  const items: OnboardingItem[] = [
    item('signed_in', 'Signed in to the app', facts.signedIn, 'caregiver', 'Send the welcome email again from Users if they lost it.'),
    item('phone', 'Phone number', facts.hasPhone, 'office'),
    item('address', 'Home address', facts.hasAddress, 'office', 'Used for travel distance when matching visits.'),
    item('hire_date', 'Hire date', facts.hasHireDate, 'office'),
    item('pay_rate', 'Pay rate', facts.hasPayRate, 'office', 'Hourly or per-visit rate, for payroll.'),
    item('availability', 'Weekly availability', facts.hasAvailability, 'office', 'When they can work, for scheduling.'),
    item('service_area', 'Service area ZIP codes', facts.hasServiceArea, 'office'),
    ...requiredCredentials.map((type) =>
      item(
        `credential:${type}`,
        credentialTypeLabel(type),
        valid.has(type),
        'office',
        expired.has(type) ? 'On file but expired — add the renewed one.' : 'Not on file — add it under Credentials.',
      ),
    ),
    item('phone_check_in', 'Phone check-in code', facts.hasPhoneCheckInCode, 'office', 'Only needed for clocking in by phone.', false),
  ];
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => i.done).length;
  const percent = required.length ? Math.round((done / required.length) * 100) : 100;
  return { percent, ready: done === required.length, items };
}
