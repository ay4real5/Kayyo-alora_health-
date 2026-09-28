import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build270, validate270, type Edi270Input } from './edi-270.js';
import { Edi271Error, parse271 } from './edi-271.js';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const input: Edi270Input = {
  sender: { id: 'DEMOSUB01' },
  receiver: { id: 'DEMOCLEAR' },
  payer: { name: 'Demo Medicaid', payerId: 'DEMOMCD' },
  provider: { name: 'Demo Home Health', npi: '1234567893', taxId: '99-0000001' },
  subscriber: { firstName: 'Clara', lastName: "O'Brien", memberId: 'VA999000', dateOfBirth: '1940-01-01', gender: 'female' },
  serviceDate: '2026-09-28',
  traceNumber: 'ELG260928AB12',
  controlNumber: 201,
  createdAt: new Date('2026-09-28T12:00:00Z'),
  usage: 'T',
};

describe('build270', () => {
  it('builds one subscriber inquiry with the trace number and service date', () => {
    const text = build270(input);
    const lines = text.trim().split('\n');
    expect(lines[0]).toHaveLength(106); // fixed-width ISA
    expect(lines.slice(1)).toEqual([
      'GS*HS*DEMOSUB01*DEMOCLEAR*20260928*1200*201*X*005010X279A1~',
      'ST*270*0001*005010X279A1~',
      'BHT*0022*13*ELG260928AB12*20260928*1200~',
      'HL*1**20*1~',
      'NM1*PR*2*DEMO MEDICAID*****PI*DEMOMCD~',
      'HL*2*1*21*1~',
      'NM1*1P*2*DEMO HOME HEALTH*****XX*1234567893~',
      'HL*3*2*22*0~',
      'TRN*1*ELG260928AB12*1990000001~',
      "NM1*IL*1*O'BRIEN*CLARA****MI*VA999000~",
      'DMG*D8*19400101*F~',
      'DTP*291*D8*20260928~',
      'EQ*30~',
      'SE*13*0001~',
      'GE*1*201~',
      'IEA*1*000000201~',
    ]);
  });

  it('refuses what the payer would reject', () => {
    expect(validate270({ ...input, subscriber: { ...input.subscriber, memberId: '', dateOfBirth: null } })).toEqual([
      "The patient's member ID for this payer is missing",
      'Patient date of birth missing',
    ]);
    expect(() => build270({ ...input, provider: { ...input.provider, npi: '123' } })).toThrow(/NPI/);
  });
});

describe('parse271', () => {
  it('reads active coverage, plan dates, deductible, co-pay and co-insurance', () => {
    const r = parse271(fixture('271-active.edi'));
    expect(r).toMatchObject({
      traceNumber: 'ELG260928AB12',
      payer: { name: 'DEMO MEDICAID', id: 'DEMOMCD' },
      subscriber: { firstName: 'CLARA', lastName: "O'BRIEN", memberId: 'VA999000' },
      coverageActive: true,
      planName: 'VIRGINIA MEDICAID FFS',
      coverageStart: '2026-01-01',
      coverageEnd: '2026-12-31',
      deductible: 500,
      deductibleRemaining: 125.5,
      copay: 3,
      coinsurancePercent: 20,
      rejections: [],
    });
    expect(r.benefits[0]).toMatchObject({ code: '1', label: 'Active coverage', serviceTypes: ['30', '42'] });
    expect(r.benefits.find((b) => b.code === 'B')?.messages).toEqual(['COPAY PER HOME HEALTH VISIT']);
  });

  it('reports request rejections with a readable reason', () => {
    const r = parse271(fixture('271-rejected.edi'));
    expect(r.coverageActive).toBeNull();
    expect(r.traceNumber).toBe('ELG260928ZZ99');
    expect(r.rejections).toEqual([{ code: '72', reason: 'Invalid/missing subscriber/insured ID', followUp: 'C' }]);
  });

  it('refuses files that are not 271s', () => {
    expect(() => parse271('hello')).toThrow(Edi271Error);
    expect(() => parse271(fixture('835-basic.edi'))).toThrow(/not a 271/i);
  });
});
