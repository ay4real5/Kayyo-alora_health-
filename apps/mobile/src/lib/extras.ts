/** Helpers for Messages, Open shifts and My pay (D-083). Pure, so they're unit-tested. */

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: Person;
  content: string;
  isUrgent: boolean;
  document: { id: string; title: string; fileName: string; mimeType: string | null; isPhoto: boolean } | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  type: string;
  subject: string | null;
  patient: Person | null;
  participants: (Person & { left: boolean })[];
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unread: number;
  left: boolean;
}

/** An approved pay stub as /payroll/my-stubs returns it. */
export interface PayStub {
  id: string;
  payPeriod: { id: string; periodStart: string; periodEnd: string; payDate: string; status: string };
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
  lines: { id: string; serviceDate: string; patientLabel: string | null; hours: number | null; rate: number | null; amount: number; payType: string }[];
}

/** The subject, else the other people's names ("Ann Lee", "Ann Lee, Bo Diaz +2"). */
export function conversationTitle(c: Pick<Conversation, 'subject' | 'participants'>, meId: string): string {
  if (c.subject) return c.subject;
  const others = c.participants.filter((p) => p.id !== meId && !p.left);
  if (!others.length) return 'Just you';
  const names = others.slice(0, 2).map((p) => `${p.firstName} ${p.lastName}`);
  return others.length > 2 ? `${names.join(', ')} +${others.length - 2}` : names.join(', ');
}

/** Time for a list: "9:05 AM" today, "Mon" this week, else "Sep 3". */
export function shortWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days < 6) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** 1234.5 → "$1,234.50". */
export function money(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "2026-09-01", "2026-09-14" → "Sep 1 – Sep 14". */
export function dateRange(from: string, to: string): string {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(from)} – ${f(to)}`;
}

/** "2026-09-29" → "Tue, Sep 29". */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** A mileage entry as /payroll/mileage returns it (own entries only for a caregiver). */
export interface MileageEntry {
  id: string;
  staff: { id: string; firstName: string; lastName: string };
  travelDate: string;
  miles: number;
  description: string | null;
  visitId: string | null;
  status: string;
  rejectReason: string | null;
  decidedAt: string | null;
}

/** A time-off request as /time-off returns it (D-090). */
export interface TimeOffEntry {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  type: string;
  status: string;
  notes: string | null;
  decidedBy: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
}

/** Same cap as the API's LogMileageDto (@Max(1000)). */
export const MAX_MILEAGE_MILES = 1000;
/** Same cap as the API's MAX_TIME_OFF_DAYS. */
export const MAX_TIME_OFF_DAYS = 60;

/** The local date on this phone as "YYYY-MM-DD" (caregiver's day, not UTC). */
export function localToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA');
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Mileage form check mirroring the API's DTO: date-only, not in the future; miles > 0 and ≤ the DTO max. */
export function mileageError(travelDate: string, milesText: string, today: string = localToday()): string | null {
  if (!DATE_ONLY.test(travelDate)) return 'Enter the date as YYYY-MM-DD.';
  if (travelDate > today) return 'The travel date can’t be in the future.';
  const miles = Number(milesText);
  if (!Number.isFinite(miles) || miles <= 0) return 'Enter the miles driven.';
  if (miles > MAX_MILEAGE_MILES) return `Mileage can’t be more than ${MAX_MILEAGE_MILES} miles — split it across days.`;
  return null;
}

/** Time-off form check mirroring the API: both dates, end ≥ start, nothing in the past, ≤ MAX_TIME_OFF_DAYS. */
export function timeOffError(startDate: string, endDate: string, today: string = localToday()): string | null {
  if (!DATE_ONLY.test(startDate) || !DATE_ONLY.test(endDate)) return 'Enter both dates as YYYY-MM-DD.';
  if (endDate < startDate) return 'The last day must be on or after the first day.';
  if (startDate < today) return 'Time off can’t start in the past.';
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_TIME_OFF_DAYS) return `Ask for at most ${MAX_TIME_OFF_DAYS} days at a time — speak to the office about longer leave.`;
  return null;
}

/** Whether the requester can still cancel: pending, or approved but not started yet (same rule as the API). */
export function timeOffCancellable(t: Pick<TimeOffEntry, 'status' | 'startDate'>, today: string = localToday()): boolean {
  return t.status === 'pending' || (t.status === 'approved' && t.startDate > today);
}

/** Hours between two "HH:MM" times (overnight wraps). */
export function hoursBetween(start: string, end: string): number {
  const mins = (t: string) => {
    const [h = 0, m = 0] = t.split(':').map(Number);
    return h * 60 + m;
  };
  let diff = mins(end) - mins(start);
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}
