/**
 * Virginia Medicaid (DMAS) EVV data on claims (P4-04, DECISIONS D-069). Virginia has no EVV aggregator: the visit's
 * EVV data travels on the claim itself, in fields the DMAS companion guides assign:
 *
 * - **837P, agency-directed personal care / respite / companion (T1019, T1005, S5135)** — SV101-7 begin-end time
 *   `HHMM-HHMM`; 2420D NM1 (supervising provider) = attendant last/first name, REF*LU = attendant ID; 2420G / 2420H
 *   (ambulance pick-up / drop-off) = where the service began / ended.
 * - **837I, home health (facility type 32 or 34), EVV revenue codes** — 2310E service facility NM103 = "HH EVV Service
 *   Location" with the address, REF*LU*99999; SV202-7 begin-end time; 2420D NM1 (referring provider) = attendant name,
 *   REF*G2 = attendant ID.
 *
 * Pure: the service gathers the facts, this decides what goes on the line and what's missing. Problems name the DMAS
 * edit the claim would be denied with (EOB 2094–2100), so billing staff can match them to a remittance.
 */

import { zonedTimeToUtc } from '@alora/shared';

/** Personal care services that need EVV on 837P claims (DMAS EVV FAQ; S9125 is excluded). */
export const VA_EVV_PROCEDURE_CODES: ReadonlySet<string> = new Set(['T1019', 'T1005', 'S5135']);

/** Home health revenue codes that need EVV on 837I claims (DMAS EVV webinar, 2023). */
export const VA_EVV_REVENUE_CODES: ReadonlySet<string> = new Set([
  '0550', '0551', '0559', '0571', '0424', '0421', '0434', '0431', '0444', '0441',
]);

/** Home health facility types (CLM05-1) that trigger the 837I EVV fields. */
export const VA_EVV_FACILITY_TYPES: ReadonlySet<string> = new Set(['32', '34']);

/** The literal DMAS requires in 2310E NM103. Sent as written (mixed case is in the X12 5010 extended set). */
export const VA_HH_EVV_LOCATION_NAME = 'HH EVV Service Location';

/** DMAS explanation-of-benefit edits for EVV. */
export const DMAS_EVV_EDIT = {
  dataMissing: '2094',
  beginAddress: '2095',
  endAddress: '2096',
  attendantName: '2097',
  attendantId: '2098',
  beginTime: '2099',
  endTime: '2100',
} as const;

export interface EvvAddress {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
}

export interface LineEvv {
  /** `HHMM-HHMM` in the agency's time zone, on the line's date of service. */
  times: string;
  attendant: { lastName: string; firstName: string; id: string };
  /** Where the service began and ended (837P 2420G / 2420H; the 837I carries one location per claim). */
  begin: EvvAddress;
  end: EvvAddress;
}

export interface EvvLineFacts {
  format: '837P' | '837I';
  /** The claim line's date of service (YYYY-MM-DD). */
  serviceDate: string;
  /** Agency time zone — EVV times are reported as local clock times. */
  timeZone: string;
  /** The part of the shift this line bills, when a shift crossing midnight was split into one line per day. */
  window?: { start: Date; end: Date } | null;
  /** The visit's EVV record; null when there is none. */
  record: {
    clockIn: Date | null;
    clockOut: Date | null;
    status: string;
    clockInWithinGeofence: boolean | null;
    clockOutWithinGeofence: boolean | null;
  } | null;
  attendant: { lastName: string | null; firstName: string | null; employeeId: string | null } | null;
  /** Where the visit happened — the patient's home address. */
  serviceAddress: { addressLine1: string | null; city: string | null; state: string | null; zip: string | null };
}

/** Does this line need EVV data for Virginia Medicaid? */
export function virginiaEvvRequired(
  format: '837P' | '837I',
  line: { serviceCode: string; revenueCode: string | null },
  typeOfBill?: string | null,
): boolean {
  if (format === '837P') return VA_EVV_PROCEDURE_CODES.has(line.serviceCode.toUpperCase());
  return VA_EVV_FACILITY_TYPES.has((typeOfBill ?? '').slice(1, 3)) && VA_EVV_REVENUE_CODES.has(line.revenueCode ?? '');
}

