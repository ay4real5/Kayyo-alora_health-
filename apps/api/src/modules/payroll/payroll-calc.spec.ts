import { describe, expect, it } from 'vitest';
import { calculatePay, grossPay, workweekStart, type PayVisit } from './payroll-calc.js';

let n = 0;
const visit = (date: string, hours: number, inPeriod = true, start = '09:00'): PayVisit => ({
  visitId: `v${++n}`,
  date,
  startedAt: `${date}T${start}:00Z`,
  minutes: Math.round(hours * 60),
  patientLabel: 'Pat S.',
  inPeriod,
});
const hourly = { hourlyRate: 20, perVisitRate: null, overtimeRate: null };
const base = { mileage: [], mileageRate: 0.7, workweekStartDay: 0 };

describe('workweekStart', () => {
  it('finds the start of the workweek for any start day', () => {
    expect(workweekStart('2026-09-30', 0)).toBe('2026-09-27'); // Wednesday → Sunday
    expect(workweekStart('2026-09-27', 0)).toBe('2026-09-27');
    expect(workweekStart('2026-09-30', 1)).toBe('2026-09-28'); // Monday-start weeks
    expect(workweekStart('2026-09-27', 1)).toBe('2026-09-21');
  });
});

describe('calculatePay', () => {
  it('pays hourly staff for clocked time, overtime past 40 hours in a workweek at 1.5×', () => {
    // Sun 27 Sep – Sat 3 Oct: five 9-hour days = 45 hours → 40 regular + 5 overtime.
    const visits = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((d) => visit(d, 9));
    const r = calculatePay({ ...base, rates: hourly, visits });
    expect(r).toMatchObject({ basis: 'hourly', regularHours: 40, overtimeHours: 5, visitCount: 5, regularPay: 800, overtimePay: 150 });
    const last = r.lines.filter((l) => l.date === '2026-10-01');
    expect(last.map((l) => [l.payType, l.hours, l.rate, l.amount])).toEqual([
      ['hourly', 4, 20, 80],
      ['overtime', 5, 30, 150],
    ]);
  });

  it('counts overtime per workweek, not per pay period', () => {
    // Two weeks of 35 hours each = 70 hours, but never over 40 in a week → no overtime.
    const visits = [...['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'], ...['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']].map((d) =>
      visit(d, 7),
    );
    const r = calculatePay({ ...base, rates: hourly, visits });
    expect(r).toMatchObject({ regularHours: 70, overtimeHours: 0, regularPay: 1400 });
  });

  it('counts hours from the week before the period toward the 40, without paying them again', () => {
    // The period starts Wednesday; Sun–Tue (already paid) had 36 hours. Wednesday's 8 hours: 4 regular + 4 overtime.
    const visits = [visit('2026-09-27', 12, false), visit('2026-09-28', 12, false), visit('2026-09-29', 12, false), visit('2026-09-30', 8)];
    const r = calculatePay({ ...base, rates: hourly, visits });
    expect(r).toMatchObject({ visitCount: 1, regularHours: 4, overtimeHours: 4, regularPay: 80, overtimePay: 120 });
  });

  it('uses the staff member’s own overtime rate when set, and orders visits within a day by clock-in', () => {
    const visits = [visit('2026-09-28', 38, true, '06:00'), visit('2026-09-28', 3, true, '20:00')];
    const r = calculatePay({ ...base, rates: { hourlyRate: 20, perVisitRate: null, overtimeRate: 35 }, visits });
    expect(r.lines.map((l) => [l.payType, l.hours, l.amount])).toEqual([
      ['hourly', 38, 760],
      ['hourly', 2, 40],
      ['overtime', 1, 35],
    ]);
  });

  it('pays per-visit staff per visit with no overtime', () => {
    const visits = ['2026-09-28', '2026-09-29', '2026-09-30'].map((d) => visit(d, 20));
    const r = calculatePay({ ...base, rates: { hourlyRate: 40, perVisitRate: 95, overtimeRate: null }, visits });
    expect(r).toMatchObject({ basis: 'per_visit', perVisitPay: 285, regularPay: 0, overtimeHours: 0, visitCount: 3 });
  });

  it('reimburses approved mileage separately and leaves it out of gross pay', () => {
    const r = calculatePay({ ...base, rates: hourly, visits: [visit('2026-09-28', 2)], mileage: [{ date: '2026-09-28', miles: 12.5 }, { date: '2026-09-29', miles: 3 }] });
    expect(r).toMatchObject({ mileageMiles: 15.5, mileageAmount: 10.85 });
    expect(grossPay({ ...r, bonusAmount: 25, deductions: 5 })).toBe(60); // 40 regular + 25 bonus − 5
  });

  it('flags staff without a pay rate instead of paying zero silently', () => {
    const r = calculatePay({ ...base, rates: { hourlyRate: null, perVisitRate: null, overtimeRate: null }, visits: [visit('2026-09-28', 2)] });
    expect(r).toMatchObject({ basis: 'none', visitCount: 1, regularPay: 0, lines: [] });
  });
});
