import { describe, expect, it } from 'vitest';
import { build837I, type Edi837IInput } from './edi-837i.js';
import { build837, type Edi837Input } from './edi-837p.js';
import { localDateTime, splitAtMidnight, virginiaEvvForLine, virginiaEvvRequired, type EvvLineFacts } from './evv-virginia.js';

/** FAKE data only. Times are Eastern (UTC-4 in September). */
const FACTS: EvvLineFacts = {
  format: '837P',
  serviceDate: '2026-09-24',
  timeZone: 'America/New_York',
  record: {
    clockIn: new Date('2026-09-24T12:00:00Z'), // 08:00 local
    clockOut: new Date('2026-09-24T16:30:00Z'), // 12:30 local
    status: 'completed',
    clockInWithinGeofence: true,
    clockOutWithinGeofence: true,
  },
  attendant: { lastName: 'Aide', firstName: 'Avery', employeeId: 'D0007' },
  serviceAddress: { addressLine1: '12 Oak St', city: 'Richmond', state: 'VA', zip: '23220' },
};

describe('virginiaEvvRequired', () => {
  it('covers personal care codes on the 837P and HH revenue codes on 837I bill types 32x/34x', () => {
    expect(virginiaEvvRequired('837P', { serviceCode: 'T1019', revenueCode: null })).toBe(true);
    expect(virginiaEvvRequired('837P', { serviceCode: 's5135', revenueCode: null })).toBe(true);
    expect(virginiaEvvRequired('837P', { serviceCode: 'S9125', revenueCode: null })).toBe(false); // respite, excluded
    expect(virginiaEvvRequired('837I', { serviceCode: 'G0299', revenueCode: '0551' }, '0329')).toBe(true);
    expect(virginiaEvvRequired('837I', { serviceCode: 'G0299', revenueCode: '0551' }, '0819')).toBe(false); // hospice
    expect(virginiaEvvRequired('837I', { serviceCode: 'A4550', revenueCode: '0270' }, '0329')).toBe(false); // supplies
  });
});

describe('virginiaEvvForLine', () => {
  it('reports local begin-end time, the attendant and the home address', () => {
    expect(virginiaEvvForLine(FACTS)).toEqual({
      evv: {
        times: '0800-1230',
        attendant: { lastName: 'Aide', firstName: 'Avery', id: 'D0007' },
        begin: { addressLine1: '12 Oak St', city: 'Richmond', state: 'VA', zip: '23220' },
        end: { addressLine1: '12 Oak St', city: 'Richmond', state: 'VA', zip: '23220' },
      },
      problems: [],
    });
    expect(localDateTime(new Date('2026-01-10T05:30:00Z'), 'America/New_York')).toEqual({ date: '2026-01-10', hhmm: '0030' });
  });

  it('names the DMAS edit for everything missing', () => {
    const r = virginiaEvvForLine({
      ...FACTS,
      record: { ...FACTS.record!, clockOut: null },
      attendant: { lastName: 'Aide', firstName: '', employeeId: null },
      serviceAddress: { ...FACTS.serviceAddress, zip: null },
    });
    expect(r.evv).toBeNull();
    expect(r.problems).toEqual([
      'EVV clock-out time missing (DMAS edit 2100)',
      'caregiver first or last name missing (DMAS edit 2097)',
      'caregiver has no employee ID (Staff → employee ID) (DMAS edit 2098)',
      "patient's street address, city, state or ZIP missing (DMAS edit 2095)",
    ]);
    expect(virginiaEvvForLine({ ...FACTS, record: null }).problems).toEqual(['no EVV record for this visit (DMAS edit 2094)']);
  });

  it('refuses SSN-like or punctuated attendant IDs', () => {
    const id = (employeeId: string) => virginiaEvvForLine({ ...FACTS, attendant: { ...FACTS.attendant!, employeeId } }).problems;
    expect(id('123456789')).toEqual(['caregiver employee ID looks like an SSN — DMAS forbids SSNs (DMAS edit 2098)']);
    expect(id('D-7')).toEqual(['caregiver employee ID must be letters and digits only (DMAS edit 2098)']);
  });

  it('needs a supervisor to verify clock-ins away from home', () => {
    const away = { ...FACTS.record!, clockInWithinGeofence: false, clockOutWithinGeofence: false };
    expect(virginiaEvvForLine({ ...FACTS, record: away }).problems).toEqual([
      "clock-in was away from the patient's home and hasn't been verified (DMAS edit 2095)",
      "clock-out was away from the patient's home and hasn't been verified (DMAS edit 2096)",
    ]);
    expect(virginiaEvvForLine({ ...FACTS, record: { ...away, status: 'verified' } }).problems).toEqual([]);
  });

  it('keeps a shift within one day: midnight is 2400 on the 837I, 2359 on the 837P; crossing it is refused', () => {
    const toMidnight = { ...FACTS.record!, clockIn: new Date('2026-09-25T00:00:00Z'), clockOut: new Date('2026-09-25T04:00:00Z') };
    expect(virginiaEvvForLine({ ...FACTS, record: toMidnight }).evv?.times).toBe('2000-2359');
    expect(virginiaEvvForLine({ ...FACTS, format: '837I', record: toMidnight }).evv?.times).toBe('2000-2400');
    const overnight = { ...toMidnight, clockOut: new Date('2026-09-25T10:00:00Z') };
    expect(virginiaEvvForLine({ ...FACTS, record: overnight }).problems).toEqual([
      'the shift crosses midnight — Virginia needs it billed as one line per day (DMAS edit 2100)',
    ]);
    expect(virginiaEvvForLine({ ...FACTS, serviceDate: '2026-09-23' }).problems).toEqual([
      "EVV clock-in was on 2026-09-24, not the line's date 2026-09-23 (DMAS edit 2099)",
    ]);
  });
});

