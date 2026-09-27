/**
 * Calendar dates travel as 'YYYY-MM-DD' strings and are stored in DATE columns as UTC midnight.
 * Times of day ('HH:MM') are stored in TIME columns on 1970-01-01 UTC.
 * "Today" is UTC for now — switch to the agency's timezone with scheduling (DECISIONS D-027).
 */
export function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00Z`) : undefined;
}

export function fromDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function today(): Date {
  return toDate(todayString())!;
}

export function todayString(): string {
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
