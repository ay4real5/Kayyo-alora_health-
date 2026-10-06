import { describe, expect, it } from 'vitest';
import { forecastAuthorization } from './authorization-forecast.js';

// A 30-day authorization in September: 120 hours.
const base = { startDate: '2026-09-01', endDate: '2026-09-30', authorized: 120 };

describe('forecastAuthorization', () => {
  it('projects the pace over the whole period and finds the day it runs out', () => {
    // 15 days in, 72 h used: 4.8 h/day → 144 h projected, 24 over; 120 / 4.8 = day 25.
    const f = forecastAuthorization({ ...base, today: '2026-09-15', used: 72, planned: 0 });
    expect(f).toEqual({ projected: 144, overBy: 24, runsOutOn: '2026-09-25', level: 'over' });
  });

  it('uses what is already booked when that is higher than the pace', () => {
    const f = forecastAuthorization({ ...base, today: '2026-09-10', used: 30, planned: 100 });
    expect(f.projected).toBe(130);
    expect(f.overBy).toBe(10);
    expect(f.level).toBe('over');
  });

  it('warns when the projection is close to the limit', () => {
    // 10 days in, 37 h used: 3.7 h/day → 111 h (92.5%).
    expect(forecastAuthorization({ ...base, today: '2026-09-10', used: 37, planned: 0 })).toMatchObject({ level: 'near', overBy: 0, runsOutOn: null });
  });

  it('ignores the pace in the first week (too noisy) and is fine when nothing is limited', () => {
    expect(forecastAuthorization({ ...base, today: '2026-09-03', used: 20, planned: 0 })).toMatchObject({ projected: 20, level: 'ok', runsOutOn: null });
    expect(forecastAuthorization({ ...base, authorized: null, today: '2026-09-15', used: 500, planned: 0 })).toEqual({
      projected: null,
      overBy: 0,
      runsOutOn: null,
      level: 'ok',
    });
  });

  it('caps "elapsed" at the end date', () => {
    expect(forecastAuthorization({ ...base, today: '2026-10-20', used: 100, planned: 0 }).projected).toBe(100);
  });
});
