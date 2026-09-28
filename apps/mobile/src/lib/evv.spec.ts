import { describe, expect, it } from 'vitest';
import { clockBody, clockMessage, directionsUrl, isFresh, MAX_FIX_AGE_MS, type Fix } from './evv';

const fix = (overrides: Partial<Fix['coords']> = {}, timestamp = 1_000_000): Fix => ({
  coords: { latitude: 39.781712345678, longitude: -89.650112345678, accuracy: 7.6, ...overrides },
  timestamp,
});

describe('clockBody', () => {
  it('uses the button-press time, rounds coordinates and accuracy', () => {
    const now = new Date('2026-09-28T14:05:00.000Z');
    expect(clockBody('v1', fix(), now, '0.0.1')).toEqual({
      visitId: 'v1',
      latitude: 39.7817123,
      longitude: -89.6501123,
      accuracyMeters: 8,
      timestamp: '2026-09-28T14:05:00.000Z',
      appVersion: '0.0.1',
    });
  });

  it('leaves out an unknown accuracy', () => {
    expect(clockBody('v1', fix({ accuracy: null }), new Date(0))).not.toHaveProperty('accuracyMeters');
  });
});

describe('isFresh', () => {
  it('accepts readings up to two minutes old', () => {
    expect(isFresh(fix({}, 0), MAX_FIX_AGE_MS)).toBe(true);
    expect(isFresh(fix({}, 0), MAX_FIX_AGE_MS + 1)).toBe(false);
  });
});

describe('clockMessage', () => {
  it('reassures when nothing is flagged', () => {
    expect(
      clockMessage('in', { id: 'e', visitId: 'v', status: 'in_progress', flags: [], distanceMeters: 12, withinGeofence: true }),
    ).toEqual({ title: 'Clocked in', detail: "You're 12 m from the home." });
  });

  it('explains flags in plain words, without blocking', () => {
    const m = clockMessage('out', {
      id: 'e',
      visitId: 'v',
      status: 'exception',
      flags: ['outside_geofence_out', 'very_short_visit'],
      distanceMeters: 1200,
      withinGeofence: false,
    });
    expect(m.title).toBe('Clocked out');
    expect(m.detail).toBe('Recorded. The office will review: Clocked out away from the home; Visit much shorter than scheduled.');
  });
});

describe('directionsUrl', () => {
  it('opens the platform maps app', () => {
    expect(directionsUrl('1 Main St, Springfield', 'ios')).toBe('http://maps.apple.com/?daddr=1%20Main%20St%2C%20Springfield');
    expect(directionsUrl('1 Main St', 'android')).toBe('https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St');
  });
});
