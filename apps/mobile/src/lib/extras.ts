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
  document: { id: string; title: string; fileName: string } | null;
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
