import { describe, expect, it } from 'vitest';
import { clockOutReminderAt, reminderId } from './reminders';

describe('clockOutReminderAt', () => {
  const visit = { scheduledDate: '2026-09-28', scheduledEnd: '11:00' };

  it('is 15 minutes after the scheduled end, in the agency timezone', () => {
    // 11:00 in Chicago (CDT, UTC-5) is 16:00Z → reminder 16:15Z.
    expect(clockOutReminderAt(visit, 'America/Chicago', new Date('2026-09-28T15:00:00Z')).toISOString()).toBe(
      '2026-09-28T16:15:00.000Z',
    );
  });

  it('is never in the past: a visit started after its end gets a reminder 30 minutes later', () => {
    const now = new Date('2026-09-28T17:00:00Z');
    expect(clockOutReminderAt(visit, 'America/Chicago', now).toISOString()).toBe('2026-09-28T17:30:00.000Z');
  });

  it('has one id per visit', () => {
    expect(reminderId('v1')).toBe('clock-out-v1');
  });
});