/** Local date and HHMM of an instant in a time zone. */
export function localDateTime(instant: Date, timeZone: string): { date: string; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}${parts.minute}` };
}

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Splits a shift at local midnight into one piece per calendar day — Virginia bills each day on its own line
 * (the first piece ends at 2400, the next starts at 0000). A shift within one day is one piece.
 */
export function splitAtMidnight(
  start: Date,
  end: Date,
  timeZone: string,
): { date: string; start: Date; end: Date; minutes: number }[] {
  const pieces: { date: string; start: Date; end: Date; minutes: number }[] = [];
  let from = start;
  while (from < end) {
    const date = localDateTime(from, timeZone).date;
    const midnight = zonedTimeToUtc(nextDay(date), '00:00', timeZone);
    const to = midnight > from && midnight < end ? midnight : end;
    pieces.push({ date, start: from, end: to, minutes: Math.round((to.getTime() - from.getTime()) / 60_000) });
    from = to;
  }
  return pieces;
}

/**
 * The EVV fields for one claim line, or the reasons they can't be filled. `problems` are phrased for billing staff
 * and carry the DMAS edit number.
 */
export function virginiaEvvForLine(f: EvvLineFacts): { evv: LineEvv | null; problems: string[] } {
  const problems: string[] = [];
  const edit = (code: string, text: string) => problems.push(`${text} (DMAS edit ${code})`);
  const r = f.record;
  if (!r) {
    edit(DMAS_EVV_EDIT.dataMissing, 'no EVV record for this visit');
    return { evv: null, problems };
  }

  let times: string | null = null;
  const clockIn = f.window?.start ?? r.clockIn;
  const clockOut = f.window?.end ?? r.clockOut;
  if (!clockIn) edit(DMAS_EVV_EDIT.beginTime, 'EVV clock-in time missing');
  if (!clockOut) edit(DMAS_EVV_EDIT.endTime, 'EVV clock-out time missing');
  if (clockIn && clockOut) {
    const start = localDateTime(clockIn, f.timeZone);
    const end = localDateTime(clockOut, f.timeZone);
    let endHhmm: string | null = end.hhmm;
    if (clockOut <= clockIn) {
      edit(DMAS_EVV_EDIT.endTime, 'EVV clock-out is not after clock-in');
      endHhmm = null;
    } else if (start.date !== f.serviceDate) {
      edit(DMAS_EVV_EDIT.beginTime, `EVV clock-in was on ${start.date}, not the line's date ${f.serviceDate}`);
    } else if (end.date !== f.serviceDate) {
      // Ending exactly at midnight still belongs to the day (837I allows 2400; the 837P hours are 00–23).
      if (end.date === nextDay(f.serviceDate) && end.hhmm === '0000') endHhmm = f.format === '837I' ? '2400' : '2359';
      else {
        edit(DMAS_EVV_EDIT.endTime, 'the shift crosses midnight — Virginia needs it billed as one line per day');
        endHhmm = null;
      }
    }
    if (start.date === f.serviceDate && endHhmm) times = `${start.hhmm}-${endHhmm}`;
  }

  const a = f.attendant;
  const lastName = a?.lastName?.trim() ?? '';
  const firstName = a?.firstName?.trim() ?? '';
  const id = a?.employeeId?.trim() ?? '';
  if (!lastName || !firstName) edit(DMAS_EVV_EDIT.attendantName, 'caregiver first or last name missing');
  if (!id) edit(DMAS_EVV_EDIT.attendantId, 'caregiver has no employee ID (Staff → employee ID)');
  else if (!/^[A-Za-z0-9]{1,50}$/.test(id)) edit(DMAS_EVV_EDIT.attendantId, 'caregiver employee ID must be letters and digits only');
  else if (/^\d{9}$/.test(id)) edit(DMAS_EVV_EDIT.attendantId, 'caregiver employee ID looks like an SSN — DMAS forbids SSNs');

  const s = f.serviceAddress;
  const address =
    s.addressLine1?.trim() && s.city?.trim() && s.state?.trim() && s.zip?.trim()
      ? { addressLine1: s.addressLine1.trim(), city: s.city.trim(), state: s.state.trim(), zip: s.zip.trim() }
      : null;
  // The location is the patient's home; a clock-in/out away from it is only accepted once a supervisor verified it.
  const reviewed = r.status === 'verified';
  if (!address) {
    edit(DMAS_EVV_EDIT.beginAddress, "patient's street address, city, state or ZIP missing");
  } else {
    if (r.clockInWithinGeofence === false && !reviewed)
      edit(DMAS_EVV_EDIT.beginAddress, "clock-in was away from the patient's home and hasn't been verified");
    if (r.clockOutWithinGeofence === false && !reviewed)
      edit(DMAS_EVV_EDIT.endAddress, "clock-out was away from the patient's home and hasn't been verified");
  }

  if (problems.length || !times || !address) return { evv: null, problems };
  return { evv: { times, attendant: { lastName, firstName, id }, begin: address, end: address }, problems };
}

/**
 * Virginia 837P: each line is one caregiver's shift, so a second line for the same service on the same day gets
 * modifier 76 (repeat service) to not be denied as a duplicate (DMAS EVV FAQ). Changes the lines in place.
 */
export function addRepeatModifiers(lines: { serviceCode: string; serviceDate: string; modifiers: string[] }[]): void {
  const seen = new Set<string>();
  for (const line of lines) {
    const key = `${line.serviceCode}|${line.serviceDate}`;
    if (seen.has(key) && !line.modifiers.includes('76') && line.modifiers.length < 4) line.modifiers.push('76');
    seen.add(key);
  }
}
