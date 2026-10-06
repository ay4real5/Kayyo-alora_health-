import { distanceMeters } from '@alora/shared';

// ── EVV anomalies (D-097) ─────────────────────────────────────────────────────────────────────────────────────────

/** One clock-in/out record, as the anomaly checks need it. */
export interface EvvPoint {
  id: string;
  staffId: string;
  clockIn: Date | null;
  clockOut: Date | null;
  inAt: { lat: number; lng: number } | null;
  outAt: { lat: number; lng: number } | null;
  flags: string[];
  /** Correction requests on this record (any status). */
  corrections: number;
}

export type AnomalyType = 'overlap' | 'impossible_travel' | 'repeated_corrections' | 'repeated_geofence_misses';

export interface Anomaly {
  type: AnomalyType;
  severity: 'critical' | 'warning';
  staffId: string;
  recordIds: string[];
  detail: string;
}

/** Two visits overlapping by less than this is ordinary handover slack, not an anomaly. */
export const OVERLAP_GRACE_MS = 5 * 60_000;
/** Faster than this between one visit's clock-out and the next clock-in is not believable by car (~80 mph). */
export const MAX_TRAVEL_MPS = 35.8;
/** Short hops are ignored: GPS noise and neighbouring addresses. */
export const MIN_TRAVEL_METERS = 2_000;
/** This many in the window is a pattern worth a look. */
export const REPEAT_THRESHOLD = 3;

const GEOFENCE_FLAGS = new Set(['outside_geofence_in', 'outside_geofence_out']);
const minutes = (ms: number) => Math.round(ms / 60_000);
const miles = (m: number) => Math.round((m / 1609.344) * 10) / 10;

/**
 * Patterns in EVV that a supervisor should look at (D-097). Pure: the caller loads the records for a window. Nothing
 * here accuses anyone: overlaps can be a forgotten clock-out, and odd travel can be a bad GPS fix. The wording says
 * what was seen, not what it means.
 */
