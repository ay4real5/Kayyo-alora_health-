/** 271 eligibility response parser (005010X279A1, D-060). Pure: text in, facts out. */

export class Edi271Error extends Error {}

export interface Benefit {
  /** EB01, e.g. 1 active, 6 inactive, B co-payment, C deductible, A co-insurance. */
  code: string;
  label: string;
  coverageLevel: string | null;
  serviceTypes: string[];
  planName: string | null;
  /** EB06 time period: 23 calendar year, 29 remaining, … */
  period: string | null;
  amount: number | null;
  percent: number | null;
  inNetwork: boolean | null;
  messages: string[];
}

export interface Eligibility271 {
  traceNumber: string | null;
  payer: { name: string | null; id: string | null };
  subscriber: { firstName: string | null; lastName: string | null; memberId: string | null };
  /** true = active coverage found, false = inactive, null = the payer couldn't say (see rejections). */
  coverageActive: boolean | null;
  planName: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  copay: number | null;
  coinsurancePercent: number | null;
  deductible: number | null;
  deductibleRemaining: number | null;
  benefits: Benefit[];
  /** AAA request rejections (e.g. 72 invalid member ID). */
  rejections: { code: string; reason: string; followUp: string | null }[];
}

const EB_LABELS: Record<string, string> = {
  '1': 'Active coverage',
  '2': 'Active - full risk capitation',
  '3': 'Active - services capitated',
  '4': 'Active - services capitated to primary care physician',
  '5': 'Active - pending investigation',
  '6': 'Inactive',
  '7': 'Inactive - pending eligibility update',
  '8': 'Inactive - pending investigation',
  A: 'Co-insurance',
  B: 'Co-payment',
  C: 'Deductible',
  D: 'Benefit description',
  F: 'Limitations',
  G: 'Out of pocket (stop loss)',
  I: 'Non-covered',
  L: 'Primary care provider',
  N: 'Services restricted to following provider',
  R: 'Other or additional payer',
  U: 'Contact following entity for eligibility or benefit information',
  V: 'Cannot process',
};

/** The AAA03 reasons payers most often send (full list in the X279 guide). */
const REJECT_REASONS: Record<string, string> = {
  '15': 'Required application data missing',
  '41': 'Authorization/access restrictions',
  '42': 'Unable to respond at current time',
  '43': 'Invalid/missing provider identification',
  '44': 'Invalid/missing provider name',
  '45': 'Invalid/missing provider specialty',
  '47': 'Invalid/missing provider state',
  '48': 'Invalid/missing referring provider identification number',
  '49': 'Provider is not primary care physician',
  '50': 'Provider ineligible for inquiries',
  '51': 'Provider not on file',
  '52': 'Service dates not within provider plan enrollment',
  '56': 'Inappropriate date',
  '57': 'Invalid/missing date(s) of service',
  '58': 'Invalid/missing date of birth',
  '60': 'Date of birth follows date(s) of service',
  '61': 'Date of death precedes date(s) of service',
  '62': 'Date of service not within allowable inquiry period',
  '63': 'Date of service in future',
  '64': 'Invalid/missing patient ID',
  '65': 'Invalid/missing patient name',
  '66': 'Invalid/missing patient gender code',
  '67': 'Patient not found',
  '68': 'Duplicate patient ID number',
  '71': 'Patient birth date does not match that for the patient on the database',
  '72': 'Invalid/missing subscriber/insured ID',
  '73': 'Invalid/missing subscriber/insured name',
  '75': 'Subscriber/insured not found',
  '76': 'Duplicate subscriber/insured ID number',
  '79': 'Invalid participant identification',
  '80': 'No response received - transaction terminated',
  T4: 'Payer name or identifier missing',
};

const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
const iso = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

/** DTP value: D8 CCYYMMDD, or RD8 CCYYMMDD-CCYYMMDD → [start, end]. */
function dates(format: string | undefined, value: string | undefined): [string | null, string | null] {
  if (!value) return [null, null];
  if (format === 'RD8' && /^\d{8}-\d{8}$/.test(value)) return [iso(value.slice(0, 8)), iso(value.slice(9))];
  if (/^\d{8}$/.test(value)) return [iso(value), iso(value)];
  return [null, null];
}

