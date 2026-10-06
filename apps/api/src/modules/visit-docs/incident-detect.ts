/**
 * Incident detection, keyword part (D-096): does a visit note describe something that may need an incident report?
 * Pure and unit-tested. It always runs (with or without AI); when AI is on, Claude makes the final call and writes the
 * reason. Errs towards flagging: a person reviews every flag, and a missed fall is worse than a dismissed one.
 */

export type IncidentFlagType = 'fall' | 'injury' | 'medication_error' | 'abuse_neglect' | 'medical_emergency' | 'refusal';

export interface KeywordHit {
  type: IncidentFlagType;
  /** The words that triggered it, for the reason. */
  phrase: string;
}

const RULES: { type: IncidentFlagType; pattern: RegExp }[] = [
  { type: 'fall', pattern: /\b(fell|falls?|fallen|falling|slipped|tripped|found (her|him|them|the (patient|client))? ?on the floor|on the floor|lost (her|his|their) balance)\b/i },
  { type: 'injury', pattern: /\b(bruis\w*|bleed\w*|bled|skin tear|laceration|cut (on|her|his|their)|wound|injur\w*|burn(ed|s)?|swelling|swollen)\b/i },
  {
    type: 'medication_error',
    pattern: /\b(wrong (med\w*|dose|pills?)|missed (\w+ ){0,2}(dose|med\w*)|double dose|took (too many|extra)|med\w* (not given|error))\b/i,
  },
  { type: 'abuse_neglect', pattern: /\b(abus\w*|neglect\w*|exploit\w*|hit (me|her|him|them)|threaten\w*|yell(ed|ing) at (her|him|them))\b/i },
  { type: 'medical_emergency', pattern: /\b(911|ambulance|chest pain|unresponsive|seizure|stroke|emergency room|\bER\b|hospitali[sz]ed|taken to (the )?hospital|not breathing)\b/i },
  { type: 'refusal', pattern: /\b(refus(ed|es|ing)|declined) (to take )?(her |his |their )?(med\w*|care|bath\w*|meals?|food|treatment)\b/i },
];

/** "no", "not", "denies" … within the few words before the match cancel it ("denies any falls", "did not fall"). */
const NEGATION = /\b(no|not|never|denie[sd]|deny|denying|without|didn'?t|did not|has not|hasn'?t|nor)\b[^.!?;]{0,25}$/i;

export function keywordIncidents(text: string): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const sentence of text.split(/(?<=[.!?;\n])/)) {
    for (const rule of RULES) {
      const m = rule.pattern.exec(sentence);
      if (!m) continue;
      const before = sentence.slice(0, m.index);
      if (NEGATION.test(before)) continue;
      if (!hits.some((h) => h.type === rule.type)) hits.push({ type: rule.type, phrase: m[0] });
    }
  }
  return hits;
}

/** Incident report type for a flag (the report form's list). */
export const REPORT_TYPE: Record<IncidentFlagType, string> = {
  fall: 'fall',
  injury: 'injury',
  medication_error: 'medication_error',
  abuse_neglect: 'abuse_neglect',
  medical_emergency: 'other',
  refusal: 'other',
};

export const FLAG_LABEL: Record<IncidentFlagType, string> = {
  fall: 'Possible fall',
  injury: 'Possible injury',
  medication_error: 'Possible medication error',
  abuse_neglect: 'Possible abuse or neglect',
  medical_emergency: 'Possible medical emergency',
  refusal: 'Refused care or medication',
};
