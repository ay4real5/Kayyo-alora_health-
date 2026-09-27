import { disciplineFits, todayInTimeZone, VISIT_TYPES } from './scheduling.js';

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
