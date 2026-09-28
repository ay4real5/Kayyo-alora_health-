import { describe, expect, it } from 'vitest';
import { EMPTY_VITALS, vitalsPayload } from './vitals';

describe('vitalsPayload', () => {
  it('builds the API body from what was filled in', () => {
    expect(
      vitalsPayload({ ...EMPTY_VITALS, systolic: '128', diastolic: '82', heartRate: '72', temperature: '98,6', notes: ' calm ' }),
    ).toEqual({
      body: {
        bloodPressureSystolic: 128,
        bloodPressureDiastolic: 82,
        heartRate: 72,
        temperature: 98.6,
        temperatureUnit: 'F',
        notes: 'calm',
      },
      errors: [],
    });
  });

  it('needs at least one measurement', () => {
    expect(vitalsPayload(EMPTY_VITALS).errors).toEqual(['Enter at least one measurement']);
  });

  it('catches half a blood pressure and an upside-down one', () => {
    expect(vitalsPayload({ ...EMPTY_VITALS, systolic: '120' }).errors).toContain('Blood pressure needs both numbers');
    expect(vitalsPayload({ ...EMPTY_VITALS, systolic: '80', diastolic: '90' }).errors).toContain(
      'The lower blood pressure number must be less than the upper one',
    );
  });

  it('checks ranges against the unit', () => {
    expect(vitalsPayload({ ...EMPTY_VITALS, temperature: '98.6', temperatureUnit: 'C' }).errors).toEqual([
      'Temperature (°C) must be between 29 and 46',
    ]);
    expect(vitalsPayload({ ...EMPTY_VITALS, heartRate: '7.5' }).errors).toEqual(['Heart rate: whole number only']);
    expect(vitalsPayload({ ...EMPTY_VITALS, painLevel: 'x' }).errors).toEqual(['Pain: enter a number']);
  });
});
