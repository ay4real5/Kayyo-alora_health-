/**
 * Business dates in the demo agency's time zone (apps/api/src/seed/demo-seed.ts), never UTC (D-036): between midnight
 * UTC and midnight in Chicago the UTC date is already tomorrow, and the API rightly refuses "future" dates.
 */
export const DEMO_TIME_ZONE = 'America/Chicago';

/** YYYY-MM-DD, `offset` days from today, in the demo agency's time zone. */
export function demoDay(offset = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DEMO_TIME_ZONE }).format(new Date(Date.now() + offset * 86_400_000));
}
