/**
 * Authorization forecast (D-093, Command Center): will this authorization run over before it ends, and when does it
 * run out? Pure, so it is unit-tested. Two estimates, and the higher one wins:
 * - booked: what is already used plus what is scheduled;
 * - pace: the usage so far, spread evenly over the whole authorization period (only once enough of it has passed to
 *   mean something).
 */

const DAY_MS = 86_400_000;
/** Below this many days into the authorization, the pace estimate is too noisy to show. */
export const MIN_DAYS_FOR_PACE = 7;
/** "Close to the limit" — warn at this share of the authorized amount. */
export const NEAR_LIMIT_SHARE = 0.9;

export interface ForecastInput {
  startDate: string;
  endDate: string;
  today: string;
  authorized: number | null;
  used: number;
  planned: number;
}

export interface Forecast {
  /** The higher of booked and pace (null when there is no limit to compare with). */
  projected: number | null;
  /** How far over the limit the projection is (0 when it fits). */
  overBy: number;
  /** At the current pace, the day the authorized amount is used up — when that is before the end date. */
  runsOutOn: string | null;
  level: 'over' | 'near' | 'ok';
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function forecastAuthorization(input: ForecastInput): Forecast {
  const { authorized, used, planned, startDate, endDate, today } = input;
  if (authorized === null || authorized <= 0) return { projected: null, overBy: 0, runsOutOn: null, level: 'ok' };
  const total = days(startDate, endDate);
  const elapsed = Math.min(total, Math.max(0, days(startDate, today)));
  const booked = used + planned;
  const perDay = elapsed > 0 ? used / elapsed : 0;
  const pace = elapsed >= MIN_DAYS_FOR_PACE ? perDay * total : 0;
  const projected = round2(Math.max(booked, pace));
  const overBy = round2(Math.max(0, projected - authorized));

  let runsOutOn: string | null = null;
  if (elapsed >= MIN_DAYS_FOR_PACE && perDay > 0) {
    const dayIndex = Math.ceil(authorized / perDay); // 1 = the start date
    if (dayIndex < total) runsOutOn = addDays(startDate, Math.max(0, dayIndex - 1));
  }
  const level = overBy > 0 ? 'over' : projected >= authorized * NEAR_LIMIT_SHARE ? 'near' : 'ok';
  return { projected, overBy, runsOutOn, level };
}
