/**
 * Vitals form → API payload, with the same plausibility ranges the API enforces (DECISIONS D-039), so caregivers see
 * mistakes (a missing digit, °C typed as °F) before sending.
 */

export interface VitalsForm {
  systolic: string;
  diastolic: string;
  heartRate: string;
  respiratoryRate: string;
  temperature: string;
  temperatureUnit: 'F' | 'C';
  oxygenSaturation: string;
  painLevel: string;
  bloodGlucose: string;
  weight: string;
  weightUnit: 'lbs' | 'kg';
  notes: string;
}

export const EMPTY_VITALS: VitalsForm = {
  systolic: '',
  diastolic: '',
  heartRate: '',
  respiratoryRate: '',
  temperature: '',
  temperatureUnit: 'F',
  oxygenSaturation: '',
  painLevel: '',
  bloodGlucose: '',
  weight: '',
  weightUnit: 'lbs',
  notes: '',
};

type Parsed = { value?: number; error?: string };

function number(raw: string, label: string, min: number, max: number, integer: boolean): Parsed {
  const text = raw.trim().replace(',', '.');
  if (!text) return {};
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: `${label}: enter a number` };
  if (integer && !Number.isInteger(value)) return { error: `${label}: whole number only` };
  if (value < min || value > max) return { error: `${label} must be between ${min} and ${max}` };
  return { value: integer ? value : Math.round(value * 100) / 100 };
}

export function vitalsPayload(form: VitalsForm): { body?: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const body: Record<string, unknown> = {};
  const take = (key: string, parsed: Parsed) => {
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.value !== undefined) body[key] = parsed.value;
  };

  take('bloodPressureSystolic', number(form.systolic, 'Systolic', 40, 300, true));
  take('bloodPressureDiastolic', number(form.diastolic, 'Diastolic', 20, 200, true));
  take('heartRate', number(form.heartRate, 'Heart rate', 20, 250, true));
  take('respiratoryRate', number(form.respiratoryRate, 'Breathing rate', 4, 80, true));
  const [tMin, tMax] = form.temperatureUnit === 'F' ? [85, 115] : [29, 46];
  take('temperature', number(form.temperature, `Temperature (°${form.temperatureUnit})`, tMin, tMax, false));
  take('oxygenSaturation', number(form.oxygenSaturation, 'Oxygen', 50, 100, false));
  take('painLevel', number(form.painLevel, 'Pain', 0, 10, true));
  take('bloodGlucose', number(form.bloodGlucose, 'Blood sugar', 10, 1000, true));
  take('weight', number(form.weight, 'Weight', 1, 1500, false));

  const hasSys = 'bloodPressureSystolic' in body;
  const hasDia = 'bloodPressureDiastolic' in body;
  if (hasSys !== hasDia) errors.push('Blood pressure needs both numbers');
  if (hasSys && hasDia && (body.bloodPressureDiastolic as number) >= (body.bloodPressureSystolic as number)) {
    errors.push('The lower blood pressure number must be less than the upper one');
  }
  if ('temperature' in body) body.temperatureUnit = form.temperatureUnit;
  if ('weight' in body) body.weightUnit = form.weightUnit;
  if (!Object.keys(body).length && !errors.length) errors.push('Enter at least one measurement');
  const notes = form.notes.trim();
  if (notes) body.notes = notes.slice(0, 2000);

  return errors.length ? { errors } : { body, errors };
}
