import type { ReferralStatus } from '@alora/shared';

/** Referral pipeline (D-098). */
export interface Referral {
  id: string;
  status: ReferralStatus;
  channel: 'manual' | 'web_form';
  clientFirstName: string;
  clientLastName: string;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  zip: string | null;
  payerType: string;
  careNeeds: string | null;
  contactName: string | null;
  contactRelationship: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  lostReason: string | null;
  nextFollowUp: string | null;
  source: { id: string; name: string; sourceType: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  patientId: string | null;
  statusChangedAt: string;
  admittedAt: string | null;
  createdAt: string;
}

export interface ReferralEvent {
  id: string;
  eventType: 'created' | 'status' | 'note' | 'admitted';
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  by: string | null;
  createdAt: string;
}

export interface ReferralSource {
  id: string;
  name: string;
  sourceType: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

export interface SourceReportRow {
  sourceId: string | null;
  name: string;
  sourceType: string | null;
  referrals: number;
  admitted: number;
  lost: number;
  open: number;
  conversionRate: number | null;
  avgDaysToAdmit: number | null;
}
