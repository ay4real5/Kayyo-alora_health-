/** Assessment types (DECISIONS D-055). OASIS answers are stored as the form's JSON; the two scales below are scored. */
export const ASSESSMENT_TYPES = [
  'oasis_soc',
  'oasis_roc',
  'oasis_recert',
  'oasis_transfer',
  'oasis_discharge',
  'nursing',
  'morse_fall',
  'braden',
  'pain',
  'other',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/** Morse Fall Scale item values (each answer maps to the points shown). */
export const MORSE_ITEMS = {
  historyOfFalling: { no: 0, yes: 25 },
  secondaryDiagnosis: { no: 0, yes: 15 },
  ambulatoryAid: { none: 0, crutches_cane_walker: 15, furniture: 30 },
  ivOrHeparinLock: { no: 0, yes: 20 },
  gait: { normal: 0, weak: 10, impaired: 20 },
  mentalStatus: { oriented: 0, forgets_limitations: 15 },
} as const;

/** Braden Scale items: each scored 1 (worst) to 4 (best); friction/shear 1–3. */
export const BRADEN_ITEMS = {
  sensoryPerception: 4,
  moisture: 4,
  activity: 4,
  mobility: 4,
  nutrition: 4,
  frictionShear: 3,
} as const;

export interface ScaleResult {
  score: number;
  risk: string;
}

export type ScoreOutcome = { ok: true; result: ScaleResult } | { ok: false; missing: string[] };

/** Morse Fall Scale (0–125): under 25 low, 25–44 moderate, 45 and over high. */
export function scoreMorse(data: Record<string, unknown>): ScoreOutcome {
  const missing: string[] = [];
  let score = 0;
  for (const [item, options] of Object.entries(MORSE_ITEMS)) {
    const answer = data[item];
    const points = typeof answer === 'string' ? (options as Record<string, number>)[answer] : undefined;
    if (points === undefined) missing.push(item);
    else score += points;
  }
  if (missing.length) return { ok: false, missing };
  return { ok: true, result: { score, risk: score >= 45 ? 'high' : score >= 25 ? 'moderate' : 'low' } };
}

/** Braden Scale (6–23): 9 or less very high, 10–12 high, 13–14 moderate, 15–18 mild, 19+ no risk. */
export function scoreBraden(data: Record<string, unknown>): ScoreOutcome {
  const missing: string[] = [];
  let score = 0;
  for (const [item, max] of Object.entries(BRADEN_ITEMS)) {
    const value = data[item];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) missing.push(item);
    else score += value;
  }
  if (missing.length) return { ok: false, missing };
  const risk = score <= 9 ? 'very_high' : score <= 12 ? 'high' : score <= 14 ? 'moderate' : score <= 18 ? 'mild' : 'none';
  return { ok: true, result: { score, risk } };
}

/** Scores the types that have a scale; null for the others. */
export function scoreAssessment(type: string, data: Record<string, unknown>): ScoreOutcome | null {
  if (type === 'morse_fall') return scoreMorse(data);
  if (type === 'braden') return scoreBraden(data);
  return null;
}
