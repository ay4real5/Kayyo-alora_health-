/** EVV record lifecycle (DECISIONS D-038). */
export const EVV_STATUSES = [
  'in_progress',
  'completed',
  'exception',
  'verified',
  'rejected',
] as const;
export type EvvStatus = (typeof EVV_STATUSES)[number];

/**
 * Reasons an EVV record needs a supervisor's review. A record with any flag is saved as `exception` at clock-out
 * instead of `completed`; nothing is ever blocked by a flag alone — care was delivered, the office sorts it out.
 */
export const EVV_FLAGS = [
  'no_patient_location',
  'outside_geofence_in',
  'outside_geofence_out',
  'outside_time_window_in',
  'outside_time_window_out',
  'very_short_visit',
  'manual_correction',
] as const;
export type EvvFlag = (typeof EVV_FLAGS)[number];

export const EVV_FLAG_LABELS: Record<EvvFlag, string> = {
  no_patient_location: 'Patient home has no map location',
  outside_geofence_in: 'Clocked in away from the home',
  outside_geofence_out: 'Clocked out away from the home',
  outside_time_window_in: 'Clocked in outside the scheduled time',
  outside_time_window_out: 'Clocked out long after the scheduled end',
  very_short_visit: 'Visit much shorter than scheduled',
  manual_correction: 'Times corrected by the office',
};

export const EVV_EXCEPTION_TYPES = ['clock_in_time', 'clock_out_time'] as const;
export type EvvExceptionType = (typeof EVV_EXCEPTION_TYPES)[number];

export const EVV_RULES = {
  /** Clock-in earlier than this before the scheduled start is flagged. */
  earlyClockInMinutes: 120,
  /** Clock-out later than this after the scheduled end is flagged. */
  lateClockOutMinutes: 120,
  /** Clock events this far from the scheduled window are refused outright (wrong visit). */
  refuseOutsideWindowHours: 12,
  /** Offline clock events may be synced up to this long after they happened. */
  maxBackdateHours: 72,
  /** Device clocks drift; allow this much "future". */
  maxClockSkewMinutes: 5,
  /** A visit shorter than this fraction of its scheduled length is flagged. */
  shortVisitFraction: 0.25,
} as const;
