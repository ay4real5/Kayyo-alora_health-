import { readX12, X12Error } from './x12.js';

/**
 * EDI 999 Implementation Acknowledgment (005010X231A1) parser (D-076): did the clearinghouse/payer accept our 837 file
 * as valid X12? Pure: text in, plain result out. It says nothing about the claims' content — that's the 277CA.
 */

export interface Ack999Error {
  /** IK3: the segment in error, its position and loop, and why (IK304). */
  segment: string;
  position: string;
  loop: string | null;
  reason: string;
  /** IK4: the element in error, if given. */
  element: string | null;
  elementReason: string | null;
}

export interface Ack999Transaction {
  /** AK202 — the ST02 control number of our transaction set. */
  controlNumber: string;
  /** IK501: A accepted, E accepted with errors, M/R/W/X rejected. */
  code: string;
  accepted: boolean;
  errors: Ack999Error[];
}

export interface Ack999 {
  /** AK102 — the GS06 group control number of our file. */
  groupControlNumber: string;
  /** AK101 — HC for 837 claims. */
  functionalId: string;
  /** AK901: A accepted, E accepted with errors, P partially accepted, R rejected. */
  groupCode: string;
  groupAccepted: boolean;
  transactions: Ack999Transaction[];
}

/** Plain words for the codes billing staff see. */
export const ACK_999_CODES: Record<string, string> = {
  A: 'Accepted',
  E: 'Accepted with errors',
  P: 'Partially accepted',
  M: 'Rejected (message authentication failed)',
  R: 'Rejected',
  W: 'Rejected (assurance failed)',
  X: 'Rejected (content after decryption could not be analyzed)',
};

const ACCEPTED = new Set(['A', 'E']);

export function parse999(text: string): Ack999 {
  const { segments } = readX12(text);
  const st = segments.find((s) => s[0] === 'ST');
  if (!st || st[1] !== '999') throw new X12Error('Not a 999 acknowledgment (ST01 is not 999)');
  const ak1 = segments.find((s) => s[0] === 'AK1');
  const ak9 = segments.find((s) => s[0] === 'AK9');
  if (!ak1 || !ak9) throw new X12Error('999 is missing AK1 or AK9');

  const transactions: Ack999Transaction[] = [];
  let current: Ack999Transaction | null = null;
  for (const s of segments) {
    if (s[0] === 'AK2') {
      current = { controlNumber: s[2] ?? '', code: '', accepted: false, errors: [] };
      transactions.push(current);
    } else if (s[0] === 'IK3' && current) {
      current.errors.push({ segment: s[1] ?? '', position: s[2] ?? '', loop: s[3] || null, reason: s[4] ?? '', element: null, elementReason: null });
    } else if (s[0] === 'IK4' && current) {
      const last = current.errors.at(-1);
      if (last) {
        last.element = s[1] ?? null;
        last.elementReason = s[3] ?? null;
      }
    } else if (s[0] === 'IK5' && current) {
      current.code = s[1] ?? '';
      current.accepted = ACCEPTED.has(current.code);
    }
  }
  const groupCode = ak9[1] ?? '';
  return {
    groupControlNumber: ak1[2] ?? '',
    functionalId: ak1[1] ?? '',
    groupCode,
    groupAccepted: groupCode === 'A' || groupCode === 'E' || groupCode === 'P',
    transactions,
  };
}

/** "NM1 at segment 12 (loop 2010BA): code 8" — for a rejected claim's reason. */
export function describe999Error(e: Ack999Error): string {
  return `${e.segment} at segment ${e.position}${e.loop ? ` (loop ${e.loop})` : ''}: syntax error ${e.reason}${
    e.element ? `, element ${e.element}${e.elementReason ? ` error ${e.elementReason}` : ''}` : ''
  }`;
}
