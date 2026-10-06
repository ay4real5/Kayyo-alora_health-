import { describe, expect, it } from 'vitest';
import { milesBetween, scoreCaregiver, type MatchFacts } from './caregiver-match.js';

const plain: MatchFacts = {
  visitsWithPatient: 0,
  preferredByPatient: false,
  genderPreference: null,
  gender: null,
  languagePreference: null,
  languages: [],
  miles: null,
  sameZip: false,
  inServiceArea: false,
  weekHours: 10,
  visitHours: 4,
  recentVisits: 0,
  missed: 0,
  late: 0,
  warnings: [],
};

describe('scoreCaregiver', () => {
  it('starts in the middle with nothing known', () => {
    expect(scoreCaregiver(plain)).toEqual({ score: 50, reasons: [] });
  });

  it('rewards continuity, preference, language, distance and reliability — with reasons', () => {
    const r = scoreCaregiver({
      ...plain,
      visitsWithPatient: 14,
      preferredByPatient: true,
      languagePreference: 'Spanish',
      languages: ['English', 'spanish'],
      miles: 4.2,
      recentVisits: 60,
      missed: 0,
      late: 1,
    });
    expect(r.score).toBe(100);
    expect(r.reasons.map((x) => x.text)).toEqual([
      'The patient’s preferred caregiver',
      'Has visited this patient 14 times',
      'Speaks Spanish',
      '4.2 miles away',
      'Reliable: 100% attendance, 98% on time',
    ]);
  });

  it('flags overtime, gender mismatch, distance and poor attendance as cautions, after the good reasons', () => {
    const r = scoreCaregiver({
      ...plain,
      visitsWithPatient: 1,
      genderPreference: 'female',
      gender: 'male',
      miles: 31,
      weekHours: 38,
      visitHours: 4,
      recentVisits: 40,
      missed: 4,
      late: 0,
      warnings: ['Outside their usual availability'],
    });
    expect(r.reasons[0]).toEqual({ text: 'Has visited this patient 1 time', good: true });
    expect(r.reasons.filter((x) => !x.good).map((x) => x.text)).toEqual([
      'Doesn’t match the patient’s caregiver gender preference',
      '31 miles away',
      'Would go to 42 h this week (overtime)',
      '91% attendance (90 days)',
      'Outside their usual availability',
    ]);
    expect(r.score).toBe(0); // 50 + 3 − 15 − 10 − 20 − 9 − 10 → clamped
  });

  it('falls back to ZIP when there are no coordinates', () => {
    expect(scoreCaregiver({ ...plain, sameZip: true }).reasons[0]!.text).toBe('Lives in the patient’s ZIP code');
    expect(scoreCaregiver({ ...plain, inServiceArea: true }).reasons[0]!.text).toBe('Covers the patient’s area');
  });
});

describe('milesBetween', () => {
  it('measures straight-line miles', () => {
    // Richmond VA → Washington DC is about 97 miles.
    expect(Math.round(milesBetween({ lat: 37.5407, lng: -77.436 }, { lat: 38.9072, lng: -77.0369 }))).toBe(97);
  });
});
