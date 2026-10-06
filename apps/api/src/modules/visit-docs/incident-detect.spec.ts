import { describe, expect, it } from 'vitest';
import { keywordIncidents } from './incident-detect.js';

const types = (text: string) => keywordIncidents(text).map((h) => h.type);

describe('keywordIncidents', () => {
  it('finds falls, injuries, medication errors and emergencies', () => {
    expect(types('Client fell getting out of bed but said she was okay.')).toEqual(['fall']);
    expect(types('Found her on the floor in the bathroom. Small bruise on left arm.')).toEqual(['fall', 'injury']);
    expect(types('She missed her morning dose because the pharmacy was late.')).toEqual(['medication_error']);
    expect(types('Daughter called 911 for chest pain.')).toEqual(['medical_emergency']);
    expect(types('He refused his medication twice today.')).toEqual(['refusal']);
  });

  it('ignores negated mentions — the most common phrasing in routine notes', () => {
    expect(types('No falls today. Denies any pain or bruising.')).toEqual([]);
    expect(types('Patient did not fall during transfer; ambulated safely.')).toEqual([]);
    expect(types('Assisted with bathing, dressing and breakfast. Ate 75%. Mood good.')).toEqual([]);
  });

  it('still flags a later sentence after a negated one', () => {
    expect(types('No falls this week. Today she slipped in the kitchen.')).toEqual(['fall']);
  });

  it('reports each type once, with the phrase', () => {
    expect(keywordIncidents('She fell. Then fell again.')).toEqual([{ type: 'fall', phrase: 'fell' }]);
  });
});
