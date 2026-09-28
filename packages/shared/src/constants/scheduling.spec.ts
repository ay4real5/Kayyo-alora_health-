import { disciplineFits, todayInTimeZone, VISIT_TYPES, zonedTimeToUtc } from './scheduling.js';

describe('scheduling constants', () => {
  it('knows which disciplines fit a visit type', () => {
    expect(disciplineFits('physical_therapy', 'PTA')).toBe(true);
    expect(disciplineFits('pt_evaluation', 'PTA')).toBe(false);
    expect(disciplineFits('skilled_nursing', 'HHA')).toBe(false);
    expect(VISIT_TYPES).toContain('personal_care');
  });

  it("computes today's date in the agency's timezone, not UTC", () => {
    const lateEveningInNewYork = new Date('2026-09-28T02:30:00Z'); // 22:30 on the 27th in New York
    expect(todayInTimeZone('America/New_York', lateEveningInNewYork)).toBe('2026-09-27');
    expect(todayInTimeZone('UTC', lateEveningInNewYork)).toBe('2026-09-28');
    expect(todayInTimeZone('America/Los_Angeles', lateEveningInNewYork)).toBe('2026-09-27');
  });
});

describe('zonedTimeToUtc', () => {
  it('converts local wall-clock time to UTC, across daylight saving', () => {
    // Chicago: CDT (UTC-5) in summer, CST (UTC-6) in winter; the switch was 2026-11-01.
    expect(zonedTimeToUtc('2026-10-05', '09:00', 'America/Chicago').toISOString()).toBe('2026-10-05T14:00:00.000Z');
    expect(zonedTimeToUtc('2026-12-05', '09:00', 'America/Chicago').toISOString()).toBe('2026-12-05T15:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-01', '23:30', 'America/New_York').toISOString()).toBe('2026-07-02T03:30:00.000Z');
    expect(zonedTimeToUtc('2026-07-01', '08:00', 'UTC').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-01', '08:00', 'Asia/Kolkata').toISOString()).toBe('2026-07-01T02:30:00.000Z');
  });
});

