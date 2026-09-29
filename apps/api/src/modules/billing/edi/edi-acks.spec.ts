import { describe, expect, it } from 'vitest';
import { describeStatus, parse277ca } from './edi-277ca.js';
import { describe999Error, parse999 } from './edi-999.js';
import { COMPONENT, pad, REPETITION, segment, X12Error } from './x12.js';

/** A FAKE interchange around `body` segments, as a clearinghouse would send it back. */
export function interchange(functional: string, version: string, body: string[]): string {
  return [
    segment('ISA', '00', pad('', 10), '00', pad('', 10), 'ZZ', pad('CLEARHOUSE', 15), 'ZZ', pad('DEMOSUB01', 15), '260929', '0815', REPETITION, '00501', '000000077', '0', 'P', COMPONENT),
    segment('GS', functional, 'CLEARHOUSE', 'DEMOSUB01', '20260929', '0815', '77', 'X', version),
    ...body,
    segment('GE', '1', '77'),
    segment('IEA', '1', '000000077'),
  ].join('\n');
}

export const ACK_999_REJECTED = interchange('FA', '005010X231A1', [
  segment('ST', '999', '0001', '005010X231A1'),
  segment('AK1', 'HC', '42', '005010X222A1'),
  segment('AK2', '837', '0001', '005010X222A1'),
  segment('IK3', 'NM1', '12', '2010BA', '8'),
  segment('IK4', '9', '', '7', 'VA999'),
  segment('IK5', 'R', '5'),
  segment('AK9', 'R', '1', '1', '0'),
  segment('SE', '8', '0001'),
]);

export const ACK_277CA = interchange('HN', '005010X214', [
  segment('ST', '277', '0001', '005010X214'),
  segment('BHT', '0085', '08', 'B1', '20260929', '0815', 'TH'),
  segment('HL', '1', '', '20', '1'),
  segment('NM1', 'PR', '2', 'DEMO MEDICAID', '', '', '', '', 'PI', 'DEMOMCD'),
  segment('HL', '2', '1', '21', '1'),
  segment('NM1', '41', '2', 'DEMO HOME HEALTH', '', '', '', '', '46', 'DEMOSUB01'),
  segment('TRN', '2', 'BATCH42'),
  segment('STC', 'A1:19:PR', '20260929', 'WQ', '96'),
  segment('HL', '3', '2', '19', '1'),
  segment('NM1', '85', '2', 'DEMO HOME HEALTH', '', '', '', '', 'XX', '1234567893'),
  segment('HL', '4', '3', 'PT'),
  segment('NM1', 'QC', '1', 'SAMPLE', 'SAM', '', '', '', 'MI', '999000111222'),
  segment('TRN', '2', '260928ACCEPT'),
  segment('STC', 'A2:20:PR', '20260929', 'WQ', '36'),
  segment('REF', '1K', 'PAYER-777'),
  segment('DTP', '472', 'RD8', '20260924-20260925'),
  segment('HL', '5', '3', 'PT'),
  segment('NM1', 'QC', '1', 'OTHER', 'OLA', '', '', '', 'MI', '999000111333'),
  segment('TRN', '2', '260928REJECT'),
  segment('STC', 'A7:562:85', '20260929', 'U', '60'),
  segment('STC', 'A7:128:85'),
  segment('SE', '20', '0001'),
]);

describe('parse999', () => {
  it('reads the group and transaction verdicts with the errors', () => {
    const ack = parse999(ACK_999_REJECTED);
    expect(ack).toEqual({
      groupControlNumber: '42',
      functionalId: 'HC',
      groupCode: 'R',
      groupAccepted: false,
      transactions: [
        {
          controlNumber: '0001',
          code: 'R',
          accepted: false,
          errors: [{ segment: 'NM1', position: '12', loop: '2010BA', reason: '8', element: '9', elementReason: '7' }],
        },
      ],
    });
    expect(describe999Error(ack.transactions[0]!.errors[0]!)).toBe('NM1 at segment 12 (loop 2010BA): syntax error 8, element 9 error 7');
  });

  it('refuses other files', () => {
    expect(() => parse999(ACK_277CA)).toThrow(X12Error);
    expect(() => parse999('hello')).toThrow('Not an X12 file');
  });
});

describe('parse277ca', () => {
  it('reads each claim: accepted with the payer claim number, or rejected with its reasons', () => {
    const ack = parse277ca(ACK_277CA);
    expect(ack.claims).toEqual([
      {
        claimNumber: '260928ACCEPT',
        accepted: true,
        statuses: [{ category: 'A2', code: '20', entity: 'PR' }],
        payerClaimNumber: 'PAYER-777',
        amount: 36,
      },
      {
        claimNumber: '260928REJECT',
        accepted: false,
        statuses: [
          { category: 'A7', code: '562', entity: '85' },
          { category: 'A7', code: '128', entity: '85' },
        ],
        payerClaimNumber: null,
        amount: 60,
      },
    ]);
    expect(describeStatus(ack.claims[1]!.statuses[0]!)).toBe('A7 Rejected — invalid information, status code 562 (billing provider)');
  });
});
