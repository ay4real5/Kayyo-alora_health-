/**
 * Pay calculation for one staff member in one pay period (DECISIONS D-064). Pure and unit-tested.
 *
 * - Per-visit staff (a per-visit rate is set): visits × rate, no overtime (fee-basis clinicians).
 * - Hourly staff: actual clocked time; FLSA overtime (home care workers are non-exempt since 2015) for hours over 40 in
 *   a **workweek**, at the overtime rate (default 1.5 × hourly). Workweeks can straddle pay periods: visits from the
 *   part of the week before the period count toward the 40 hours but were paid in the previous period.
 * - Mileage: approved miles × rate, a separate (non-taxable) reimbursement.
 */

export interface PayVisit {
  visitId: string;
  /** YYYY-MM-DD (agency timezone). */
  date: string;
  /** Clock-in time, for ordering within a day. */
  startedAt: string;
  minutes: number;
  patientLabel: string | null;
  /** False for visits before the period that only count toward the workweek's 40 hours. */
  inPeriod: boolean;
}

export interface PayRates {
  hourlyRate: number | null;
  perVisitRate: number | null;
  overtimeRate: number | null;
}

export interface PayLine {
  visitId: string | null;
  date: string;
  patientLabel: string | null;
  hours: number | null;
  rate: number | null;
  amount: number;
  payType: 'hourly' | 'overtime' | 'per_visit' | 'mileage';
}

export interface PayResult {
  basis: 'hourly' | 'per_visit' | 'none';
  regularHours: number;
  overtimeHours: number;
  visitCount: number;
  regularPay: number;
  overtimePay: number;
  perVisitPay: number;
  mileageMiles: number;
  mileageAmount: number;
  lines: PayLine[];
}

export const OVERTIME_THRESHOLD_HOURS = 40;
const cents = (n: number) => Math.round(n * 100) / 100;
const hundredths = (n: number) => Math.round(n * 100) / 100;

/** The first day of the workweek containing `date` (0 = Sunday … 6 = Saturday). */
export function workweekStart(date: string, startDay: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() - startDay + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function calculatePay(input: {
  rates: PayRates;
  visits: PayVisit[];
  mileage: { date: string; miles: number }[];
  mileageRate: number;
  workweekStartDay: number;
}): PayResult {
  const { rates } = input;
  const paid = input.visits.filter((v) => v.inPeriod);
  const lines: PayLine[] = [];
  const result: PayResult = {
    basis: rates.perVisitRate !== null && rates.perVisitRate > 0 ? 'per_visit' : rates.hourlyRate !== null && rates.hourlyRate > 0 ? 'hourly' : 'none',
    regularHours: 0,
    overtimeHours: 0,
    visitCount: paid.length,
    regularPay: 0,
    overtimePay: 0,
    perVisitPay: 0,
    mileageMiles: 0,
    mileageAmount: 0,
    lines,
  };

  if (result.basis === 'per_visit') {
    const rate = rates.perVisitRate!;
    for (const v of [...paid].sort(order)) {
      lines.push({ visitId: v.visitId, date: v.date, patientLabel: v.patientLabel, hours: hundredths(v.minutes / 60), rate, amount: rate, payType: 'per_visit' });
    }
    result.perVisitPay = cents(rate * paid.length);
  } else if (result.basis === 'hourly') {
    const rate = rates.hourlyRate!;
    const otRate = rates.overtimeRate ?? cents(rate * 1.5);
    const weeks = new Map<string, PayVisit[]>();
    for (const v of input.visits) {
      const key = workweekStart(v.date, input.workweekStartDay);
      weeks.set(key, [...(weeks.get(key) ?? []), v]);
    }
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    for (const week of [...weeks.keys()].sort()) {
      let worked = 0; // minutes so far this workweek, including before the period
      for (const v of weeks.get(week)!.sort(order)) {
        const regular = Math.max(0, Math.min(v.minutes, OVERTIME_THRESHOLD_HOURS * 60 - worked));
        const overtime = v.minutes - regular;
        worked += v.minutes;
        if (!v.inPeriod) continue;
        regularMinutes += regular;
        overtimeMinutes += overtime;
        if (regular > 0) {
          const hours = hundredths(regular / 60);
          lines.push({ visitId: v.visitId, date: v.date, patientLabel: v.patientLabel, hours, rate, amount: cents(hours * rate), payType: 'hourly' });
        }
        if (overtime > 0) {
          const hours = hundredths(overtime / 60);
          lines.push({ visitId: v.visitId, date: v.date, patientLabel: v.patientLabel, hours, rate: otRate, amount: cents(hours * otRate), payType: 'overtime' });
        }
      }
    }
    result.regularHours = hundredths(regularMinutes / 60);
    result.overtimeHours = hundredths(overtimeMinutes / 60);
    result.regularPay = cents(lines.filter((l) => l.payType === 'hourly').reduce((s, l) => s + l.amount, 0));
    result.overtimePay = cents(lines.filter((l) => l.payType === 'overtime').reduce((s, l) => s + l.amount, 0));
  }

  for (const m of input.mileage) {
    const amount = cents(m.miles * input.mileageRate);
    lines.push({ visitId: null, date: m.date, patientLabel: null, hours: null, rate: input.mileageRate, amount, payType: 'mileage' });
    result.mileageMiles = hundredths(result.mileageMiles + m.miles);
    result.mileageAmount = cents(result.mileageAmount + amount);
  }
  return result;
}

/** Taxable gross: everything except the mileage reimbursement. */
export function grossPay(p: { regularPay: number; overtimePay: number; perVisitPay: number; bonusAmount: number; deductions: number }): number {
  return cents(p.regularPay + p.overtimePay + p.perVisitPay + p.bonusAmount - p.deductions);
}

const order = (a: PayVisit, b: PayVisit) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt);
