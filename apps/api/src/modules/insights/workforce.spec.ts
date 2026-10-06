import { badges, careScore, evvAnomalies, type CareStats, type EvvPoint } from './workforce.js';

const at = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00Z`);
// Two points about 0.5 km apart, and one about 48 km away.
const HOME = { lat: 40.0, lng: -75.0 };
const NEAR = { lat: 40.004, lng: -75.0 };
const FAR = { lat: 40.43, lng: -75.0 };

function rec(id: string, inT: string, outT: string | null, extra: Partial<EvvPoint> = {}): EvvPoint {
  return { id, staffId: 's1', clockIn: at(inT), clockOut: outT ? at(outT) : null, inAt: HOME, outAt: HOME, flags: [], corrections: 0, ...extra };
}

describe('evvAnomalies', () => {
  it('finds overlapping visits but allows a few minutes of handover', () => {
    const found = evvAnomalies([rec('a', '08:00', '10:00'), rec('b', '09:30', '11:00'), rec('c', '10:57', '12:00', { staffId: 's2' }), rec('d', '09:00', '11:00', { staffId: 's2' })]);
    expect(found.map((f) => [f.type, f.recordIds])).toEqual([
      ['overlap', ['a', 'b']],
    ]);
    expect(found[0]!.detail).toContain('30 min overlap');
  });

  it('finds travel faster than driving, but not short hops', () => {
    const fast = evvAnomalies([rec('a', '08:00', '09:00'), rec('b', '09:10', '10:00', { inAt: FAR })]);
    expect(fast).toEqual([expect.objectContaining({ type: 'impossible_travel', recordIds: ['a', 'b'] })]);
    expect(fast[0]!.detail).toMatch(/29\.\d miles between visits in 10 min/);
    expect(evvAnomalies([rec('a', '08:00', '09:00'), rec('b', '09:01', '10:00', { inAt: NEAR })])).toEqual([]);
    expect(evvAnomalies([rec('a', '08:00', '09:00'), rec('b', '10:00', '11:00', { inAt: FAR })])).toEqual([]); // an hour is enough
  });

  it('finds repeated corrections and geofence misses (3 or more)', () => {
    const list = [
      rec('a', '08:00', '09:00', { corrections: 2, flags: ['outside_geofence_in'] }),
      rec('b', '10:00', '11:00', { corrections: 1, flags: ['outside_geofence_out'] }),
      rec('c', '12:00', '13:00', { flags: ['outside_geofence_in', 'outside_geofence_out'] }),
    ];
    expect(evvAnomalies(list).map((f) => f.type)).toEqual(['repeated_corrections', 'repeated_geofence_misses']);
    expect(evvAnomalies(list.slice(0, 2)).map((f) => f.type)).toEqual(['repeated_corrections']);
  });
});

const stats = (s: Partial<CareStats> = {}): CareStats => ({ visits: 20, missed: 0, started: 20, late: 0, notes: 20, notesOnTime: 20, evv: 20, evvClean: 20, incidents: 0, ...s });

describe('careScore', () => {
  it('weights the parts and explains each one', () => {
    const s = careScore(stats({ missed: 2, started: 18, late: 9, notes: 18, notesOnTime: 18, evvClean: 10 }));
    // attendance 90×35, punctuality 50×25, documentation 100×20, evv 50×20 → 7400/100
    expect(s.score).toBe(74);
    expect(s.parts.map((p) => p.score)).toEqual([90, 50, 100, 50]);
    expect(s.parts[1]!.explanation).toBe('9 of 18 visits started within 10 minutes of the scheduled time.');
  });

  it('gives no score with too few visits, and skips parts with nothing to measure', () => {
    expect(careScore(stats({ visits: 3 }))).toMatchObject({ score: null, note: expect.stringContaining('Not enough visits') });
    const noEvv = careScore(stats({ evv: 0, evvClean: 0, late: 4 }));
    expect(noEvv.parts[3]!.score).toBeNull();
    expect(noEvv.score).toBe(Math.round((100 * 35 + 80 * 25 + 100 * 20) / 80));
  });

  it('never scores incidents', () => {
    expect(careScore(stats({ incidents: 5 })).score).toBe(100);
  });
});

describe('badges', () => {
  it('awards positive badges only after enough visits', () => {
    expect(badges(stats()).map((b) => b.key)).toEqual(['perfect_attendance', 'always_on_time', 'note_pro', 'gps_star']);
    expect(badges(stats({ visits: 9 }))).toEqual([]);
    expect(badges(stats({ missed: 1, late: 5 })).map((b) => b.key)).toEqual(['note_pro', 'gps_star']);
  });
});
