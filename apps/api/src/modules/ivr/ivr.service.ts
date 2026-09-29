import { HttpException, Injectable, Logger } from '@nestjs/common';
import { todayInTimeZone } from '@alora/shared';
import { toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EvvService } from '../evv/evv.service.js';
import { twiml } from './twilio.js';

/** How many times a caller may key a wrong code before the call ends. */
const MAX_CODE_TRIES = 3;
const GOODBYE = 'Goodbye.';

export const IVR_PATHS = {
  incoming: '/api/v1/ivr/voice',
  code: '/api/v1/ivr/voice/code',
  action: '/api/v1/ivr/voice/action',
} as const;

/** The 10 US digits of a caller ID / stored phone number, or null. */
export function usDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

/**
 * Telephony EVV (DESIGN §6.6, D-073): a caregiver calls the agency's check-in number **from the patient's home
 * phone**, keys their check-in code, then 1 to clock in or 2 to clock out. The caller ID must match an active
 * patient's registered home phone — that stands in for GPS (Virginia accepts the member's landline). Nothing the
 * system says names the patient.
 */
@Injectable()
export class IvrService {
  private readonly logger = new Logger(IvrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
    private readonly evv: EvvService,
    private readonly audit: AuditService,
  ) {}

  /** Step 1: the call comes in. */
  async incoming(from: string): Promise<string> {
    const homes = await this.patientsAt(from);
    if (!homes.length) {
      return twiml(
        { say: "This phone number isn't registered for visit check-in. Please call from your client's home phone, or call your office." },
        'hangup',
      );
    }
    return twiml(this.askForCode(1), { say: "We didn't get a code. " + GOODBYE }, 'hangup');
  }

  /** Step 2: the caregiver keyed their code. */
  async code(from: string, digits: string, tries: number): Promise<string> {
    const retry = (message: string) =>
      tries < MAX_CODE_TRIES
        ? twiml({ say: message }, this.askForCode(tries + 1), { say: GOODBYE }, 'hangup')
        : twiml({ say: `${message} Please call your office. ${GOODBYE}` }, 'hangup');
    const homes = await this.patientsAt(from);
    if (!homes.length || !/^\d{4,8}$/.test(digits)) return retry("Sorry, that code didn't work.");
    const agencyIds = [...new Set(homes.map((h) => h.agencyId))];
    const staff = await this.prisma.staffProfile.findFirst({
      where: { agencyId: { in: agencyIds }, ivrCode: digits, isActive: true, user: { isActive: true } },
      select: { id: true, agencyId: true },
    });
    if (!staff) return retry("Sorry, that code didn't work.");
    const visit = await this.todaysVisit(staff, homes.filter((h) => h.agencyId === staff.agencyId).map((h) => h.id));
    if (!visit) return retry("We couldn't find a visit for you at this home today.");
    const action = `${IVR_PATHS.action}?visit=${visit.id}&staff=${staff.id}`;
    const prompt =
      visit.status === 'in_progress' ? 'You are clocked in. To clock out now, press 2.' : 'To clock in now, press 1.';
    return twiml({ gather: { action, numDigits: 1, prompt } }, { say: "We didn't get a choice. " + GOODBYE }, 'hangup');
  }

  /** Step 3: 1 = clock in, 2 = clock out. */
  async action(from: string, digit: string, visitId: string, staffId: string): Promise<string> {
    const staff = await this.prisma.staffProfile.findUnique({ where: { id: staffId }, select: { userId: true, agencyId: true } });
    const phone = usDigits(from);
    if (!staff || !phone || (digit !== '1' && digit !== '2')) return twiml({ say: `Nothing was recorded. ${GOODBYE}` }, 'hangup');
    const caller = { userId: staff.userId, agencyId: staff.agencyId };
    const e164 = `+1${phone}`;
    try {
      const result =
        digit === '1'
          ? await this.evv.clockInByPhone(caller, visitId, e164)
          : await this.evv.clockOutByPhone(caller, visitId, e164);
      await this.audit.record({
        agencyId: staff.agencyId,
        userId: staff.userId,
        action: digit === '1' ? 'EVV_CLOCK_IN_BY_PHONE' : 'EVV_CLOCK_OUT_BY_PHONE',
        resourceType: 'evv_record',
        resourceId: result.id,
      });
      const at = digit === '1' ? result.clockInTime : result.clockOutTime;
      const time = at ? await this.spokenTime(staff.agencyId, at) : 'now';
      return twiml({ say: `You are clocked ${digit === '1' ? 'in' : 'out'} at ${time}. ${GOODBYE}` }, 'hangup');
    } catch (error) {
      // EVV's refusals are short and PHI-free ("This visit isn't scheduled around this time"); read them out.
      if (error instanceof HttpException) return twiml({ say: `${error.message}. ${GOODBYE}` }, 'hangup');
      this.logger.error('IVR clock action failed', (error as Error).stack);
      return twiml({ say: `Something went wrong. Nothing was recorded; please call your office. ${GOODBYE}` }, 'hangup');
    }
  }

  private askForCode(tries: number) {
    return {
      gather: {
        action: `${IVR_PATHS.code}?tries=${tries}`,
        finishOnKey: '#',
        timeout: 10,
        prompt:
          tries === 1
            ? 'Welcome to Kayo Health visit check-in. Enter your check-in code, then press pound.'
            : 'Please enter your check-in code again, then press pound.',
      },
    };
  }

  /** Active patients whose home phone is the caller ID (in any agency using this number). */
  private async patientsAt(from: string): Promise<{ id: string; agencyId: string }[]> {
    const digits = usDigits(from);
    if (!digits) return [];
    return this.prisma.$queryRaw<{ id: string; agencyId: string }[]>`
      SELECT id::text AS id, agency_id::text AS "agencyId" FROM patients
      WHERE status = 'active' AND phone_home IS NOT NULL
        AND regexp_replace(phone_home, '[^0-9]', '', 'g') IN (${digits}, ${`1${digits}`})`;
  }

  /** The caregiver's visit at this home today: one they're clocked into first, else the scheduled one starting soonest. */
  private async todaysVisit(staff: { id: string; agencyId: string }, patientIds: string[]) {
    if (!patientIds.length) return null;
    const today = todayInTimeZone(await this.clock.timezone(staff.agencyId));
    const visits = await this.prisma.visit.findMany({
      where: {
        agencyId: staff.agencyId,
        staffId: staff.id,
        patientId: { in: patientIds },
        scheduledDate: toDate(today),
        status: { in: ['in_progress', 'scheduled'] },
      },
      select: { id: true, status: true, scheduledStart: true },
      orderBy: { scheduledStart: 'asc' },
    });
    return visits.find((v) => v.status === 'in_progress') ?? visits[0] ?? null;
  }

  private async spokenTime(agencyId: string, at: Date): Promise<string> {
    return new Intl.DateTimeFormat('en-US', { timeZone: await this.clock.timezone(agencyId), hour: 'numeric', minute: '2-digit' }).format(at);
  }
}
