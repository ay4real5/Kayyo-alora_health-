import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build837, validate837, type Edi837Input } from './edi-837p.js';
import { clean, segment } from './x12.js';

/** FAKE data only. */
const SAMPLE: Edi837Input = {
  sender: { name: 'DEMO HOME HEALTH', id: 'DEMOSUB01' },
  receiver: { name: 'DEMO CLEARINGHOUSE', id: 'CLEARHOUSE' },
  payer: { name: 'Demo Medicaid', payerId: 'DEMOMCD', payerType: 'medicaid' },
  provider: {
    name: 'Démo Home Health, LLC',
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
      claimNumber: '260928ABC234',
      frequencyCode: '1',
      totalCharges: 36,
      diagnosisCodes: ['E11.9', 'I10'],
      priorAuthorization: 'DEMO-AUTH-1000',
      patient: {
        lastName: "O'Brien",
        firstName: 'Clara*Test',
        memberId: 'VA999000',
        dateOfBirth: '1940-01-01',
        gender: 'female',
        addressLine1: '12 Oak St',
        city: 'Richmond',
        state: 'VA',
        zip: '23220',
      },
      lines: [
        {
          serviceCode: 'T1019',
          modifiers: [],
          serviceDate: '2026-09-24',
          units: 4,
          chargeAmount: 24,
        },
        {
          serviceCode: 'T1019',
          modifiers: ['U1'],
          serviceDate: '2026-09-25',
          units: 2,
          chargeAmount: 12,
        },
      ],
    },
  ],
  controlNumber: 42,
  createdAt: new Date('2026-09-28T14:05:00Z'),
  usage: 'T',
};

describe('x12 helpers', () => {
  it('keeps separators and odd characters out of data', () => {
    expect(clean("O'Brien*Smith~ Jr.")).toBe("O'BRIEN SMITH JR.");
    expect(clean('Zoë  Müller')).toBe('ZOE MULLER');
  });

  it('drops trailing empty elements', () => {
    expect(segment('NM1', 'IL', '1', 'DOE', '', '')).toBe('NM1*IL*1*DOE~');
  });
});

describe('build837', () => {
  it('matches the golden file', () => {
    const file = join(__dirname, '__fixtures__', '837p-basic.edi');
    // UPDATE_GOLDEN=1 rewrites the fixture — only after reviewing the output line by line (D-053).
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, build837(SAMPLE));
    expect(build837(SAMPLE)).toBe(readFileSync(file, 'utf8'));
  });

  it('has a correct segment count and matching control numbers', () => {
    const lines = build837(SAMPLE).trim().split('\n');
    const st = lines.findIndex((l) => l.startsWith('ST*'));
    const se = lines.findIndex((l) => l.startsWith('SE*'));
    expect(lines[se]).toBe(`SE*${se - st + 1}*0001~`);
    expect(lines[0]!.length).toBe(106); // ISA is fixed width
    expect(lines[0]!.slice(90, 99)).toBe('000000042');
    expect(lines.at(-1)).toBe('IEA*1*000000042~');
  });
});

describe('validate837', () => {
  it('lists everything a payer would reject', () => {
    const bad: Edi837Input = {
      ...SAMPLE,
      provider: { ...SAMPLE.provider, zip: '23219', taxId: '123', npi: '' },
      payer: { ...SAMPLE.payer, payerId: '' },
      claims: [
        {
          ...SAMPLE.claims[0]!,
          diagnosisCodes: [],
          patient: { ...SAMPLE.claims[0]!.patient, memberId: '' },
        },
      ],
    };
    expect(validate837(bad)).toEqual([
      'Agency NPI must be 10 digits',
      'Agency tax ID (EIN) must be 9 digits',
      'Agency ZIP must be ZIP+4 (9 digits) for electronic claims',
      'The payer needs its payer ID',
      'Claim 260928ABC234: patient member ID missing',
      'Claim 260928ABC234: no diagnosis codes',
    ]);
    expect(() => build837(bad)).toThrow(/not valid/);
    expect(validate837(SAMPLE)).toEqual([]);
  });

  it('refuses private pay (invoiced, not claimed)', () => {
    expect(
      validate837({ ...SAMPLE, payer: { ...SAMPLE.payer, payerType: 'private_pay' } }),
    ).toContain('private_pay payers are not billed electronically');
  });
});
