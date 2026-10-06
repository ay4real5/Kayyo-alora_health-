/**
 * Caregiver matching (D-094): how well one eligible caregiver fits one visit, with the reasons in plain words. Pure, so
 * it is unit-tested; the service gathers the facts. Hard rules (double booking, time off, expired credentials,
 * discipline, declined by the patient) are applied before this — everyone scored here could take the visit.
 */

export interface MatchFacts {
  /** Completed visits with this patient in the last 180 days. */
  visitsWithPatient: number;
  preferredByPatient: boolean;
  /** Patient's preferred caregiver gender and this caregiver's (null = not recorded). */
  genderPreference: string | null;
  gender: string | null;
  /** Patient's preferred language and the caregiver's languages. */
  languagePreference: string | null;
  languages: string[];
  /** Straight-line miles from the caregiver's home, when both locations are known. */
  miles: number | null;
  /** Fallbacks when miles is unknown. */
  sameZip: boolean;
  inServiceArea: boolean;
  /** Hours already booked that week (Mon–Sun) and this visit's hours. */
  weekHours: number;
  visitHours: number;
  /** Last 90 days: visits worked, missed, and arrived late. */
  recentVisits: number;
  missed: number;
  late: number;
  /** Scheduling warnings (not blocking), e.g. outside their usual availability. */
  warnings: string[];
}

export interface MatchScore {
  score: number;
  /** Good things first, then cautions. */
  reasons: { text: string; good: boolean }[];
}

export const OVERTIME_HOURS = 40;
const BASE = 50;

export function scoreCaregiver(f: MatchFacts): MatchScore {
  let score = BASE;
  const reasons: MatchScore['reasons'] = [];
  const good = (points: number, text: string) => {
    score += points;
    reasons.push({ text, good: true });
  };
  const caution = (points: number, text: string) => {
    score -= points;
    reasons.push({ text, good: false });
  };

  if (f.preferredByPatient) good(25, 'The patient’s preferred caregiver');
  if (f.visitsWithPatient > 0) good(Math.min(30, f.visitsWithPatient * 3), `Has visited this patient ${f.visitsWithPatient} time${f.visitsWithPatient === 1 ? '' : 's'}`);

  if (f.languagePreference) {
    const speaks = f.languages.some((l) => l.trim().toLowerCase() === f.languagePreference!.trim().toLowerCase());
    if (speaks) good(10, `Speaks ${f.languagePreference}`);
    else caution(5, `Doesn’t list ${f.languagePreference}`);
  }
  if (f.genderPreference && f.gender) {
    if (f.genderPreference === f.gender) good(10, 'Matches the patient’s caregiver gender preference');
    else caution(15, 'Doesn’t match the patient’s caregiver gender preference');
  }

  if (f.miles !== null) {
    const m = Math.round(f.miles * 10) / 10;
    if (f.miles <= 5) good(15, `${m} miles away`);
    else if (f.miles <= 10) good(8, `${m} miles away`);
    else if (f.miles <= 20) reasons.push({ text: `${m} miles away`, good: true });
    else caution(10, `${m} miles away`);
  } else if (f.sameZip) good(10, 'Lives in the patient’s ZIP code');
  else if (f.inServiceArea) good(6, 'Covers the patient’s area');

  const after = f.weekHours + f.visitHours;
  if (after > OVERTIME_HOURS) caution(20, `Would go to ${Math.round(after * 10) / 10} h this week (overtime)`);
  else if (after > OVERTIME_HOURS - 4) caution(5, `Close to overtime (${Math.round(after * 10) / 10} h this week)`);

  if (f.recentVisits >= 5) {
    const attendance = 1 - f.missed / (f.recentVisits + f.missed);
    const onTime = 1 - f.late / f.recentVisits;
    if (attendance >= 0.98 && onTime >= 0.95) good(8, `Reliable: ${Math.round(attendance * 100)}% attendance, ${Math.round(onTime * 100)}% on time`);
    else {
      if (attendance < 0.95) caution(Math.round((1 - attendance) * 100), `${Math.round(attendance * 100)}% attendance (90 days)`);
      if (onTime < 0.9) caution(Math.round((1 - onTime) * 50), `${Math.round(onTime * 100)}% on time (90 days)`);
    }
  }

  for (const w of f.warnings) caution(10, w);

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: [...reasons.filter((r) => r.good), ...reasons.filter((r) => !r.good)],
  };
}

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
