import { describe, expect, it } from 'vitest';
import { isExpired, monthsToEnsure, parsePartitionName, partitionName } from './audit-partitions.js';

describe('audit partition helpers', () => {
  it('names partitions audit_logs_yYYYYmMM with a zero-padded month, and parses them back', () => {
    expect(partitionName(2026, 9)).toBe('audit_logs_y2026m09');
    expect(partitionName(2031, 12)).toBe('audit_logs_y2031m12');
    expect(parsePartitionName('audit_logs_y2026m09')).toEqual({ year: 2026, month: 9 });
    expect(parsePartitionName('audit_logs_y2031m12')).toEqual({ year: 2031, month: 12 });
  });

  it('rejects the default partition and anything off-scheme', () => {
    for (const name of [
      'audit_logs_default',
      'audit_logs',
      'audit_logs_y2026m9',
      'audit_logs_y202m09',
      'audit_logs_y2026m00',
      'audit_logs_y2026m13',
      'audit_logs_y2026m09_extra',
      'other_table',
    ]) {
      expect(parsePartitionName(name), name).toBeNull();
    }
  });

  it('monthsToEnsure covers the current UTC month plus three, across a year boundary', () => {
    const months = monthsToEnsure(new Date('2026-11-15T08:00:00Z'));
    expect(months.map((m) => [m.year, m.month])).toEqual([
      [2026, 11],
      [2026, 12],
      [2027, 1],
      [2027, 2],
    ]);
    expect(months[0]!.from).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(months[0]!.to).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(months[3]!.from).toEqual(new Date('2027-02-01T00:00:00Z'));
    expect(months[3]!.to).toEqual(new Date('2027-03-01T00:00:00Z'));
  });

  it('uses UTC, not local time: 2026-12-31 23:30 EST is already January', () => {
    const months = monthsToEnsure(new Date('2026-12-31T23:30:00-05:00'));
    expect(months[0]!.year).toBe(2027);
    expect(months[0]!.month).toBe(1);
  });

  it('isExpired drops a partition only once its whole month is past retention', () => {
    // now = Oct 2032, retention 72 months → cutoff is the start of Oct 2026.
    const now = new Date('2032-10-05T12:00:00Z');
    expect(isExpired(2026, 9, now, 72)).toBe(true); // Sep 2026 ends Oct 1 2026 → expired
    expect(isExpired(2026, 10, now, 72)).toBe(false); // Oct 2026 still holds in-window rows
  });
});