const PROVIDER = {
  name: 'Demo Home Health, LLC',
  npi: '1234567893',
  taxId: '99-0000001',
  addressLine1: '100 Demo Plaza',
  city: 'Richmond',
  state: 'VA',
  zip: '23219-1234',
  contactName: 'Billing Office',
  phone: '(555) 010-0100',
};
const PATIENT = {
  lastName: 'Sample',
  firstName: 'Sam',
  memberId: '999000111222',
  dateOfBirth: '1940-01-01',
  gender: 'female',
  addressLine1: '12 Oak St',
  city: 'Richmond',
  state: 'VA',
  zip: '23220',
};
const EVV = virginiaEvvForLine(FACTS).evv!;

describe('EVV on Virginia claims', () => {
  it('837P: SV101-7 times, 2420D attendant with REF*LU, 2420G/H begin and end locations', () => {
    const input: Edi837Input = {
      sender: { name: 'DEMO', id: 'DEMOSUB01' },
      receiver: { name: 'DMAS', id: 'DMAS' },
      payer: { name: 'Virginia Medicaid', payerId: 'DMAS', payerType: 'medicaid' },
      provider: PROVIDER,
      claims: [
        {
          claimNumber: 'C1',
          frequencyCode: '1',
          totalCharges: 24,
          diagnosisCodes: ['R26.81'],
          priorAuthorization: null,
          patient: PATIENT,
          lines: [{ serviceCode: 'T1019', modifiers: ['U1'], serviceDate: '2026-09-24', units: 4, chargeAmount: 24, evv: EVV }],
        },
      ],
      controlNumber: 5,
      createdAt: new Date('2026-09-28T12:00:00Z'),
      usage: 'T',
    };
    const text = build837(input);
    expect(text).toContain(
      [
        'SV1*HC:T1019:U1::::0800-1230*24*UN*4***1~',
        'DTP*472*D8*20260924~',
        'NM1*DQ*1*AIDE*AVERY~',
        'REF*LU*D0007~',
        'NM1*PW*2~',
        'N3*12 OAK ST~',
        'N4*RICHMOND*VA*23220~',
        'NM1*45*2~',
        'N3*12 OAK ST~',
        'N4*RICHMOND*VA*23220~',
        'SE*',
      ].join('\n'),
    );
  });

  it('837I: 2310E HH EVV service location, SV202-7 times, 2420D attendant with REF*G2', () => {
    const input: Edi837IInput = {
      sender: { name: 'DEMO', id: 'DEMOSUB01' },
      receiver: { name: 'DMAS', id: 'DMAS' },
      payer: { name: 'Virginia Medicaid', payerId: 'DMAS', payerType: 'medicaid' },
      provider: PROVIDER,
      claims: [
        {
          claimNumber: 'C2',
          typeOfBill: '0321',
          totalCharges: 90,
          statementFrom: '2026-09-24',
          statementTo: '2026-09-24',
          admissionDate: null,
          patientStatus: '30',
          diagnosisCodes: ['I50.9'],
          priorAuthorization: null,
          medicalRecordNumber: null,
          hippsCode: null,
          valueCodes: [],
          patient: PATIENT,
          attending: { lastName: 'Doctor', firstName: 'Dana', npi: '1245319599' },
          evvServiceLocation: EVV.begin,
          lines: [
            {
              revenueCode: '0551',
              serviceCode: 'G0299',
              modifiers: [],
              serviceDate: '2026-09-24',
              units: 1,
              chargeAmount: 90,
              evv: { times: '0800-1230', attendant: EVV.attendant },
            },
          ],
        },
      ],
      controlNumber: 6,
      createdAt: new Date('2026-09-28T12:00:00Z'),
      usage: 'T',
    };
    const text = build837I(input);
    expect(text).toContain(
      ['NM1*71*1*DOCTOR*DANA****XX*1245319599~', 'NM1*77*2*HH EVV Service Location~', 'N3*12 OAK ST~', 'N4*RICHMOND*VA*23220~', 'REF*LU*99999~', 'LX*1~'].join('\n'),
    );
    expect(text).toContain(
      ['SV2*0551*HC:G0299:::::0800-1230*90*UN*1~', 'DTP*472*D8*20260924~', 'NM1*DN*1*AIDE*AVERY~', 'REF*G2*D0007~', 'SE*'].join('\n'),
    );
    const { evvServiceLocation: _, ...noLocation } = input.claims[0]!;
    expect(() => build837I({ ...input, claims: [noLocation] })).toThrow(/EVV lines need the service location/);
  });
});

describe('splitAtMidnight', () => {
  it('cuts a shift at local midnight, one piece per day', () => {
    const pieces = splitAtMidnight(new Date('2026-09-25T02:00:00Z'), new Date('2026-09-25T10:00:00Z'), 'America/New_York');
    expect(pieces).toEqual([
      { date: '2026-09-24', start: new Date('2026-09-25T02:00:00Z'), end: new Date('2026-09-25T04:00:00Z'), minutes: 120 },
      { date: '2026-09-25', start: new Date('2026-09-25T04:00:00Z'), end: new Date('2026-09-25T10:00:00Z'), minutes: 360 },
    ]);
    // The second piece reads 0000-0600 on its own day.
    expect(virginiaEvvForLine({ ...FACTS, serviceDate: '2026-09-25', window: pieces[1] }).evv?.times).toBe('0000-0600');
    expect(splitAtMidnight(new Date('2026-09-24T12:00:00Z'), new Date('2026-09-24T16:00:00Z'), 'America/New_York')).toHaveLength(1);
  });
});
