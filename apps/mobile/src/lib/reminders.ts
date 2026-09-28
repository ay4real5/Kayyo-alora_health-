import { zonedTimeToUtc } from '@alora/shared';

/** Minutes after the scheduled end before "did you forget to clock out?" (DECISIONS D-049). */
export const CLOCK_OUT_GRACE_MINUTES = 15;
/** If the visit already ran over when clocking in, remind this long after clocking in instead. */
export const LATE_START_REMINDER_MINUTES = 30;

/**
 * When to remind a clocked-in caregiver to clock out: 15 minutes after the scheduled end, in the agency's timezone.
 * Never in the past — a visit started after its scheduled end gets a reminder 30 minutes after clock-in.
 */
export function clockOutReminderAt(
  visit: { scheduledDate: string; scheduledEnd: string },
  timeZone: string,
  now: Date,
): Date {
  const end = zonedTimeToUtc(visit.scheduledDate, visit.scheduledEnd, timeZone).getTime();
  const at = end + CLOCK_OUT_GRACE_MINUTES * 60_000;
  return new Date(at > now.getTime() ? at : now.getTime() + LATE_START_REMINDER_MINUTES * 60_000);
}

/** One reminder per visit, so clocking out (or clocking in twice) replaces rather than duplicates it. */
export const reminderId = (visitId: string) => `clock-out-${visitId}`;