export function parse271(text: string): Eligibility271 {
  const raw = text.replace(/^﻿/, '');
  const isaAt = raw.indexOf('ISA');
  if (isaAt < 0 || raw.length < isaAt + 106) throw new Edi271Error('Not an X12 file (no ISA segment)');
  const isa = raw.slice(isaAt, isaAt + 106);
  const elementSep = isa[3]!;
  const repetitionSep = isa[82]!;
  const segmentSep = isa[105]!;
  const segments = raw
    .slice(isaAt)
    .split(segmentSep)
    .map((s) => s.replace(/^[\r\n]+/, '').trim())
    .filter(Boolean)
    .map((s) => s.split(elementSep));
  const st = segments.find((s) => s[0] === 'ST');
  if (!st || st[1] !== '271') throw new Edi271Error('Not a 271 eligibility response (ST01 is not 271)');

  const out: Eligibility271 = {
    traceNumber: null,
    payer: { name: null, id: null },
    subscriber: { firstName: null, lastName: null, memberId: null },
    coverageActive: null,
    planName: null,
    coverageStart: null,
    coverageEnd: null,
    copay: null,
    coinsurancePercent: null,
    deductible: null,
    deductibleRemaining: null,
    benefits: [],
    rejections: [],
  };
  let benefit: Benefit | null = null;

  for (const el of segments) {
    switch (el[0]) {
      case 'NM1':
        benefit = null;
        if (el[1] === 'PR') out.payer = { name: el[3] || null, id: el[9] || null };
        if (el[1] === 'IL') out.subscriber = { lastName: el[3] || null, firstName: el[4] || null, memberId: el[9] || null };
        break;
      case 'TRN':
        // The 271 may carry our trace (TRN*2) and the payer's own (TRN*1); ours is the one to match.
        if (el[1] === '2' || !out.traceNumber) out.traceNumber = el[2] || out.traceNumber;
        break;
      case 'AAA':
        if (el[1] === 'N' && el[3]) out.rejections.push({ code: el[3], reason: REJECT_REASONS[el[3]] ?? `Rejected (code ${el[3]})`, followUp: el[4] || null });
        break;
      case 'EB': {
        benefit = {
          code: el[1] ?? '',
          label: EB_LABELS[el[1] ?? ''] ?? `Benefit ${el[1]}`,
          coverageLevel: el[2] || null,
          serviceTypes: (el[3] ?? '').split(repetitionSep).filter(Boolean),
          planName: el[5] || null,
          period: el[6] || null,
          amount: num(el[7]),
          percent: num(el[8]),
          inNetwork: el[12] === 'Y' ? true : el[12] === 'N' ? false : null,
          messages: [],
        };
        out.benefits.push(benefit);
        break;
      }
      case 'MSG':
        if (benefit && el[1]) benefit.messages.push(el[1]);
        break;
      case 'DTP': {
        const [start, end] = dates(el[2], el[3]);
        if (el[1] === '291' || el[1] === '307') {
          // Plan / eligibility dates: a range gives both ends; a single date is only a start.
          out.coverageStart ??= start;
          if (el[2] === 'RD8') out.coverageEnd ??= end;
        } else if (el[1] === '346' || el[1] === '356') out.coverageStart = start;
        else if (el[1] === '347' || el[1] === '357') out.coverageEnd = end;
        break;
      }
    }
  }

  const active = out.benefits.find((b) => ['1', '2', '3', '4', '5'].includes(b.code));
  const inactive = out.benefits.find((b) => ['6', '7', '8'].includes(b.code));
  out.coverageActive = active ? true : inactive ? false : null;
  out.planName = active?.planName ?? out.benefits.find((b) => b.planName)?.planName ?? null;
  const individual = (b: Benefit) => !b.coverageLevel || b.coverageLevel === 'IND';
  out.copay = out.benefits.find((b) => b.code === 'B' && b.amount !== null && b.inNetwork !== false)?.amount ?? null;
  const coins = out.benefits.find((b) => b.code === 'A' && b.percent !== null && b.inNetwork !== false)?.percent;
  out.coinsurancePercent = coins === undefined || coins === null ? null : Math.round(coins * 10000) / 100;
  const deductibles = out.benefits.filter((b) => b.code === 'C' && b.amount !== null && individual(b) && b.inNetwork !== false);
  out.deductible = deductibles.find((b) => b.period !== '29')?.amount ?? null;
  out.deductibleRemaining = deductibles.find((b) => b.period === '29')?.amount ?? null;
  return out;
}
