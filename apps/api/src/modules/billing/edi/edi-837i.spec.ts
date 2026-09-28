import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build837I, validate837I, type Edi837IInput } from './edi-837i.js';

/** FAKE data only: a Medicare home health final claim with a HIPPS code and two visit lines. */
const SAMPLE: Edi837IInput = {
  sender: { name: 'DEMO HOME HEALTH', id: 'DEMOSUB01' },
  receiver: { name: 'DEMO CLEARINGHOUSE', id: 'CLEARHOUSE' },
  payer: { name: 'Demo Medicare', payerId: 'DEMOMCR', payerType: 'medicare' },
  provider: {
    name: 'Demo Home Health, LLC',
    npi: '1234567893',
    taxId: '99-0000001',
    addressLine1: '100 Demo Plaza',
    city: 'Richmond',
    state: 'VA',
    zip: '23219-1234',
    contactName: 'Billing Office',
    phone: '(555) 010-0100',
  },
  claims: [
    {
      claimNumber: '260928HHI001',
      typeOfBill: '0329',
      totalCharges: 198,
      statementFrom: '2026-09-01',
      statementTo: '2026-09-30',
      admissionDate: '2026-08-20',
      patientStatus: '30',
      diagnosisCodes: ['I50.9', 'E11.9', 'Z79.4'],
      priorAuthorization: null,
      medicalRecordNumber: 'DEMO-0007',
      hippsCode: '1FC21',
      valueCodes: [{ code: '61', amount: 40060 }],
      patient: {
        lastName: 'Sample',
        firstName: 'Sam',
        memberId: '1EG4TE5MK73',
        dateOfBirth: '1938-04-02',
        gender: 'male',
        addressLine1: '12 Oak St',
        city: 'Richmond',
        state: 'VA',
        zip: '23220',
      },
      attending: { lastName: 'Doctor', firstName: 'Dana', npi: '1245319599' },
      lines: [
        { revenueCode: '0551', serviceCode: 'G0299', modifiers: [], serviceDate: '2026-09-03', units: 4, chargeAmount: 168 },
        { revenueCode: '0571', serviceCode: 'G0156', modifiers: [], serviceDate: '2026-09-05', units: 4, chargeAmount: 30 },
      ],
    },
  ],
  controlNumber: 301,
  createdAt: new Date('2026-09-28T12:00:00Z'),
  usage: 'T',
};

describe('build837I', () => {
  it('matches the reviewed golden file', () => {
    const file = join(__dirname, '__fixtures__', '837i-home-health.edi');
    // UPDATE_GOLDEN=1 rewrites the fixture — only after reviewing the output line by line (D-061).
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, build837I(SAMPLE));
    expect(build837I(SAMPLE)).toBe(readFileSync(file, 'utf8'));
  });

  it('puts the institutional pieces where a payer expects them', () => {
    const lines = build837I(SAMPLE).trim().split('\n');
    expect(lines).toContain('GS*HC*DEMOSUB01*CLEARHOUSE*20260928*1200*301*X*005010X223A2~');
    expect(lines).toContain('CLM*260928HHI001*198***32:A:9**A*Y*Y~');
    expect(lines).toContain('DTP*434*RD8*20260901-20260930~');
    expect(lines).toContain('CL1*9*1*30~');
    expect(lines).toContain('HI*ABK:I509~');
    expect(lines).toContain('HI*ABF:E119*ABF:Z794~');
    expect(lines).toContain('HI*BE:61:::40060~');
    expect(lines).toContain('NM1*71*1*DOCTOR*DANA****XX*1245319599~');
    expect(lines).toContain('SV2*0023*HP:1FC21*0*UN*1~'); // HIPPS line first
    expect(lines).toContain('SV2*0551*HC:G0299*168*UN*4~');
    const st = lines.findIndex((l) => l.startsWith('ST*'));
    const se = lines.findIndex((l) => l.startsWith('SE*'));
    expect(lines[se]).toBe(`SE*${se - st + 1}*0001~`);
  });

  it('lists what a home health claim is missing', () => {
    const claim = SAMPLE.claims[0]!;
    const problems = validate837I({
      ...SAMPLE,
      claims: [
        {
          ...claim,
          typeOfBill: '329',
          hippsCode: null,
          valueCodes: [],
          attending: null,
          lines: [{ ...claim.lines[0]!, revenueCode: '' }],
          patient: { ...claim.patient, addressLine1: null },
        },
      ],
    });
    expect(problems).toEqual([
      'Claim 260928HHI001: type of bill must look like 0329',
      'Claim 260928HHI001: patient address missing (required on institutional claims)',
      "Claim 260928HHI001: attending physician with an NPI is required (the patient's physician)",
      'Claim 260928HHI001: G0299 has no 4-digit revenue code (set it on the service code)',
      'Claim 260928HHI001: Medicare home health claims need the 5-character HIPPS code',
      'Claim 260928HHI001: Medicare home health claims need value code 61 (CBSA code)',
    ]);
    // Medicaid institutional claims don't need HIPPS or value code 61.
    expect(validate837I({ ...SAMPLE, payer: { ...SAMPLE.payer, payerType: 'medicaid' }, claims: [{ ...claim, hippsCode: null, valueCodes: [] }] })).toEqual([]);
  });
});
