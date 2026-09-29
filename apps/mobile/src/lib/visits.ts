/** A visit as the calendar endpoint returns it (the caregiver's own). */
export interface Visit {
  id: string;
  patient: { firstName: string; lastName: string };
  visitType: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
}

/** "13:05" → "1:05 PM". */
export function time(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export const humanize = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).replaceAll('_', ' ');

/** "Good morning" / "Good afternoon" / "Good evening" for an hour 0–23. */
export function greeting(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** "2026-09-29" → "Tuesday, September 29". */
export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** The next visit to go to: one already in progress, else the first scheduled one. */
export function nextVisit<T extends { status: string }>(visits: T[]): T | null {
  return visits.find((v) => v.status === 'in_progress') ?? visits.find((v) => v.status === 'scheduled') ?? null;
}
