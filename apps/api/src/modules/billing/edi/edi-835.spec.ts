import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Edi835Error, parse835 } from './edi-835.js';

const sample = readFileSync(join(__dirname, '__fixtures__', '835-basic.edi'), 'utf8');

const expected = {
  controlNumber: '000000101',
  payment: { amount: 30.5, method: 'ACH', date: '2026-09-30', traceNumber: 'EFT12345' },
  payer: { name: 'DEMO MEDICAID', id: 'DEMOMCD' },
  payee: { name: 'DEMO HOME HEALTH', npi: '1234567893' },
  claims: [
    {
      claimNumber: '260928ABC234',
      statusCode: '1',
      chargeAmount: 36,
      paidAmount: 30.5,
      patientResponsibility: 0,
      payerClaimNumber: 'PAYERCLM001',
      patientName: "CLARA O'BRIEN",
      memberId: 'VA999000',
      adjustments: [],
      lines: [
        {
          serviceCode: 'T1019',
          modifiers: [],
          chargeAmount: 24,
          paidAmount: 20,
          units: 4,
          serviceDate: '2026-09-24',
          adjustments: [{ group: 'CO', reason: '45', amount: 4 }],
          remarks: [],
        },
        {
          serviceCode: 'T1019',
          modifiers: ['U1'],
          chargeAmount: 12,
          paidAmount: 10.5,
          units: 2,
          serviceDate: '2026-09-25',
          adjustments: [{ group: 'CO', reason: '45', amount: 1.5 }],
          remarks: [],
        },
      ],
    },
    {
      claimNumber: '260928DEF567',
      statusCode: '4',
      chargeAmount: 20,
      paidAmount: 0,
      patientResponsibility: 0,
      payerClaimNumber: 'PAYERCLM002',
      patientName: 'JO SMITH',
      memberId: 'VA111',
      adjustments: [{ group: 'CO', reason: '197', amount: 20 }],
      lines: [
        {
          serviceCode: 'G0156',
          modifiers: [],
          chargeAmount: 20,
          paidAmount: 0,
          units: 4,
          serviceDate: '2026-09-20',
          adjustments: [],
          remarks: ['N54'],
        },
      ],
    },
  ],
  providerAdjustments: [{ reason: 'L6', amount: -1.25 }],
};

describe('parse835', () => {
  it('reads payment, payer, payee, claims, lines, adjustments and remarks', () => {
    expect(parse835(sample)).toEqual(expected);
  });

  it('uses the separators declared in ISA, with or without line breaks', () => {
    const other = sample.replaceAll('\n', '').replaceAll('*', '|').replaceAll('~', '\\').replaceAll(':', '>');
    expect(parse835(other)).toEqual(expected);
  });

  it('refuses what is not an 835', () => {
    expect(() => parse835('hello')).toThrow(Edi835Error);
    expect(() => parse835(sample.replace('ST*835', 'ST*837'))).toThrow(/Not an 835/);
  });

  it('reads multiple adjustment triples in one CAS', () => {
    const text = sample.replace('CAS*CO*197*20~', 'CAS*PR*1*5**2*3*1~');
    expect(parse835(text).claims[1]!.adjustments).toEqual([
      { group: 'PR', reason: '1', amount: 5 },
      { group: 'PR', reason: '2', amount: 3, quantity: 1 },
    ]);
  });
});
