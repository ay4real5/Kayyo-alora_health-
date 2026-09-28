import type { Edi837Party, Edi837Provider } from './edi-837p.js';
import { VA_HH_EVV_LOCATION_NAME, type EvvAddress, type LineEvv } from './evv-virginia.js';
import { amount, ccyymmdd, clean, composite, digits, pad, segment, zeroPad, COMPONENT, REPETITION } from './x12.js';

/**
 * EDI 837 Institutional (ASC X12 005010X223A2) for home health claims (DECISIONS D-061) — the electronic UB-04. Pure,
 * like the 837P: everything comes in `Edi837IInput`, and `validate837I` lists what's missing first.
 */

export interface Edi837ILine {
  /** UB-04 revenue code, e.g. 0571 home health aide, 0551 skilled nursing, 0421 physical therapy. */
  revenueCode: string;
  serviceCode: string | null;
  modifiers: string[];
  serviceDate: string;
  units: number;
  chargeAmount: number;
  /** Virginia Medicaid home health EVV (D-069): SV202-7 times and the 2420D attendant. The location is per claim. */
  evv?: Pick<LineEvv, 'times' | 'attendant'> | null;
}

export interface Edi837IClaim {
  claimNumber: string;
  /** Type of bill, 4 characters, e.g. 0329 (home health, final claim). Facility 32 + frequency from the last digit. */
  typeOfBill: string;
  totalCharges: number;
  statementFrom: string;
  statementTo: string;
  admissionDate: string | null;
  /** UB-04 patient status: 30 still a patient, 01 discharged home, … */
  patientStatus: string;
  diagnosisCodes: string[];
  priorAuthorization: string | null;
  /** The payer's claim number of the claim being corrected or voided (frequency 7/8) — REF*F8. */
  originalReference?: string | null;
  medicalRecordNumber: string | null;
  /** Medicare home health (PDGM): the HIPPS code from the grouper, billed on a 0023 line. */
  hippsCode: string | null;
  /** Value codes, e.g. { code: '61', amount: 40060 } — Medicare HH needs 61 (CBSA where care was given). */
  valueCodes: { code: string; amount: number }[];
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
  attending: { lastName: string; firstName: string; npi: string } | null;
  /** Virginia Medicaid home health EVV: where the visits happened (2310E). Required when any line has `evv`. */
  evvServiceLocation?: EvvAddress | null;
  lines: Edi837ILine[];
}

export interface Edi837IInput {
  sender: Edi837Party;
  receiver: Edi837Party;
  payer: { name: string; payerId: string; payerType: string };
  provider: Edi837Provider;
  claims: Edi837IClaim[];
  controlNumber: number;
  createdAt: Date;
  usage: 'P' | 'T';
}

const FILING_INDICATOR: Record<string, string> = {
  medicaid: 'MC',
  medicaid_mco: 'MC',
  medicare: 'MA', // Medicare Part A (home health)
  commercial: 'CI',
  va: 'VA',
  other: 'ZZ',
};
const GENDER: Record<string, string> = { female: 'F', male: 'M' };

