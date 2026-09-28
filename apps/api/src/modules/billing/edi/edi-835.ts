/**
 * EDI 835 (Health Care Claim Payment/Advice, ASC X12 005010X221A1) parser (DECISIONS D-054). Pure: text in, a plain
 * remittance out. Separators are read from the ISA segment, so any valid delimiters work, with or without newlines.
 */

export interface Adjustment {
  /** CO contractual, PR patient responsibility, OA other, PI payer initiated, CR correction. */
  group: string;
  /** CARC — claim adjustment reason code. */
  reason: string;
  amount: number;
  quantity?: number;
}

export interface RemitServiceLine {
  serviceCode: string;
  modifiers: string[];
  chargeAmount: number;
  paidAmount: number;
  units: number | null;
  serviceDate: string | null;
  adjustments: Adjustment[];
  /** RARC — remittance advice remark codes (LQ*HE). */
  remarks: string[];
}

export interface RemitClaim {
  /** CLP01 — our claim number (patient control number). */
  claimNumber: string;
  /** CLP02: 1 processed as primary, 2 secondary, 3 tertiary, 4 denied, 22 reversal. */
  statusCode: string;
  chargeAmount: number;
  paidAmount: number;
  patientResponsibility: number;
  payerClaimNumber: string | null;
  patientName: string | null;
  memberId: string | null;
  adjustments: Adjustment[];
  lines: RemitServiceLine[];
}

export interface Remittance {
  controlNumber: string;
  payment: {
    amount: number;
    /** ACH, CHK, NON (no payment), FWT, BOP. */
    method: string;
    date: string | null;
    traceNumber: string | null;
  };
  payer: { name: string | null; id: string | null };
  payee: { name: string | null; npi: string | null };
  claims: RemitClaim[];
  /** PLB — provider-level adjustments (e.g. interest, overpayment recovery). */
  providerAdjustments: { reason: string; amount: number }[];
}

export class Edi835Error extends Error {}

const num = (v: string | undefined) => (v === undefined || v === '' ? 0 : Number(v));
const date8 = (v: string | undefined) =>
  v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;

/** CAS: group, then up to six (reason, amount, quantity) triples. */
function adjustments(el: string[]): Adjustment[] {
  const out: Adjustment[] = [];
  for (let i = 2; i + 1 < el.length; i += 3) {
    if (!el[i]) continue;
    const adj: Adjustment = { group: el[1]!, reason: el[i]!, amount: num(el[i + 1]) };
    if (el[i + 2]) adj.quantity = num(el[i + 2]);
    out.push(adj);
  }
  return out;
}

export function parse835(text: string): Remittance {
  const raw = text.replace(/^﻿/, '');
  const isaAt = raw.indexOf('ISA');
  if (isaAt < 0 || raw.length < isaAt + 106)
    throw new Edi835Error('Not an X12 file (no ISA segment)');
  const isa = raw.slice(isaAt, isaAt + 106);
  const elementSep = isa[3]!;
  const componentSep = isa[104]!;
  const segmentSep = isa[105]!;
  const segments = raw
    .slice(isaAt)
    .split(segmentSep)
    .map((s) => s.replace(/^[\r\n]+/, '').trim())
    .filter(Boolean)
    .map((s) => s.split(elementSep));

  const st = segments.find((s) => s[0] === 'ST');
  if (!st || st[1] !== '835') throw new Edi835Error('Not an 835 remittance (ST01 is not 835)');

  const remit: Remittance = {
    controlNumber: (segments[0]![13] ?? '').trim(),
    payment: { amount: 0, method: '', date: null, traceNumber: null },
    payer: { name: null, id: null },
    payee: { name: null, npi: null },
    claims: [],
    providerAdjustments: [],
  };
  let claim: RemitClaim | null = null;
  let line: RemitServiceLine | null = null;
  let party: 'PR' | 'PE' | null = null;

  for (const el of segments) {
    switch (el[0]) {
      case 'BPR':
        remit.payment.amount = num(el[2]);
        remit.payment.method = el[4] ?? '';
        remit.payment.date = date8(el[16]);
        break;
      case 'TRN':
        remit.payment.traceNumber = el[2] || null;
        break;
      case 'N1':
        party = el[1] === 'PR' || el[1] === 'PE' ? el[1] : null;
        if (party === 'PR') remit.payer.name = el[2] || null;
        if (party === 'PE') {
          remit.payee.name = el[2] || null;
          if (el[3] === 'XX') remit.payee.npi = el[4] || null;
        }
        break;
      case 'REF':
        if (party === 'PR' && el[1] === '2U' && !claim) remit.payer.id = el[2] || null;
        break;
      case 'CLP':
        line = null;
        claim = {
          claimNumber: el[1] ?? '',
          statusCode: el[2] ?? '',
          chargeAmount: num(el[3]),
          paidAmount: num(el[4]),
          patientResponsibility: num(el[5]),
          payerClaimNumber: el[7] || null,
          patientName: null,
          memberId: null,
          adjustments: [],
          lines: [],
        };
        remit.claims.push(claim);
        break;
      case 'NM1':
        if (claim && el[1] === 'QC') {
          claim.patientName = [el[4], el[3]].filter(Boolean).join(' ') || null;
          claim.memberId = el[9] || null;
        }
        break;
      case 'CAS':
        if (line) line.adjustments.push(...adjustments(el));
        else if (claim) claim.adjustments.push(...adjustments(el));
        break;
      case 'SVC': {
        if (!claim) break;
        const [, code = '', ...mods] = (el[1] ?? '').split(componentSep);
        line = {
          serviceCode: code,
          modifiers: mods.filter(Boolean),
          chargeAmount: num(el[2]),
          paidAmount: num(el[3]),
          units: el[5] ? num(el[5]) : null,
          serviceDate: null,
          adjustments: [],
          remarks: [],
        };
        claim.lines.push(line);
        break;
      }
      case 'DTM':
        if (line && el[1] === '472') line.serviceDate = date8(el[2]);
        break;
      case 'LQ':
        if (line && el[1] === 'HE' && el[2]) line.remarks.push(el[2]);
        break;
      case 'PLB':
        for (let i = 3; i + 1 < el.length; i += 2) {
          const [reason = ''] = (el[i] ?? '').split(componentSep);
          if (reason) remit.providerAdjustments.push({ reason, amount: num(el[i + 1]) });
        }
        break;
      case 'SE':
        claim = null;
        line = null;
        break;
    }
  }
  return remit;
}