export function evvAnomalies(records: EvvPoint[]): Anomaly[] {
  const out: Anomaly[] = [];
  const byStaff = new Map<string, EvvPoint[]>();
  for (const r of records) byStaff.set(r.staffId, [...(byStaff.get(r.staffId) ?? []), r]);

  for (const [staffId, list] of byStaff) {
    const timed = list.filter((r) => r.clockIn).sort((a, b) => a.clockIn!.getTime() - b.clockIn!.getTime());
    for (let i = 0; i < timed.length - 1; i++) {
      const a = timed[i]!;
      const b = timed[i + 1]!;
      if (!a.clockOut) continue;
      const gap = b.clockIn!.getTime() - a.clockOut.getTime();
      if (gap < -OVERLAP_GRACE_MS) {
        out.push({
          type: 'overlap',
          severity: 'critical',
          staffId,
          recordIds: [a.id, b.id],
          detail: `Clocked in to a visit while still clocked in to another (${minutes(-gap)} min overlap).`,
        });
        continue;
      }
      if (!a.outAt || !b.inAt) continue;
      const meters = distanceMeters(a.outAt, b.inAt);
      if (meters < MIN_TRAVEL_METERS) continue;
      const seconds = Math.max(gap, 0) / 1000;
      if (seconds === 0 || meters / seconds > MAX_TRAVEL_MPS) {
        out.push({
          type: 'impossible_travel',
          severity: 'warning',
          staffId,
          recordIds: [a.id, b.id],
          detail: `${miles(meters)} miles between visits in ${minutes(Math.max(gap, 0))} min — faster than driving allows. Check the GPS points.`,
        });
      }
    }

    const corrected = list.filter((r) => r.corrections > 0);
    const corrections = corrected.reduce((n, r) => n + r.corrections, 0);
    if (corrections >= REPEAT_THRESHOLD) {
      out.push({
        type: 'repeated_corrections',
        severity: 'warning',
        staffId,
        recordIds: corrected.map((r) => r.id),
        detail: `${corrections} time corrections requested in this period.`,
      });
    }
    const missed = list.filter((r) => r.flags.some((f) => GEOFENCE_FLAGS.has(f)));
    if (missed.length >= REPEAT_THRESHOLD) {
      out.push({
        type: 'repeated_geofence_misses',
        severity: 'warning',
        staffId,
        recordIds: missed.map((r) => r.id),
        detail: `${missed.length} clock-ins or outs away from the client's address in this period.`,
      });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}

// ── Care Score (D-097) ─────────────────────────────────────────────────────────────────────────────────────────────

/** What happened over the period, counted from visits, notes and EVV. */
export interface CareStats {
  /** Visits that should have happened (completed + missed). Cancelled visits don't count. */
  visits: number;
  missed: number;
  /** Completed visits with a known start. */
  started: number;
  /** Of those, started more than LATE_MINUTES after the scheduled time. */
  late: number;
  /** Completed visits whose note was submitted. */
  notes: number;
  /** Of those, submitted within NOTE_HOURS of the visit ending. */
  notesOnTime: number;
  /** EVV records in the period. */
  evv: number;
  /** Of those, with no flags and no corrections. */
  evvClean: number;
  /** Incident reports on their visits — shown for context only, never scored (incidents are often nobody's fault). */
  incidents: number;
}

export const LATE_MINUTES = 10;
export const NOTE_HOURS = 24;
/** Below this many visits a score would be noise, so none is given. */
export const MIN_VISITS = 5;

export interface SubScore {
  key: 'attendance' | 'punctuality' | 'documentation' | 'evv';
  label: string;
  /** 0–100, or null when there is nothing to measure. */
  score: number | null;
  weight: number;
  explanation: string;
}

export interface CareScore {
  /** 0–100 weighted over the measurable parts, or null with too little data. */
  score: number | null;
  parts: SubScore[];
  incidents: number;
  note: string | null;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * An explainable score for decision support (D-097): each part says how it was counted. It is shown to admins and
 * supervisors only and never changes anything by itself — no automatic scheduling, pay or discipline uses it.
 */
export function careScore(s: CareStats): CareScore {
  const parts: SubScore[] = [
    {
      key: 'attendance',
      label: 'Attendance',
      score: pct(s.visits - s.missed, s.visits),
      weight: 35,
      explanation: `${s.visits - s.missed} of ${s.visits} visits completed (${s.missed} missed).`,
    },
    {
      key: 'punctuality',
      label: 'Punctuality',
      score: pct(s.started - s.late, s.started),
      weight: 25,
      explanation: `${s.started - s.late} of ${s.started} visits started within ${LATE_MINUTES} minutes of the scheduled time.`,
    },
    {
      key: 'documentation',
      label: 'Documentation',
      score: pct(s.notesOnTime, s.started),
      weight: 20,
      explanation: `${s.notesOnTime} of ${s.started} visit notes submitted within ${NOTE_HOURS} hours (${s.started - s.notes} not submitted yet).`,
    },
    {
      key: 'evv',
      label: 'EVV accuracy',
      score: pct(s.evvClean, s.evv),
      weight: 20,
      explanation: `${s.evvClean} of ${s.evv} clock-ins/outs with no location flags or time corrections.`,
    },
  ];
  if (s.visits < MIN_VISITS) {
    return { score: null, parts, incidents: s.incidents, note: `Not enough visits yet (${s.visits}; a score needs ${MIN_VISITS}).` };
  }
  const measured = parts.filter((p) => p.score !== null);
  const weight = measured.reduce((n, p) => n + p.weight, 0);
  const score = weight ? Math.round(measured.reduce((n, p) => n + p.score! * p.weight, 0) / weight) : null;
  return { score, parts, incidents: s.incidents, note: null };
}

// ── Recognition badges (D-097) ────────────────────────────────────────────────────────────────────────────────────

export interface Badge {
  key: string;
  title: string;
  description: string;
}

/** Badges need a few visits behind them so one lucky week doesn't count. */
export const BADGE_MIN_VISITS = 10;

/** Positive-only recognition from the same counts; nothing is shown for falling short. */
export function badges(s: CareStats): Badge[] {
  if (s.visits < BADGE_MIN_VISITS) return [];
  const out: Badge[] = [];
  if (s.missed === 0) out.push({ key: 'perfect_attendance', title: 'Perfect attendance', description: `Every one of your ${s.visits} visits completed.` });
  if (s.started && (s.started - s.late) / s.started >= 0.95) out.push({ key: 'always_on_time', title: 'Always on time', description: 'Started 95% or more of your visits on time.' });
  if (s.started && s.notesOnTime / s.started >= 0.95) out.push({ key: 'note_pro', title: 'Note pro', description: 'Submitted 95% or more of your notes within a day.' });
  if (s.evv && s.evvClean / s.evv >= 0.95) out.push({ key: 'gps_star', title: 'EVV star', description: '95% or more of your clock-ins were clean — right place, right time.' });
  return out;
}
