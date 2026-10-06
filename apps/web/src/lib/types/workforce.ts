/** Workforce intelligence (D-097): EVV patterns, Care Score, recognition. */

export interface EvvAnomaly {
  type: 'overlap' | 'impossible_travel' | 'repeated_corrections' | 'repeated_geofence_misses';
  severity: 'critical' | 'warning';
  staffId: string;
  staffName: string;
  recordIds: string[];
  detail: string;
  link: string;
}

export interface SubScore {
  key: 'attendance' | 'punctuality' | 'documentation' | 'evv';
  label: string;
  score: number | null;
  weight: number;
  explanation: string;
}

export interface CareScore {
  score: number | null;
  parts: SubScore[];
  incidents: number;
  note: string | null;
}

export interface CareScoreRow extends CareScore {
  staffId: string;
  name: string;
  discipline: string;
  visits: number;
  link: string;
}

export const ANOMALY_LABELS: Record<EvvAnomaly['type'], string> = {
  overlap: 'Overlapping visits',
  impossible_travel: 'Travel faster than driving',
  repeated_corrections: 'Repeated time corrections',
  repeated_geofence_misses: 'Repeated location misses',
};

/** Neutral colours: the score is decision support, not a grade. */
export function scoreTone(score: number | null): string {
  if (score === null) return 'bg-slate-100 text-slate-700';
  if (score >= 90) return 'bg-emerald-100 text-emerald-900';
  if (score >= 75) return 'bg-sky-100 text-sky-900';
  return 'bg-amber-100 text-amber-900';
}
