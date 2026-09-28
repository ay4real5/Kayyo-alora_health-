/** Payroll shapes (API D-064). */

export interface PayPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: 'open' | 'calculated' | 'approved' | 'exported';
  calculatedAt: string | null;
  approvedAt: string | null;
  exportedAt: string | null;
  staffCount?: number;
  totalGross?: number;
  totalMileage?: number;
}

export interface PayStub {
  id: string;
  payPeriod: { id: string; periodStart: string; periodEnd: string; payDate: string; status: string };
  staff: { id: string; userId: string; firstName: string; lastName: string; employeeId: string | null; discipline: string };
  regularHours: number;
  overtimeHours: number;
  visitCount: number;
  regularPay: number;
  overtimePay: number;
  perVisitPay: number;
  mileageMiles: number;
  mileageAmount: number;
  bonusAmount: number;
  deductions: number;
  grossPay: number;
  notes: string | null;
  lines: {
    id: string;
    visitId: string | null;
    serviceDate: string;
    patientLabel: string | null;
    hours: number | null;
    rate: number | null;
    amount: number;
    payType: 'hourly' | 'overtime' | 'per_visit' | 'mileage';
  }[];
}

export interface MileageEntry {
  id: string;
  staff: { id: string; firstName: string; lastName: string };
  travelDate: string;
  miles: number;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string | null;
}

export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
