/** Billing setup and authorization shapes as returned by the API (D-050). Synced by hand (D-035). */

export interface Payer {
  id: string;
  name: string;
  payerType: string;
  /** 837P / 837I; null = 837I for Medicare, else 837P (D-061). */
  claimFormat: string | null;
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
  revenueCode: string | null;
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
  submittedAt: string | null;
  payerClaimNumber: string | null;
  originalClaimId: string | null;
  denial: { code: string | null; reason: string | null; deniedAt: string | null; appealDeadline: string | null } | null;
  appeals: {
    id: string;
    level: number;
    status: 'filed' | 'won' | 'lost' | 'withdrawn';
    filedOn: string;
    reason: string;
    reference: string | null;
    outcomeNotes: string | null;
    decidedOn: string | null;
    createdBy: { firstName: string; lastName: string };
  }[];
  /** Institutional (837I) claims only (D-061). */
  institutional: { typeOfBill: string | null; patientStatus: string | null; hippsCode: string | null; cbsaCode: string | null } | null;
  lines: ClaimLine[];
  createdAt: string;
}

/** A private-pay invoice (D-059). */
export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  payer: { id: string; name: string };
  issueDate: string;
  dueDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  overdue: boolean;
  billTo: { name: string; addressLines: string[] };
  sentAt: string | null;
  paidAt: string | null;
  voidReason: string | null;
  notes: string | null;
  lines: { id: string; visitId: string | null; serviceDate: string; serviceCode: string | null; description: string; quantity: number; unitRate: number; total: number }[];
  payments: { id: string; amount: number; paidOn: string; method: string; reference: string | null; recordedBy: { firstName: string; lastName: string } }[];
}
