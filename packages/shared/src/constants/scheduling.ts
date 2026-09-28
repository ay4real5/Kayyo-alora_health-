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

/** Offset (minutes, east of UTC positive) of an IANA timezone at an instant. */
function offsetMinutes(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(instant));
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0; // "GMT" exactly
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/**
 * The UTC instant of an agency-local wall-clock time, e.g. ('2026-10-05', '09:00', 'America/Chicago').
 * Handles daylight-saving changes (the offset is re-checked at the result).
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, h!, mi!);
  let instant = wall - offsetMinutes(timeZone, wall) * 60_000;
  instant = wall - offsetMinutes(timeZone, instant) * 60_000;
  return new Date(instant);
}

/** Visit note kinds (DECISIONS D-039). `addendum` amends a locked note. */
export const VISIT_NOTE_TYPES = ['progress', 'skilled_nursing', 'therapy', 'aide_activity', 'addendum'] as const;
export type VisitNoteType = (typeof VISIT_NOTE_TYPES)[number];

/** draft → signed (clinicians with visit_notes:sign) or submitted (aides, who don't sign). Both are locked. */
export const VISIT_NOTE_STATUSES = ['draft', 'submitted', 'signed'] as const;
export type VisitNoteStatus = (typeof VISIT_NOTE_STATUSES)[number];
