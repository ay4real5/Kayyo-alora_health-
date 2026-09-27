/** Patient lifecycle (DECISIONS D-027). Status changes only through admit / discharge / readmit actions. */
export const PATIENT_STATUSES = ['active', 'discharged'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export const GENDERS = ['female', 'male', 'other', 'unknown'] as const;
export type Gender = (typeof GENDERS)[number];

export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe', 'unknown'] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

/**
 * ICD-10-CM code, normalised to upper case with the dot after the 3-character category ("e119" → "E11.9").
 * Checks the shape only (letter, digit, alphanumeric, then up to 4 more) — not that the code exists; a full
 * code-set lookup belongs with billing (P3). Returns undefined if the shape is wrong.
 */
export function normalizeIcd10(input: string): string | undefined {
  const compact = input.trim().toUpperCase().replace('.', '');
  if (!/^[A-Z][0-9][0-9A-Z][0-9A-Z]{0,4}$/.test(compact)) return undefined;
  return compact.length > 3 ? `${compact.slice(0, 3)}.${compact.slice(3)}` : compact;
}
