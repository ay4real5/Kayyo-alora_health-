import { describe, expect, it } from 'vitest';
import { expiryStage } from './credential-expiry.job.js';

describe('expiryStage', () => {
  const today = '2026-09-28';
  it('alerts inside the credential’s own warning window, then in the last week, then when expired', () => {
    expect(expiryStage('2026-12-31', today, 30)).toBeNull();
    expect(expiryStage('2026-10-28', today, 30)).toBe('due'); // exactly 30 days
    expect(expiryStage('2026-10-29', today, 30)).toBeNull();
    expect(expiryStage('2026-11-27', today, 60)).toBe('due'); // a longer window
    expect(expiryStage('2026-10-05', today, 30)).toBe('week');
    expect(expiryStage(today, today, 30)).toBe('week'); // expires today = still valid today
    expect(expiryStage('2026-09-27', today, 30)).toBe('expired');
  });

  it('never alerts later than a week out, even with a tiny window', () => {
    expect(expiryStage('2026-10-04', today, 0)).toBe('week');
    expect(expiryStage('2026-10-06', today, 0)).toBeNull();
  });
});