export function validate837I(input: Edi837IInput): string[] {
  const problems: string[] = [];
  const p = input.provider;
  if (digits(p.npi).length !== 10) problems.push('Agency NPI must be 10 digits');
  if (digits(p.taxId).length !== 9) problems.push('Agency tax ID (EIN) must be 9 digits');
  if (!clean(p.addressLine1) || !clean(p.city) || clean(p.state).length !== 2)
    problems.push('Agency street address, city and state are required');
  if (digits(p.zip).length !== 9) problems.push('Agency ZIP must be ZIP+4 (9 digits) for electronic claims');
  if (!clean(input.sender.id) || !clean(input.receiver.id))
    problems.push('The payer needs a submitter ID and receiver ID (from the clearinghouse)');
  if (!clean(input.payer.payerId)) problems.push('The payer needs its payer ID');
  if (!FILING_INDICATOR[input.payer.payerType])
    problems.push(`${input.payer.payerType} payers are not billed electronically`);
  for (const c of input.claims) {
    const who = `Claim ${c.claimNumber}`;
    if (!/^0\d{2}[0-9A-Z]$/.test(c.typeOfBill)) problems.push(`${who}: type of bill must look like 0329`);
    if (!clean(c.patient.memberId)) problems.push(`${who}: patient member ID missing`);
    if (!c.patient.dateOfBirth) problems.push(`${who}: patient date of birth missing`);
    if (!c.patient.addressLine1 || !c.patient.city || !c.patient.state || !c.patient.zip)
      problems.push(`${who}: patient address missing (required on institutional claims)`);
    if (!c.attending || digits(c.attending.npi).length !== 10)
      problems.push(`${who}: attending physician with an NPI is required (the patient's physician)`);
    if (!c.diagnosisCodes.length) problems.push(`${who}: no diagnosis codes`);
    if (c.diagnosisCodes.length > 25) problems.push(`${who}: more than 25 diagnoses`);
    if (!c.lines.length) problems.push(`${who}: no lines`);
    if (/[78]$/.test(c.typeOfBill) && !clean(c.originalReference))
      problems.push(`${who}: a corrected claim needs the payer's claim number of the original`);
    if (c.lines.length > 999) problems.push(`${who}: more than 999 lines`);
    if (c.lines.some((l) => l.evv) && !c.evvServiceLocation)
      problems.push(`${who}: EVV lines need the service location (patient address)`);
    for (const l of c.lines) {
      if (l.evv && !/^([01]\d|2[0-4])[0-5]\d-([01]\d|2[0-4])[0-5]\d$/.test(l.evv.times))
        problems.push(`${who}: ${l.serviceCode ?? l.revenueCode} on ${l.serviceDate}: EVV times must be HHMM-HHMM`);
      if (!/^\d{4}$/.test(l.revenueCode))
        problems.push(`${who}: ${l.serviceCode ?? 'a line'} has no 4-digit revenue code (set it on the service code)`);
    }
    if (input.payer.payerType === 'medicare') {
      if (!c.hippsCode || !/^[0-9A-Z]{5}$/.test(c.hippsCode))
        problems.push(`${who}: Medicare home health claims need the 5-character HIPPS code`);
      if (!c.valueCodes.some((v) => v.code === '61'))
        problems.push(`${who}: Medicare home health claims need value code 61 (CBSA code)`);
    }
  }
  if (input.controlNumber < 1 || input.controlNumber > 999_999_999) problems.push('Control number out of range');
  return problems;
}

