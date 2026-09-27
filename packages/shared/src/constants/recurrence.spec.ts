import { recurrenceDates } from './recurrence.js';

// 2026-10-05 is a Monday.
describe('recurrenceDates', () => {
  it('weekly on Mon/Wed/Fri', () => {
    expect(
      recurrenceDates({ frequency: 'weekly', daysOfWeek: [1, 3, 5], startDate: '2026-10-05' }, '2026-10-05', '2026-10-18'),
    ).toEqual(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16']);
  });

  it('biweekly counts weeks from the start week', () => {
    expect(
      recurrenceDates({ frequency: 'biweekly', daysOfWeek: [2], startDate: '2026-10-05' }, '2026-10-01', '2026-11-10'),
    ).toEqual(['2026-10-06', '2026-10-20', '2026-11-03']);
  });

  it('stops at endDate and at maxOccurrences (counting from the start even when `from` is later)', () => {
    const p = { frequency: 'weekly' as const, daysOfWeek: [1], startDate: '2026-10-05' };
    expect(recurrenceDates({ ...p, endDate: '2026-10-19' }, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
    expect(recurrenceDates({ ...p, maxOccurrences: 3 }, '2026-10-12', '2026-12-31')).toEqual(['2026-10-12', '2026-10-19']);
  });

  it('handles Sunday and Saturday, and an empty window', () => {
    expect(
      recurrenceDates({ frequency: 'weekly', daysOfWeek: [0, 6], startDate: '2026-10-05' }, '2026-10-05', '2026-10-11'),
    ).toEqual(['2026-10-10', '2026-10-11']);
    expect(recurrenceDates({ frequency: 'weekly', daysOfWeek: [1], startDate: '2026-10-05' }, '2026-12-01', '2026-11-01')).toEqual([]);
  });
});
