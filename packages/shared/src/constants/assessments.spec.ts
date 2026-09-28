import { describe, expect, it } from 'vitest';
import { scoreAssessment, scoreBraden, scoreMorse } from './assessments.js';

describe('scoreMorse', () => {
  const answers = {
    historyOfFalling: 'yes',
    secondaryDiagnosis: 'yes',
    ambulatoryAid: 'crutches_cane_walker',
    ivOrHeparinLock: 'no',
    gait: 'weak',
    mentalStatus: 'oriented',
  };

  it('adds the points and bands the risk', () => {
    expect(scoreMorse(answers)).toEqual({ ok: true, result: { score: 65, risk: 'high' } });
    expect(scoreMorse({ ...answers, historyOfFalling: 'no', secondaryDiagnosis: 'no' })).toEqual({
      ok: true,
      result: { score: 25, risk: 'moderate' },
    });
    expect(
      scoreMorse({ historyOfFalling: 'no', secondaryDiagnosis: 'no', ambulatoryAid: 'none', ivOrHeparinLock: 'no', gait: 'normal', mentalStatus: 'oriented' }),
    ).toEqual({ ok: true, result: { score: 0, risk: 'low' } });
  });

  it('names missing or invalid answers', () => {
    expect(scoreMorse({ ...answers, gait: 'fast', mentalStatus: undefined })).toEqual({ ok: false, missing: ['gait', 'mentalStatus'] });
  });
});

describe('scoreBraden', () => {
  it('sums the six items and bands the risk', () => {
    const best = { sensoryPerception: 4, moisture: 4, activity: 4, mobility: 4, nutrition: 4, frictionShear: 3 };
    expect(scoreBraden(best)).toEqual({ ok: true, result: { score: 23, risk: 'none' } });
    expect(scoreBraden({ ...best, activity: 1, mobility: 1, moisture: 2 })).toEqual({ ok: true, result: { score: 15, risk: 'mild' } });
    expect(scoreBraden({ sensoryPerception: 1, moisture: 1, activity: 1, mobility: 1, nutrition: 1, frictionShear: 1 })).toEqual({
      ok: true,
      result: { score: 6, risk: 'very_high' },
    });
  });

  it('rejects out-of-range values', () => {
    expect(scoreBraden({ sensoryPerception: 5, moisture: 4, activity: 4, mobility: 4, nutrition: 4, frictionShear: 4 })).toEqual({
      ok: false,
      missing: ['sensoryPerception', 'frictionShear'],
    });
  });
});

describe('scoreAssessment', () => {
  it('only scores the scaled types', () => {
    expect(scoreAssessment('oasis_soc', {})).toBeNull();
    expect(scoreAssessment('braden', {})).toMatchObject({ ok: false });
  });
});
