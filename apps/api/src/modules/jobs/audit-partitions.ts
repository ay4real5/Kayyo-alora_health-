/** Pure helpers for monthly audit_logs partitioning (D-067) — no database, unit-testable. */

export interface PartitionMonth {
  year: number;
  /** 1–12. */
  month: number;
  /** First day of the month, UTC. */
  from: Date;
  /** First day of the next month, UTC (exclusive upper bound). */
  to: Date;
}

/** audit_logs_y2026m09 — zero-padded month so names sort chronologically. */
export function partitionName(year: number, month: number): string {
  return `audit_logs_y${year}m${String(month).padStart(2, '0')}`;
}

/** Parses our partition names only; never matches audit_logs_default or anything else. */
export function parsePartitionName(name: string): { year: number; month: number } | null {
  const match = /^audit_logs_y(\d{4})m(\d{2})$/.exec(name);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/** The current UTC month plus the next three, so inserts always have a partition ready. */
export function monthsToEnsure(now: Date): PartitionMonth[] {
  const months: PartitionMonth[] = [];
  for (let i = 0; i <= 3; i++) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    months.push({
      year: from.getUTCFullYear(),
      month: from.getUTCMonth() + 1,
      from,
      to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)),
    });
  }
  return months;
}

/** A partition is expired when its (exclusive) upper bound is at or before the start of the
 * current UTC month shifted back by retentionMonths — i.e. every row in it is older than retention. */
export function isExpired(year: number, month: number, now: Date, retentionMonths: number): boolean {
  const upperBound = Date.UTC(year, month, 1); // month is 1-based → this is the first of the next month
  const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - retentionMonths, 1);
  return upperBound <= cutoff;
}
