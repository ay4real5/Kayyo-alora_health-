import { describe, expect, it } from 'vitest';
import { conversationTitle, dateRange, hoursBetween, mileageError, money, shortDate, shortWhen, timeOffCancellable, timeOffError } from './extras';

const p = (id: string, first: string, left = false) => ({ id, firstName: first, lastName: 'X', left });

describe('conversationTitle', () => {
  it('prefers the subject', () => {
    expect(conversationTitle({ subject: 'Weekend cover', participants: [p('me', 'Me'), p('a', 'Ann')] }, 'me')).toBe('Weekend cover');
  });
  it('names the other people, not me or people who left', () => {
    expect(conversationTitle({ subject: null, participants: [p('me', 'Me'), p('a', 'Ann'), p('b', 'Bo', true)] }, 'me')).toBe('Ann X');
  });
  it('shortens big groups', () => {
    const people = [p('me', 'Me'), p('a', 'Ann'), p('b', 'Bo'), p('c', 'Cy'), p('d', 'Di')];
    expect(conversationTitle({ subject: null, participants: people }, 'me')).toBe('Ann X, Bo X +2');
  });
  it('handles an empty group', () => {
    expect(conversationTitle({ subject: null, participants: [p('me', 'Me')] }, 'me')).toBe('Just you');
  });
});

describe('formatting', () => {
  it('formats money', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(money(0)).toBe('$0.00');
  });
  it('formats dates without timezone drift', () => {
    expect(dateRange('2026-09-01', '2026-09-14')).toBe('Sep 1 – Sep 14');
    expect(shortDate('2026-09-29')).toBe('Tue, Sep 29');
  });
  it('shortWhen shows a weekday within the week and a date after', () => {
    const now = new Date('2026-09-29T15:00:00');
    expect(shortWhen('2026-09-27T10:00:00', now)).toBe('Sun');
    expect(shortWhen('2026-09-01T10:00:00', now)).toBe('Sep 1');
  });
  it('counts shift hours, including overnight', () => {
    expect(hoursBetween('09:00', '13:30')).toBe(4.5);
    expect(hoursBetween('22:00', '06:00')).toBe(8);
  });
});

describe('mileageError', () => {
  const today = '2026-09-30';
  it('accepts a valid entry', () => {
    expect(mileageError('2026-09-29', '12.5', today)).toBeNull();
    expect(mileageError(today, '0.1', today)).toBeNull();
  });
  it('rejects a missing or malformed date', () => {
    expect(mileageError('09/29/2026', '5', today)).toMatch('YYYY-MM-DD');
    expect(mileageError('', '5', today)).toBeTruthy();
  });
  it('rejects a future date', () => {
    expect(mileageError('2026-10-01', '5', today)).toMatch(/future/);
  });
  it('rejects zero, negative, non-numeric and over-limit miles', () => {
    expect(mileageError(today, '0', today)).toBeTruthy();
    expect(mileageError(today, '-3', today)).toBeTruthy();
    expect(mileageError(today, 'abc', today)).toBeTruthy();
    expect(mileageError(today, '1000', today)).toBeNull();
    expect(mileageError(today, '1000.1', today)).toMatch(/1000/);
  });
});

describe('timeOffError', () => {
  const today = '2026-09-30';
  it('accepts a valid range', () => {
    expect(timeOffError('2026-10-05', '2026-10-07', today)).toBeNull();
    expect(timeOffError(today, today, today)).toBeNull();
  });
  it('rejects missing or malformed dates', () => {
    expect(timeOffError('', '2026-10-05', today)).toBeTruthy();
    expect(timeOffError('Oct 5', '2026-10-07', today)).toBeTruthy();
  });
  it('rejects end before start and a start in the past', () => {
    expect(timeOffError('2026-10-07', '2026-10-05', today)).toMatch(/on or after/);
    expect(timeOffError('2026-09-01', '2026-10-05', today)).toMatch(/past/);
  });
  it('rejects more than 60 days', () => {
    expect(timeOffError('2026-10-01', '2027-01-15', today)).toMatch(/60 days/);
    expect(timeOffError('2026-10-01', '2026-11-29', today)).toBeNull(); // exactly 60 days
  });
});

describe('timeOffCancellable', () => {
  const today = '2026-09-30';
  it('is true while pending', () => {
    expect(timeOffCancellable({ status: 'pending', startDate: '2026-09-01' }, today)).toBe(true);
  });
  it('is true for approved time off that has not started', () => {
    expect(timeOffCancellable({ status: 'approved', startDate: '2026-10-01' }, today)).toBe(true);
  });
  it('is false once approved time off has started, and for decided/denied/cancelled', () => {
    expect(timeOffCancellable({ status: 'approved', startDate: '2026-09-30' }, today)).toBe(false);
    expect(timeOffCancellable({ status: 'denied', startDate: '2026-10-01' }, today)).toBe(false);
    expect(timeOffCancellable({ status: 'cancelled', startDate: '2026-10-01' }, today)).toBe(false);
  });
});
