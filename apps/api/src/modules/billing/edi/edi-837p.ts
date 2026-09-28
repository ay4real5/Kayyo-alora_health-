import {
  amount,
  ccyymmdd,
  clean,
  composite,
  digits,
  pad,
  segment,
  zeroPad,
  COMPONENT,
  REPETITION,
} from './x12.js';

/**
 * EDI 837 Professional (ASC X12 005010X222A1) for one or more claims to one payer (DECISIONS D-053). Pure: everything
 * comes in `Edi837Input`; `validate837` lists what's missing before a file can be made.
 */

export interface Edi837Party {
  name: string;
  /** Interchange/submitter ID agreed with the clearinghouse. */
  id: string;
}

export interface Edi837Provider {
  name: string;
  npi: string;
  taxId: string;
  addressLine1: string;
  city: string;
  state: string;
  /** 9 digits required for the billing provider (ZIP+4). */
  zip: string;
  contactName: string;
  phone: string;
}

export interface Edi837Line {
  serviceCode: string;
  modifiers: string[];
  serviceDate: string;
  units: number;
  chargeAmount: number;
}

export interface Edi837Claim {
  claimNumber: string;
  frequencyCode: string;
  totalCharges: number;
  diagnosisCodes: string[];
  priorAuthorization: string | null;
  /** The payer's claim number of the claim being corrected or voided (frequency 7/8) — REF*F8. */
  originalReference?: string | null;
  patient: {
    lastName: string;
    firstName: string;
    memberId: string;
    dateOfBirth: string;
    gender: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  lines: Edi837Line[];
}

export interface Edi837Input {
  sender: Edi837Party;
  receiver: Edi837Party;
  payer: { name: string; payerId: string; payerType: string };
  provider: Edi837Provider;
  claims: Edi837Claim[];
  /** Interchange control number (ISA13/IEA02), 1–999999999. */
  controlNumber: number;
  /** When the file is made (fixed in tests). */
  createdAt: Date;
  /** P = production, T = test (ISA15). */
  usage: 'P' | 'T';
}

/** Claim filing indicator (SBR09) by payer type. */
const FILING_INDICATOR: Record<string, string> = {
  medicaid: 'MC',
  medicaid_mco: 'MC',
  medicare: 'MB',
  commercial: 'CI',
  va: 'VA',
  other: 'ZZ',
};

const GENDER: Record<string, string> = { female: 'F', male: 'M' };

/** Everything the payer will reject if missing — checked before building. Empty list = OK. */
export function validate837(input: Edi837Input): string[] {
  const problems: string[] = [];
  const p = input.provider;
  if (digits(p.npi).length !== 10) problems.push('Agency NPI must be 10 digits');
  if (digits(p.taxId).length !== 9) problems.push('Agency tax ID (EIN) must be 9 digits');
  if (!clean(p.addressLine1) || !clean(p.city) || clean(p.state).length !== 2)
    problems.push('Agency street address, city and state are required');
  if (digits(p.zip).length !== 9)
    problems.push('Agency ZIP must be ZIP+4 (9 digits) for electronic claims');
  if (!clean(input.sender.id) || !clean(input.receiver.id))
    problems.push('The payer needs a submitter ID and receiver ID (from the clearinghouse)');
  if (!clean(input.payer.payerId)) problems.push('The payer needs its payer ID');
  if (!FILING_INDICATOR[input.payer.payerType])
    problems.push(`${input.payer.payerType} payers are not billed electronically`);
  for (const c of input.claims) {
    const who = `Claim ${c.claimNumber}`;
    if (!clean(c.patient.memberId)) problems.push(`${who}: patient member ID missing`);
    if (!c.patient.dateOfBirth) problems.push(`${who}: patient date of birth missing`);
    if (!c.diagnosisCodes.length) problems.push(`${who}: no diagnosis codes`);
    if (!c.lines.length) problems.push(`${who}: no lines`);
    if ((c.frequencyCode === '7' || c.frequencyCode === '8') && !clean(c.originalReference))
      problems.push(`${who}: a corrected claim needs the payer's claim number of the original`);
    if (c.lines.length > 50) problems.push(`${who}: more than 50 lines (837P limit)`);
    if (c.diagnosisCodes.length > 12) problems.push(`${who}: more than 12 diagnoses`);
  }
  if (input.controlNumber < 1 || input.controlNumber > 999_999_999)
    problems.push('Control number out of range');
  return problems;
}

/** Builds the 837P text. Call `validate837` first; this throws if the input isn't valid. */
export function build837(input: Edi837Input): string {
  const problems = validate837(input);
  if (problems.length) throw new Error(`837P input is not valid: ${problems.join('; ')}`);

  const iso = input.createdAt.toISOString();
  const date8 = ccyymmdd(iso);
  const time4 = iso.slice(11, 16).replace(':', '');
  const icn = zeroPad(input.controlNumber, 9);
  const groupControl = String(input.controlNumber);
  const out: string[] = [];

  out.push(
    segment(
      'ISA',
      '00',
      pad('', 10),
      '00',
      pad('', 10),
      'ZZ',
      pad(input.sender.id, 15),
      'ZZ',
      pad(input.receiver.id, 15),
      date8.slice(2),
      time4,
      REPETITION,
      '00501',
      icn,
      '0',
      input.usage,
      COMPONENT,
    ),
  );
  out.push(
    segment(
      'GS',
      'HC',
      clean(input.sender.id),
      clean(input.receiver.id),
      date8,
      time4,
      groupControl,
      'X',
      '005010X222A1',
    ),
  );

  // One transaction set per file (all claims to one payer).
  const st: string[] = [];
  st.push(segment('ST', '837', '0001', '005010X222A1'));
  st.push(segment('BHT', '0019', '00', icn, date8, time4, 'CH'));
  // 1000A submitter, 1000B receiver
  st.push(
    segment(
      'NM1',
      '41',
      '2',
      clean(input.provider.name, 60),
      '',
      '',
      '',
      '',
      '46',
      clean(input.sender.id),
    ),
  );
  st.push(
    segment('PER', 'IC', clean(input.provider.contactName, 60), 'TE', digits(input.provider.phone)),
  );
  st.push(
    segment(
      'NM1',
      '40',
      '2',
      clean(input.receiver.name, 60),
      '',
      '',
      '',
      '',
      '46',
      clean(input.receiver.id),
    ),
  );

  // 2000A billing provider
  let hl = 1;
  const billingHl = hl;
  st.push(segment('HL', billingHl, '', '20', '1'));
  st.push(
    segment(
      'NM1',
      '85',
      '2',
      clean(input.provider.name, 60),
      '',
      '',
      '',
      '',
      'XX',
      digits(input.provider.npi),
    ),
  );
  st.push(segment('N3', clean(input.provider.addressLine1, 55)));
  st.push(
    segment(
      'N4',
      clean(input.provider.city, 30),
      clean(input.provider.state),
      digits(input.provider.zip),
    ),
  );
  st.push(segment('REF', 'EI', digits(input.provider.taxId)));

  for (const claim of input.claims) {
    hl += 1;
    const p = claim.patient;
    // 2000B subscriber — the patient is the subscriber (Medicaid/Medicare), so no 2000C.
    st.push(segment('HL', hl, billingHl, '22', '0'));
    st.push(
      segment('SBR', 'P', '18', '', '', '', '', '', '', FILING_INDICATOR[input.payer.payerType]),
    );
    st.push(
      segment(
        'NM1',
        'IL',
        '1',
        clean(p.lastName, 60),
        clean(p.firstName, 35),
        '',
        '',
        '',
        'MI',
        clean(p.memberId, 80),
      ),
    );
    if (p.addressLine1 && p.city && p.state && p.zip) {
      st.push(segment('N3', clean(p.addressLine1, 55)));
      st.push(segment('N4', clean(p.city, 30), clean(p.state), digits(p.zip)));
    }
    st.push(segment('DMG', 'D8', ccyymmdd(p.dateOfBirth), GENDER[p.gender ?? ''] ?? 'U'));
    st.push(
      segment(
        'NM1',
        'PR',
        '2',
        clean(input.payer.name, 60),
        '',
        '',
        '',
        '',
        'PI',
        clean(input.payer.payerId, 80),
      ),
    );

    // 2300 claim — place of service 12 (home), facility qualifier B, frequency code.
    st.push(
      segment(
        'CLM',
        clean(claim.claimNumber, 38),
        amount(claim.totalCharges),
        '',
        '',
        composite('12', 'B', claim.frequencyCode),
        'Y',
        'A',
        'Y',
        'Y',
      ),
    );
    if (claim.priorAuthorization)
      st.push(segment('REF', 'G1', clean(claim.priorAuthorization, 50)));
    if (claim.originalReference) st.push(segment('REF', 'F8', clean(claim.originalReference, 50)));
    st.push(
      segment(
        'HI',
        ...claim.diagnosisCodes.map((code, i) =>
          composite(i === 0 ? 'ABK' : 'ABF', code.replace('.', '').toUpperCase()),
        ),
      ),
    );

    // 2400 service lines
    claim.lines.forEach((line, i) => {
      st.push(segment('LX', i + 1));
      st.push(
        segment(
          'SV1',
          composite('HC', clean(line.serviceCode), ...line.modifiers.map((m) => clean(m, 2))),
          amount(line.chargeAmount),
          'UN',
          amount(line.units),
          '',
          '',
          '1',
        ),
      );
      st.push(segment('DTP', '472', 'D8', ccyymmdd(line.serviceDate)));
    });
  }
  st.push(segment('SE', st.length + 1, '0001'));

  out.push(...st);
  out.push(segment('GE', '1', groupControl));
  out.push(segment('IEA', '1', icn));
  return out.join('\n') + '\n';
}
