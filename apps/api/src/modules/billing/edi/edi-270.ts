import { COMPONENT, REPETITION, ccyymmdd, clean, digits, pad, segment, zeroPad } from './x12.js';

/** One eligibility question: is this member covered by this payer on this date? (005010X279A1, D-060) */
export interface Edi270Input {
  sender: { id: string };
  receiver: { id: string };
  payer: { name: string; payerId: string };
  provider: { name: string; npi: string; taxId: string | null };
  subscriber: {
    firstName: string;
    lastName: string;
    memberId: string;
    dateOfBirth: string | null;
    gender: string | null;
  };
  serviceDate: string;
  /** Echoed back in the 271 (TRN02) — how the answer is matched to the question. */
  traceNumber: string;
  /** EQ01 service type: 30 = health benefit plan coverage (default); 42 = home health care. */
  serviceTypeCode?: string;
  controlNumber: number;
  createdAt: Date;
  usage: 'P' | 'T';
}

const GENDER: Record<string, string> = { female: 'F', male: 'M' };

export function validate270(input: Edi270Input): string[] {
  const problems: string[] = [];
  if (digits(input.provider.npi).length !== 10) problems.push('Agency NPI must be 10 digits');
  if (!clean(input.sender.id) || !clean(input.receiver.id))
    problems.push('The payer needs a submitter ID and receiver ID (from the clearinghouse)');
  if (!clean(input.payer.payerId)) problems.push('The payer needs its payer ID');
  if (!clean(input.subscriber.memberId)) problems.push("The patient's member ID for this payer is missing");
  if (!clean(input.subscriber.lastName) || !clean(input.subscriber.firstName)) problems.push('Patient name missing');
  if (!input.subscriber.dateOfBirth) problems.push('Patient date of birth missing');
  if (!/^[A-Z0-9]{1,50}$/.test(input.traceNumber)) problems.push('Trace number must be 1–50 letters or digits');
  if (input.controlNumber < 1 || input.controlNumber > 999_999_999) problems.push('Control number out of range');
  return problems;
}

/** Builds a single-subscriber 270 request. Call `validate270` first; this throws if the input isn't valid. */
export function build270(input: Edi270Input): string {
  const problems = validate270(input);
  if (problems.length) throw new Error(`270 input is not valid: ${problems.join('; ')}`);
  const iso = input.createdAt.toISOString();
  const date8 = ccyymmdd(iso);
  const time4 = iso.slice(11, 16).replace(':', '');
  const icn = zeroPad(input.controlNumber, 9);
  const s = input.subscriber;
  // TRN03: "1" + a 9-digit originator ID; the EIN is the usual choice, else the NPI's last 9 digits.
  const originator = `1${(digits(input.provider.taxId) || digits(input.provider.npi)).slice(-9).padStart(9, '0')}`;

  const st = [
    segment('ST', '270', '0001', '005010X279A1'),
    segment('BHT', '0022', '13', input.traceNumber, date8, time4),
    segment('HL', '1', '', '20', '1'),
    segment('NM1', 'PR', '2', clean(input.payer.name, 60), '', '', '', '', 'PI', clean(input.payer.payerId, 80)),
    segment('HL', '2', '1', '21', '1'),
    segment('NM1', '1P', '2', clean(input.provider.name, 60), '', '', '', '', 'XX', digits(input.provider.npi)),
    segment('HL', '3', '2', '22', '0'),
    segment('TRN', '1', input.traceNumber, originator),
    segment('NM1', 'IL', '1', clean(s.lastName, 60), clean(s.firstName, 35), '', '', '', 'MI', clean(s.memberId, 80)),
    segment('DMG', 'D8', ccyymmdd(s.dateOfBirth!), GENDER[s.gender ?? ''] ?? ''),
    segment('DTP', '291', 'D8', ccyymmdd(input.serviceDate)),
    segment('EQ', input.serviceTypeCode ?? '30'),
  ];
  st.push(segment('SE', st.length + 1, '0001'));

  return [
    segment('ISA', '00', pad('', 10), '00', pad('', 10), 'ZZ', pad(input.sender.id, 15), 'ZZ', pad(input.receiver.id, 15),
      date8.slice(2), time4, REPETITION, '00501', icn, '0', input.usage, COMPONENT),
    segment('GS', 'HS', clean(input.sender.id), clean(input.receiver.id), date8, time4, String(input.controlNumber), 'X', '005010X279A1'),
    ...st,
    segment('GE', '1', String(input.controlNumber)),
    segment('IEA', '1', icn),
  ].join('\n') + '\n';
}
