import { validateSync } from 'class-validator';
import { IsDateOnly } from './is-date-only.js';

class Probe {
  @IsDateOnly({ notInFuture: true })
  date!: string;
}

const valid = (date: string) => {
  const probe = Object.assign(new Probe(), { date });
  return validateSync(probe).length === 0;
};
const utcDate = (offsetHours: number) => new Date(Date.now() + offsetHours * 3_600_000).toISOString().slice(0, 10);

describe('IsDateOnly({ notInFuture })', () => {
  it('accepts real dates up to "today" anywhere on Earth', () => {
    expect(valid(utcDate(0))).toBe(true);
    expect(valid(utcDate(-24))).toBe(true);
    expect(valid(utcDate(14))).toBe(true); // already today in UTC+14, even if still yesterday in UTC
  });

  it('rejects dates beyond that, impossible dates and bad formats', () => {
    expect(valid(utcDate(48))).toBe(false);
    expect(valid('2026-02-30')).toBe(false);
    expect(valid('2026-2-3')).toBe(false);
    expect(valid('1899-12-31')).toBe(false);
  });
});
