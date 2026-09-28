/** Billing setup and authorization shapes as returned by the API (D-050). Synced by hand (D-035). */

export interface Payer {
  id: string;
  name: string;
  payerType: string;
  payerIdCode: string | null;
  state: string | null;
  phone: string | null;
  timelyFilingDays: number;
  requiresAuthorization: boolean;
  isActive: boolean;
}

export interface ServiceCode {
  id: string;
  code: string;
  codeType: string;
  description: string | null;
  defaultRate: number | null;
  unitType: string;
  requiresAuth: boolean;
  isActive: boolean;
}

export interface PayerRate {
  id: string;
  serviceCode: { id: string; code: string; unitType: string };
  rate: number;
  effectiveDate: string;
  endDate: string | null;
  modifier1: string | null;
  modifier2: string | null;
}

type Amounts = { visits: number; hours: number };

export interface Authorization {
  id: string;
  payer: { id: string; name: string };
  authorizationNumber: string | null;
  serviceCode: string | null;
  startDate: string;
  endDate: string;
  authorizedVisits: number | null;
  authorizedHours: number | null;
  status: string;
  state: 'active' | 'upcoming' | 'expired' | 'exhausted' | 'cancelled';
  expiringSoon: boolean;
  used: Amounts;
  planned: Amounts;
  remaining: { visits: number | null; hours: number | null };
  notes: string | null;
}

export interface ClaimLine {
  id: string;
  lineNumber: number;
  visitId: string | null;
  serviceCode: string;
  modifier1: string | null;
  serviceDate: string;
  units: number;
  unitRate: number;
  chargeAmount: number;
  placeOfService: string;
  active: boolean;
}

export interface Claim {
  id: string;
  claimNumber: string;
  claimType: string;
  status: string;
  frequencyCode: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  payer: { id: string; name: string; payerType: string };
  memberId: string | null;
  diagnosisCodes: string[];
  billingPeriodStart: string;
  billingPeriodEnd: string;
  totalCharges: number;
  totalPaid: number;
  qaPassed: boolean | null;
  qaErrors: { visitId: string; messages: string[] }[] | null;
  voidReason: string | null;
  lines: ClaimLine[];
  createdAt: string;
}
