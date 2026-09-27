import type { Discipline } from './staff.js';

/** Visit lifecycle (DECISIONS D-030). in_progress/completed are set by EVV clock-in/out (P2-01). */
export const VISIT_STATUSES = ['scheduled', 'in_progress', 'completed', 'missed', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Statuses that occupy the caregiver's time (used for double-booking checks). */
export const OCCUPYING_VISIT_STATUSES = ['scheduled', 'in_progress', 'completed'] as const satisfies readonly VisitStatus[];

export const VISIT_PRIORITIES = ['normal', 'high', 'urgent'] as const;
export type VisitPriority = (typeof VISIT_PRIORITIES)[number];

/** Which disciplines may normally perform each visit type. A mismatch is a warning, not a block. */
export const VISIT_TYPE_DISCIPLINES = {
  skilled_nursing: ['RN', 'LPN'],
  nursing_assessment: ['RN'],
  physical_therapy: ['PT', 'PTA'],
  pt_evaluation: ['PT'],
  occupational_therapy: ['OT', 'COTA'],
  ot_evaluation: ['OT'],
  speech_therapy: ['SLP'],
  medical_social_work: ['MSW'],
  home_health_aide: ['HHA', 'CNA'],
  personal_care: ['HHA', 'CNA', 'PCA'],
  respite: ['HHA', 'CNA', 'PCA', 'LPN', 'RN'],
} as const satisfies Record<string, readonly Discipline[]>;

export type VisitType = keyof typeof VISIT_TYPE_DISCIPLINES;
export const VISIT_TYPES = Object.keys(VISIT_TYPE_DISCIPLINES) as VisitType[];

export function disciplineFits(visitType: VisitType, discipline: string): boolean {
  return (VISIT_TYPE_DISCIPLINES[visitType] as readonly string[]).includes(discipline);
}

/** Today's date (YYYY-MM-DD) in an IANA timezone, e.g. the agency's 'America/New_York'. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
