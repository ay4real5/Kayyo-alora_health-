import { describe, expect, it } from 'vitest';
import { conversationTitle, dateRange, hoursBetween, money, shortDate, shortWhen } from './extras';

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