export function build837I(input: Edi837IInput): string {
  const problems = validate837I(input);
  if (problems.length) throw new Error(`837I input is not valid: ${problems.join('; ')}`);
  const iso = input.createdAt.toISOString();
  const date8 = ccyymmdd(iso);
  const time4 = iso.slice(11, 16).replace(':', '');
  const icn = zeroPad(input.controlNumber, 9);
  const group = String(input.controlNumber);
  const prov = input.provider;

  const st: string[] = [
    segment('ST', '837', '0001', '005010X223A2'),
    segment('BHT', '0019', '00', icn, date8, time4, 'CH'),
    segment('NM1', '41', '2', clean(prov.name, 60), '', '', '', '', '46', clean(input.sender.id)),
    segment('PER', 'IC', clean(prov.contactName, 60), 'TE', digits(prov.phone)),
    segment('NM1', '40', '2', clean(input.receiver.name, 60), '', '', '', '', '46', clean(input.receiver.id)),
    // 2000A billing provider
    segment('HL', '1', '', '20', '1'),
    segment('NM1', '85', '2', clean(prov.name, 60), '', '', '', '', 'XX', digits(prov.npi)),
    segment('N3', clean(prov.addressLine1, 55)),
    segment('N4', clean(prov.city, 30), clean(prov.state), digits(prov.zip)),
    segment('REF', 'EI', digits(prov.taxId)),
  ];

  let hl = 1;
  for (const c of input.claims) {
    hl += 1;
    const p = c.patient;
    // 2000B subscriber = the patient (Medicare/Medicaid), so no 2000C.
    st.push(segment('HL', hl, '1', '22', '0'));
    st.push(segment('SBR', 'P', '18', '', '', '', '', '', '', FILING_INDICATOR[input.payer.payerType]));
    st.push(segment('NM1', 'IL', '1', clean(p.lastName, 60), clean(p.firstName, 35), '', '', '', 'MI', clean(p.memberId, 80)));
    st.push(segment('N3', clean(p.addressLine1, 55)));
    st.push(segment('N4', clean(p.city, 30), clean(p.state), digits(p.zip)));
    st.push(segment('DMG', 'D8', ccyymmdd(p.dateOfBirth), GENDER[p.gender ?? ''] ?? 'U'));
    st.push(segment('NM1', 'PR', '2', clean(input.payer.name, 60), '', '', '', '', 'PI', clean(input.payer.payerId, 80)));

    // 2300 claim: CLM05 = facility type (TOB digits 2–3) : A (UB-04 bill type) : frequency (TOB digit 4).
    st.push(
      segment('CLM', clean(c.claimNumber, 38), amount(c.totalCharges), '', '', composite(c.typeOfBill.slice(1, 3), 'A', c.typeOfBill.slice(3)), '', 'A', 'Y', 'Y'),
    );
    st.push(segment('DTP', '434', 'RD8', `${ccyymmdd(c.statementFrom)}-${ccyymmdd(c.statementTo)}`));
    if (c.admissionDate) st.push(segment('DTP', '435', 'D8', ccyymmdd(c.admissionDate)));
    // CL1: admission type 9 (information not available — usual for home health), source 1, patient status.
    st.push(segment('CL1', '9', '1', c.patientStatus));
    if (c.priorAuthorization) st.push(segment('REF', 'G1', clean(c.priorAuthorization, 50)));
    if (c.originalReference) st.push(segment('REF', 'F8', clean(c.originalReference, 50)));
    if (c.medicalRecordNumber) st.push(segment('REF', 'EA', clean(c.medicalRecordNumber, 50)));
    const [principal, ...others] = c.diagnosisCodes.map((d) => d.replace('.', '').toUpperCase());
    st.push(segment('HI', composite('ABK', principal!)));
    if (others.length) {
      for (let i = 0; i < others.length; i += 12) {
        st.push(segment('HI', ...others.slice(i, i + 12).map((d) => composite('ABF', d))));
      }
    }
    if (c.valueCodes.length) {
      st.push(segment('HI', ...c.valueCodes.slice(0, 12).map((v) => composite('BE', v.code, '', '', amount(v.amount)))));
    }
    // 2310A attending provider
    st.push(segment('NM1', '71', '1', clean(c.attending!.lastName, 60), clean(c.attending!.firstName, 35), '', '', '', 'XX', digits(c.attending!.npi)));
    // 2310E service facility = the Virginia HH EVV service location (DMAS literal name, REF*LU*99999).
    if (c.evvServiceLocation) {
      const loc = c.evvServiceLocation;
      st.push(segment('NM1', '77', '2', VA_HH_EVV_LOCATION_NAME));
      st.push(segment('N3', clean(loc.addressLine1, 55)));
      st.push(segment('N4', clean(loc.city, 30), clean(loc.state), digits(loc.zip)));
      st.push(segment('REF', 'LU', '99999'));
    }

    // 2400 service lines; Medicare HH puts the HIPPS code first on revenue code 0023 with a zero charge.
    const lines = [
      ...(c.hippsCode
        ? [{ revenueCode: '0023', serviceCode: null, hipps: c.hippsCode, modifiers: [], serviceDate: c.statementFrom, units: 1, chargeAmount: 0, evv: null }]
        : []),
      ...c.lines.map((l) => ({ ...l, hipps: null as string | null, evv: l.evv ?? null })),
    ];
    lines.forEach((l, i) => {
      st.push(segment('LX', i + 1));
      const procedure = l.hipps
        ? composite('HP', l.hipps)
        : l.serviceCode
          ? l.evv
            ? // SV202-7 (description) carries the EVV begin-end time, after the four modifier slots.
              composite('HC', clean(l.serviceCode), ...[...l.modifiers.map((m) => clean(m, 2)), '', '', '', ''].slice(0, 4), l.evv.times)
            : composite('HC', clean(l.serviceCode), ...l.modifiers.map((m) => clean(m, 2)))
          : '';
      st.push(segment('SV2', l.revenueCode, procedure, amount(l.chargeAmount), 'UN', amount(l.units)));
      st.push(segment('DTP', '472', 'D8', ccyymmdd(l.serviceDate)));
      if (l.evv) {
        // 2420D referring provider = the HH attendant (DMAS), REF*G2 = attendant ID.
        st.push(segment('NM1', 'DN', '1', clean(l.evv.attendant.lastName, 60), clean(l.evv.attendant.firstName, 35)));
        st.push(segment('REF', 'G2', clean(l.evv.attendant.id, 50)));
      }
    });
  }
  st.push(segment('SE', st.length + 1, '0001'));

  return [
    segment('ISA', '00', pad('', 10), '00', pad('', 10), 'ZZ', pad(input.sender.id, 15), 'ZZ', pad(input.receiver.id, 15),
      date8.slice(2), time4, REPETITION, '00501', icn, '0', input.usage, COMPONENT),
    segment('GS', 'HC', clean(input.sender.id), clean(input.receiver.id), date8, time4, group, 'X', '005010X223A2'),
    ...st,
    segment('GE', '1', group),
    segment('IEA', '1', icn),
  ].join('\n') + '\n';
}
