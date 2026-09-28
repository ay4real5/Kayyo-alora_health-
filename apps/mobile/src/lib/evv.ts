import { EVV_FLAG_LABELS, type EvvFlag } from '@alora/shared';

/** A GPS fix as expo-location reports it (only what EVV needs). */
export interface Fix {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  /** Milliseconds since epoch, when the device took the reading. */
  timestamp: number;
}

export interface ClockBody {
  visitId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  timestamp: string;
  appVersion?: string;
}

/** What the API returns after clock-in/out (DECISIONS D-038). */
export interface ClockResult {
  id: string;
  visitId: string;
  status: string;
  flags: string[];
  distanceMeters: number | null;
  withinGeofence: boolean | null;
}

/** Readings older than this are refreshed before clocking in — a stale fix would put the caregiver somewhere else. */
export const MAX_FIX_AGE_MS = 2 * 60_000;

/**
 * The clock-in/out request from a GPS fix. The timestamp is when the caregiver pressed the button (`now`), not when
 * the fix was taken — the visit time is what EVV records; the fix only says where.
 */
export function clockBody(visitId: string, fix: Fix, now: Date, appVersion?: string): ClockBody {
  const accuracy = fix.coords.accuracy;
  return {
    visitId,
    latitude: Number(fix.coords.latitude.toFixed(7)),
    longitude: Number(fix.coords.longitude.toFixed(7)),
    ...(accuracy !== null && Number.isFinite(accuracy) ? { accuracyMeters: Math.min(100_000, Math.round(accuracy)) } : {}),
    timestamp: now.toISOString(),
    ...(appVersion ? { appVersion: appVersion.slice(0, 20) } : {}),
  };
}

export function isFresh(fix: Fix, now: number): boolean {
  return now - fix.timestamp <= MAX_FIX_AGE_MS;
}

/**
 * What to tell the caregiver after clocking in or out. Flags never block (D-038) — say so, so nobody panics.
 */
export function clockMessage(kind: 'in' | 'out', result: ClockResult): { title: string; detail: string | null } {
  const title = kind === 'in' ? 'Clocked in' : 'Clocked out';
  if (!result.flags.length) {
    return {
      title,
      detail:
        result.distanceMeters !== null && result.withinGeofence ? `You're ${result.distanceMeters} m from the home.` : null,
    };
  }
  const reasons = result.flags.map((f) => EVV_FLAG_LABELS[f as EvvFlag] ?? f);
  return {
    title,
    detail: `Recorded. The office will review: ${reasons.join('; ')}.`,
  };
}

/** "http://maps…" link for directions to an address (opens the phone's maps app). */
export function directionsUrl(address: string, platform: 'ios' | 'android' | string): string {
  const q = encodeURIComponent(address);
  return platform === 'ios' ? `http://maps.apple.com/?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
