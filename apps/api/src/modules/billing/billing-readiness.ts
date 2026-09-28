/**
 * Pre-billing QA rules (DESIGN.md §10.1, DECISIONS D-051) as a pure function: everything a visit needs before it can
 * go on a claim. The service gathers the facts; this decides. Claims (P3-03) reuse it.
 */

export type CheckCode =
  | 'visit_completed'
  | 'not_billed'
  | 'evv_verified'
  | 'note_finalised'
  | 'service_code'
  | 'payer'
  | 'member_id'
  | 'diagnosis'
  | 'authorization'
  | 'rate'
  | 'agency_npi'
  | 'timely_filing'
  | 'evv_claim_data';

export interface Check {
  code: CheckCode;
  ok: boolean;
  /** error = can't bill; warning = can bill, but look. */
  severity: 'error' | 'warning';
  message: string;
}

export interface ReadinessFacts {
  visitStatus: string;
  /** Claim number of an active claim this visit is already on, if any. */
  alreadyBilledOn?: string | null;
  serviceDate: string;
  /** Minutes actually worked (EVV) — or scheduled when unknown. */
  minutes: number;
  evvStatus: string | null;
  hasFinalNote: boolean;
  serviceCode: {
    code: string;
    unitType: string;
    defaultRate: number | null;
    requiresAuth: boolean;
  } | null;
  visitServiceCode: string | null;
  payer: {
    payerType: string;
    requiresAuthorization: boolean;
    timelyFilingDays: number;
    isActive: boolean;
  } | null;
  memberIds: {
    medicaidId: string | null;
    medicareBeneficiaryId: string | null;
    insuranceMemberId: string | null;
  };
  hasPrimaryDiagnosis: boolean;
  authorization: { state: string; coversDate: boolean; overLimit: boolean } | null;
  payerRate: number | null;
  agencyNpi: string | null;
  today: string;
  /** State EVV data the claim line(s) would need and lack (Virginia, D-069); null when the payer needs none. */
  evvClaimProblems?: string[] | null;
}

export interface Readiness {
  ready: boolean;
  units: number | null;
  rate: number | null;
  amount: number | null;
  checks: Check[];
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/**
 * Billing units for time worked. 15-minute units round to the nearest unit (8+ minutes count as a unit, the usual
 * Medicaid/Medicare convention — confirm against the Virginia DMAS manual, D-051); hours round to the nearest quarter
 * hour; visits and days are 1.
 */
export function billingUnits(unitType: string, minutes: number): number {
  switch (unitType) {
    case 'unit_15min':
      return Math.floor((minutes + 7) / 15);
    case 'hour':
      return Math.round(minutes / 15) / 4;
    default:
      return 1;
  }
}

/** The payer's claim format, or by default 837I (UB-04) for Medicare home health and 837P for everyone else (D-061). */
export function claimFormatFor(payer: { payerType: string; claimFormat: string | null }): '837P' | '837I' {
  if (payer.claimFormat === '837I' || payer.claimFormat === '837P') return payer.claimFormat;
  return payer.payerType === 'medicare' ? '837I' : '837P';
}

export function memberIdFor(payerType: string, ids: ReadinessFacts['memberIds']): string | null {
  if (payerType === 'medicaid' || payerType === 'medicaid_mco')
    return ids.medicaidId ?? ids.insuranceMemberId;
  if (payerType === 'medicare') return ids.medicareBeneficiaryId;
  if (payerType === 'private_pay') return 'n/a';
  return ids.insuranceMemberId;
}

export function evaluate(f: ReadinessFacts): Readiness {
  const checks: Check[] = [];
  const check = (
    code: CheckCode,
    ok: boolean,
    message: string,
    severity: Check['severity'] = 'error',
  ) => checks.push({ code, ok, severity, message: ok ? 'OK' : message });

  check(
    'visit_completed',
    f.visitStatus === 'completed',
    `The visit is ${f.visitStatus.replace('_', ' ')}`,
  );
  if (f.alreadyBilledOn) check('not_billed', false, `Already billed on ${f.alreadyBilledOn}`);
  check(
    'evv_verified',
    f.evvStatus === 'verified',
    f.evvStatus === null
      ? 'No EVV record (the caregiver never clocked in)'
      : f.evvStatus === 'rejected'
        ? 'EVV was rejected — this visit cannot be billed'
        : 'EVV needs a supervisor to verify it',
  );
  check('note_finalised', f.hasFinalNote, 'No signed or submitted visit note');
  check(
    'service_code',
    Boolean(f.serviceCode),
    f.visitServiceCode
      ? `${f.visitServiceCode} is not an active service code`
      : 'The visit has no service code',
  );
  check(
    'payer',
    Boolean(f.payer?.isActive),
    f.payer ? "The patient's payer is inactive" : 'The patient has no primary payer',
  );
  if (f.payer) {
    check(
      'member_id',
      Boolean(memberIdFor(f.payer.payerType, f.memberIds)),
      "The patient's member ID for this payer is missing",
    );
  }
  check('diagnosis', f.hasPrimaryDiagnosis, 'The patient has no primary diagnosis');

  const authNeeded = Boolean(f.payer?.requiresAuthorization || f.serviceCode?.requiresAuth);
  if (authNeeded || f.authorization) {
    const a = f.authorization;
    check(
      'authorization',
      Boolean(a && a.coversDate && a.state !== 'cancelled' && !a.overLimit),
      !a
        ? 'No authorization covers this visit'
        : a.state === 'cancelled'
          ? 'The authorization was cancelled'
          : !a.coversDate
            ? 'The authorization does not cover the service date'
            : 'The visit goes beyond the authorized visits or hours',
    );
  }

  const rate = f.payerRate ?? f.serviceCode?.defaultRate ?? null;
  check('rate', rate !== null, 'No rate for this payer and service code on this date');
  if (f.payerRate === null && rate !== null) {
    checks.push({
      code: 'rate',
      ok: true,
      severity: 'warning',
      message: "Using the service code's default rate — no payer rate set",
    });
  }
  check('agency_npi', Boolean(f.agencyNpi), 'The agency NPI is missing (Settings)');
  if (f.evvClaimProblems) {
    check('evv_claim_data', f.evvClaimProblems.length === 0, `EVV data for the claim: ${f.evvClaimProblems.join('; ')}`);
  }

  if (f.payer) {
    const deadline = f.payer.timelyFilingDays - daysBetween(f.serviceDate, f.today);
    if (deadline < 0)
      check(
        'timely_filing',
        false,
        `Past the payer's ${f.payer.timelyFilingDays}-day filing limit`,
      );
    else if (deadline <= 30)
      check('timely_filing', false, `Only ${deadline} days left to file`, 'warning');
    else check('timely_filing', true, '');
  }

  const units = f.serviceCode ? billingUnits(f.serviceCode.unitType, f.minutes) : null;
  const amount = units !== null && rate !== null ? Math.round(units * rate * 100) / 100 : null;
  return {
    ready: checks.every((c) => c.ok || c.severity === 'warning'),
    units,
    rate,
    amount,
    checks,
  };
}
