import { readX12, X12Error } from './x12.js';

/**
 * EDI 277CA Claim Acknowledgment (005010X214) parser (D-076): for each claim in our 837, did the payer (or
 * clearinghouse) take it into processing or reject it at the front door? Pure: text in, plain result out.
 */

export interface ClaimStatus {
  /** STC01-1 claim status category: A1/A2 accepted, A3/A4/A6/A7/A8 rejected… */
  category: string;
  /** STC01-2 claim status code (the reason), e.g. 562 = provider NPI. */
  code: string;
  /** STC01-3 entity the status is about, e.g. 85 billing provider, IL subscriber. */
  entity: string | null;
}

export interface AckClaim {
  /** TRN02 at the claim level — our CLM01 claim number. */
  claimNumber: string;
  accepted: boolean;
  statuses: ClaimStatus[];
  /** REF*1K — the payer's claim control number, when accepted. */
  payerClaimNumber: string | null;
  /** STC04 — total charge the payer read. */
  amount: number | null;
}

export interface Ack277 {
  claims: AckClaim[];
}

/** Claim status categories (code list 507) in plain words. */
export const STATUS_CATEGORIES: Record<string, string> = {
  A0: 'Forwarded',
  A1: 'Received',
  A2: 'Accepted for processing',
  A3: 'Returned as unprocessable',
  A4: 'Not found',
  A5: 'Split claim',
  A6: 'Rejected — missing information',
  A7: 'Rejected — invalid information',
  A8: 'Rejected — relational field in error',
};
const REJECTED = new Set(['A3', 'A4', 'A6', 'A7', 'A8']);

/** "A7 Rejected — invalid information, status code 562 (billing provider)" — short text for billing staff. */
export function describeStatus(s: ClaimStatus): string {
  const entities: Record<string, string> = { '85': 'billing provider', IL: 'subscriber', QC: 'patient', PR: 'payer', '82': 'rendering provider', '77': 'service location', '71': 'attending provider', DN: 'referring provider', DQ: 'supervising provider' };
  const who = s.entity ? ` (${entities[s.entity] ?? `entity ${s.entity}`})` : '';
  return `${s.category} ${STATUS_CATEGORIES[s.category] ?? 'status'}, status code ${s.code}${who}`;
}

export function parse277ca(text: string): Ack277 {
  const { segments, component } = readX12(text);
  const st = segments.find((s) => s[0] === 'ST');
  if (!st || st[1] !== '277') throw new X12Error('Not a 277 claim acknowledgment (ST01 is not 277)');

  const claims: AckClaim[] = [];
  let level: string | null = null; // HL03: 20 source, 21 receiver, 19 provider, PT patient (claim)
  let current: AckClaim | null = null;
  for (const s of segments) {
    if (s[0] === 'HL') {
      level = s[3] ?? null;
      current = null;
    } else if (s[0] === 'TRN' && s[1] === '2' && level === 'PT') {
      current = { claimNumber: s[2] ?? '', accepted: false, statuses: [], payerClaimNumber: null, amount: null };
      claims.push(current);
    } else if (s[0] === 'STC' && current) {
      // Claim-level STCs come before any SVC (service line) segment; line-level ones don't decide the claim.
      const [category = '', code = '', entity] = (s[1] ?? '').split(component);
      current.statuses.push({ category, code, entity: entity || null });
      if (current.amount === null && s[4]) current.amount = Number(s[4]);
    } else if (s[0] === 'REF' && s[1] === '1K' && current) {
      current.payerClaimNumber = s[2] ?? null;
    } else if (s[0] === 'SVC') {
      current = null;
    }
  }
  for (const c of claims) c.accepted = c.statuses.length > 0 && !c.statuses.some((s) => REJECTED.has(s.category));
  return { claims };
}
