/** Recurring visit patterns (DECISIONS D-031). */
export const RECURRENCE_FREQUENCIES = ['weekly', 'biweekly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export interface RecurrencePattern {
  frequency: RecurrenceFrequency;
  /** 0 = Sunday … 6 = Saturday */
  daysOfWeek: number[];
  /** YYYY-MM-DD, first possible date of the series. */
  startDate: string;
  /** YYYY-MM-DD, last possible date (inclusive). */
  endDate?: string | null;
  /** The series stops after this many dates (counted from startDate, including dates later skipped). */
  maxOccurrences?: number | null;
}

const MS_PER_DAY = 86_400_000;
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);
const fromDayNumber = (n: number) => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);

/**
 * The series' dates that fall within [from, until] (inclusive), in order.
 * "biweekly" means every other week, counted from the week (Sunday-based) containing startDate.
 * Deterministic: the same pattern always yields the same dates, so generation can be repeated safely.
 */
export function recurrenceDates(pattern: RecurrencePattern, from: string, until: string): string[] {
  const days = new Set(pattern.daysOfWeek);
  const start = dayNumber(pattern.startDate);
  const last = Math.min(dayNumber(until), pattern.endDate ? dayNumber(pattern.endDate) : Infinity);
  const firstWanted = dayNumber(from);
  // Day 0 (1970-01-01) was a Thursday; shift so weeks start on Sunday.
  const weekOf = (n: number) => Math.floor((n + 4) / 7);
  const startWeek = weekOf(start);

  const result: string[] = [];
  let counted = 0;
  for (let n = start; n <= last; n++) {
    const dow = (n + 4) % 7;
    if (!days.has(dow)) continue;
    if (pattern.frequency === 'biweekly' && (weekOf(n) - startWeek) % 2 !== 0) continue;
    counted++;
    if (pattern.maxOccurrences && counted > pattern.maxOccurrences) break;
    if (n >= firstWanted) result.push(fromDayNumber(n));
  }
  return result;
}
