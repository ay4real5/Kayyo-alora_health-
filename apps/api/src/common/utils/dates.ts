/**
 * Calendar dates travel as 'YYYY-MM-DD' strings and are stored in DATE columns as UTC midnight.
 * Times of day ('HH:MM') are stored in TIME columns on 1970-01-01 UTC.
 * Business "today" comes from AgencyClockService (agency timezone), never from UTC (DECISIONS D-036).
 */
export function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00Z`) : undefined;
}

export function fromDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Today's date in UTC. NOT for business dates — use AgencyClockService (agency timezone). Tests only. */
export function utcTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

export function fromTime(value: Date): string {
  return value.toISOString().slice(11, 16);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD plus whole months; the day is clamped to the month's end (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
