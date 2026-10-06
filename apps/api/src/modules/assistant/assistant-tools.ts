import type Anthropic from '@anthropic-ai/sdk';
import { DISCIPLINES, PATIENT_STATUSES, REFERRAL_STATUSES, VISIT_STATUSES, type Permission } from '@alora/shared';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated, PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import type { ClaimsService } from '../billing/claims.service.js';
import { CLAIM_STATUSES, ListClaimsQueryDto } from '../billing/dto/claims.dto.js';
import type { ComplianceService } from '../compliance/compliance.service.js';
import type { InsightsService } from '../insights/insights.service.js';
import type { WorkforceService } from '../insights/workforce.service.js';
import { ListReferralsQueryDto } from '../referrals/dto/referrals.dto.js';
import type { ReferralsService } from '../referrals/referrals.service.js';
import { ListPatientsQueryDto } from '../patients/dto/patients.dto.js';
import type { PatientsService } from '../patients/patients.service.js';
import type { PayrollService } from '../payroll/payroll.service.js';
import { ListOpenShiftsQueryDto } from '../scheduling/dto/open-shifts.dto.js';
import { ListVisitsQueryDto } from '../scheduling/dto/scheduling.dto.js';
import type { CaregiverMatchService } from '../scheduling/caregiver-match.service.js';
import { SuggestCaregiversDto } from '../scheduling/dto/scheduling.dto.js';
import type { OpenShiftsService } from '../scheduling/open-shifts.service.js';
import type { VisitsService } from '../scheduling/visits.service.js';
import { ListStaffQueryDto } from '../staff/dto/staff.dto.js';
import { ListTimeOffQueryDto, TIME_OFF_STATUSES } from '../staff/dto/time-off.dto.js';
import type { StaffService } from '../staff/staff.service.js';
import type { TimeOffService } from '../staff/time-off.service.js';

/** How many rows a lookup returns at most: enough to answer, small enough to keep answers cheap and focused. */
export const TOOL_ROW_LIMIT = 25;

/**
 * One read-only lookup the assistant can make (D-092). It runs the existing service **as the caller**, so record
 * filtering (assigned patients, own visits, own agency) applies exactly as in the dashboard; `permission` decides
 * whether the tool is offered at all (the route-level check the controllers would have done).
 */
export interface AssistantTool {
  name: string;
  description: string;
  permission: Permission;
  inputSchema: Anthropic.Tool.InputSchema;
  run(caller: AuthUser, input: Record<string, unknown>): Promise<unknown>;
}

export interface AssistantToolServices {
  patients: PatientsService;
  staff: StaffService;
  visits: VisitsService;
  openShifts: OpenShiftsService;
  timeOff: TimeOffService;
  claims: ClaimsService;
  payroll: PayrollService;
  compliance: ComplianceService;
  insights: InsightsService;
  match: CaregiverMatchService;
  workforce: WorkforceService;
  referrals: ReferralsService;
}

/** The model's arguments → the same validated query object the HTTP route would build. */
export function query<T extends object>(dto: ClassConstructor<T>, input: Record<string, unknown>): T {
  const value = plainToInstance(dto, { ...input, limit: TOOL_ROW_LIMIT }, { exposeDefaultValues: true });
  const errors = validateSync(value, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    throw new BadRequestException(errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '));
  }
  return value;
}

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const schema = (properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool.InputSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const page = <T>(result: Paginated<T>, map: (row: T) => unknown) => ({
  total: result.meta.total,
  shown: result.items.length,
  results: result.items.map(map),
});
const person = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

export function buildAssistantTools(s: AssistantToolServices): AssistantTool[] {
  return [
    {
      name: 'todays_priorities',
      description:
        "The agency's Command Center: what needs attention today, worst first (uncovered visits, expired or expiring credentials, authorizations on track to run over, money that can't be billed yet and why, EVV corrections, missing visit notes, open shifts), plus today's expected revenue. Use this for questions like 'what should I worry about today?', 'how are we doing?' or 'where are we losing money?'. Sections the person can't see are left out.",
      permission: 'visits:read',
      inputSchema: schema({}),
      run: async (caller) => {
        const c = await s.insights.commandCenter(caller);
        return {
          today: c.today,
          needsAttention: c.attention.map((a) => ({ severity: a.severity, item: a.title, detail: a.detail, ...(a.amount !== undefined ? { amount: a.amount } : {}), link: a.link })),
          ...(c.coverage ? { unassignedVisits: c.coverage.unassigned } : {}),
          ...(c.authorizations
            ? {
                authorizationsAtRisk: c.authorizations.atRisk.map((a) => ({
                  patient: `${a.patient.firstName} ${a.patient.lastName}`,
                  payer: a.payer,
                  limit: `${a.authorized} ${a.unit}`,
                  used: a.used,
                  booked: a.booked,
                  projected: a.forecast.projected,
                  overBy: a.forecast.overBy,
                  runsOutOn: a.forecast.runsOutOn,
                  endDate: a.endDate,
                  link: a.link,
                })),
              }
            : {}),
          ...(c.money ? { money: { expectedToday: c.money.expectedToday, visitsToday: c.money.visitsToday, atRisk: c.money.atRisk } } : {}),
        };
      },
    },
    {
      name: 'suggest_caregivers',
      description:
        "Who should take a visit: eligible caregivers ranked best first, each with a score and plain-language reasons (past visits with the patient, preferences, language, distance, overtime, reliability), plus who can't take it and why. Give either visitId (from a list_visits link /schedule/visits/<id>) for a booked visit, or patientId + visitType + scheduledDate + scheduledStart + scheduledEnd for one not booked yet. Assigning is done on the visit page — link to it.",
      permission: 'visits:assign',
      inputSchema: schema({
        visitId: str('A booked visit (from list_visits).'),
        patientId: str('Patient id (from find_patients), for a visit not booked yet.'),
        visitType: str('Visit type, e.g. home_health_aide, personal_care, skilled_nursing.'),
        scheduledDate: str('YYYY-MM-DD'),
        scheduledStart: str('HH:MM, 24-hour'),
        scheduledEnd: str('HH:MM, 24-hour'),
      }),
      run: async (caller, input) => {
        const result = input.visitId
          ? await s.match.forVisit(caller, String(input.visitId))
          : await (async () => {
              const { visitId: _ignored, ...slot } = input;
              const dto = plainToInstance(SuggestCaregiversDto, slot);
              const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
              if (errors.length) throw new BadRequestException('Give a visitId, or patientId, visitType, scheduledDate, scheduledStart and scheduledEnd');
              return s.match.suggest(caller, { ...dto, agencyId: caller.agencyId });
            })();
        return {
          visit: result.visit,
          considered: result.considered,
          suggestions: result.suggestions.map((x) => ({
            caregiver: `${x.staff.firstName} ${x.staff.lastName} (${x.staff.discipline})`,
            score: x.score,
            reasons: x.reasons.map((r) => `${r.good ? '+' : '−'} ${r.text}`),
            link: `/staff/${x.staff.id}`,
          })),
          cannotTake: result.excluded.map((x) => ({ caregiver: `${x.staff.firstName} ${x.staff.lastName}`, reason: x.reason })),
          ...(input.visitId ? { visitLink: `/schedule/visits/${String(input.visitId)}` } : {}),
        };
      },
    },
    {
      name: 'find_patients',
      description: 'Search patients by name or MRN (medical record number). Returns basic details and a link to each patient.',
      permission: 'patients:read',
      inputSchema: schema({
        search: str('Name (or part of it) or MRN. Leave out to list patients.'),
        status: str('Admission status.', { enum: [...PATIENT_STATUSES] }),
      }),
      run: async (caller, input) =>
        page(await s.patients.list(caller, query(ListPatientsQueryDto, input)), (p) => ({
          name: person(p),
          mrn: p.mrn,
          dateOfBirth: p.dateOfBirth,
          status: p.status,
          city: p.city,
          admissionDate: p.admissionDate,
          link: `/patients/${p.id}`,
        })),
    },
    {
      name: 'find_staff',
      description: 'Search staff (caregivers, nurses, therapists, office) by name or employee ID, discipline or active status.',
      permission: 'staff:read',
      inputSchema: schema({
        search: str('Name (or part of it) or employee ID.'),
        discipline: str('Discipline.', { enum: [...DISCIPLINES] }),
        isActive: { type: 'boolean', description: 'true = current staff only, false = former staff only.' },
      }),
      run: async (caller, input) =>
        page(await s.staff.list(caller, query(ListStaffQueryDto, input)), (m) => ({
          name: person(m),
          employeeId: m.employeeId,
          discipline: m.discipline,
          employmentType: m.employmentType,
          active: m.isActive,
          languages: m.languages,
          link: `/staff/${m.id}`,
        })),
    },
    {
      name: 'list_visits',
      description:
        'Visits in a date range, optionally for one patient or caregiver, by status, or only those with no caregiver. Use find_patients / find_staff first to get an id when the user names someone.',
      permission: 'visits:read',
      inputSchema: schema({
        from: str('First date, YYYY-MM-DD.'),
        to: str('Last date, YYYY-MM-DD.'),
        status: str('Visit status.', { enum: [...VISIT_STATUSES] }),
        patientId: str('Patient id (from find_patients link /patients/<id>).'),
        staffId: str('Staff id (from find_staff link /staff/<id>).'),
        unassigned: { type: 'boolean', description: 'true = only visits with no caregiver yet.' },
      }),
      run: async (caller, input) =>
        page(await s.visits.list(caller, query(ListVisitsQueryDto, input)), (v) => ({
          date: v.scheduledDate,
          time: `${v.scheduledStart}–${v.scheduledEnd}`,
          patient: person(v.patient),
          caregiver: v.staff ? `${person(v.staff)} (${v.staff.discipline})` : null,
          visitType: v.visitType,
          status: v.status,
          link: `/schedule/visits/${v.id}`,
        })),
    },
    {
      name: 'list_open_shifts',
      description: 'Shifts offered to caregivers that still need someone (or filled/cancelled ones).',
      permission: 'visits:read',
      inputSchema: schema({ status: str('Offer status (default: all).', { enum: ['open', 'filled', 'cancelled'] }) }),
      run: async (caller, input) =>
        page(await s.openShifts.list(caller, query(ListOpenShiftsQueryDto, input)), (o) => ({
          date: o.visit.scheduledDate,
          time: `${o.visit.scheduledStart}–${o.visit.scheduledEnd}`,
          visitType: o.visit.visitType,
          status: o.expired ? 'expired' : o.status,
          area: [o.area.city, o.area.zip].filter(Boolean).join(' '),
          filledBy: o.filledBy ? person(o.filledBy) : null,
          link: '/schedule/open-shifts',
        })),
    },
    {
      name: 'list_time_off',
      description: 'Time off requests (pending ones need a supervisor decision). Includes how many booked visits each pending request affects.',
      permission: 'visits:read',
      inputSchema: schema({ status: str('Request status.', { enum: [...TIME_OFF_STATUSES] }) }),
      run: async (caller, input) =>
        page(await s.timeOff.list(caller, query(ListTimeOffQueryDto, input)), (t) => ({
          id: t.id,
          staff: person(t.staff),
          from: t.startDate,
          to: t.endDate,
          days: t.days,
          type: t.type,
          status: t.status,
          bookedVisits: t.bookedVisits ?? null,
          link: '/schedule/open-shifts',
        })),
    },
    {
      name: 'list_claims',
      description: 'Insurance claims, optionally by status or for one patient. Shows charges, payments, rejections and denials.',
      permission: 'billing:read',
      inputSchema: schema({
        status: str('Claim status.', { enum: [...CLAIM_STATUSES] }),
        patientId: str('Patient id (from find_patients).'),
      }),
      run: async (caller, input) =>
        page(await s.claims.list(caller, query(ListClaimsQueryDto, input)), (c) => ({
          claimNumber: c.claimNumber,
          status: c.status,
          patient: person(c.patient),
          payer: c.payer.name,
          period: `${c.billingPeriodStart} to ${c.billingPeriodEnd}`,
          charges: c.totalCharges,
          paid: c.totalPaid,
          rejection: c.rejection?.reason ?? null,
          denial: c.denial ? (c.denial.reason ?? c.denial.code) : null,
          link: `/billing/claims/${c.id}`,
        })),
    },
    {
      name: 'list_pay_periods',
      description: 'Payroll pay periods, newest first: status (draft/calculated/approved/exported), pay date, staff count and total gross pay.',
      permission: 'payroll:read',
      inputSchema: schema({}),
      run: async (caller) => {
        const result = await s.payroll.listPeriods(caller, query(PaginationQueryDto, {}));
        return page(result, (p) => ({
          period: `${p.periodStart} to ${p.periodEnd}`,
          payDate: p.payDate,
          status: p.status,
          staffCount: p.staffCount,
          totalGross: p.totalGross,
          link: `/payroll/${p.id}`,
        }));
      },
    },
    {
      name: 'evv_patterns',
      description:
        "EVV patterns a supervisor should look at (default the last 14 days): a caregiver clocked in to two visits at once, travel between visits faster than driving allows, repeated time corrections, or repeated clock-ins away from the client's address. These describe what was seen, not wrongdoing — a forgotten clock-out or a bad GPS fix is common. Optional from/to (YYYY-MM-DD).",
      permission: 'evv:approve',
      inputSchema: schema({ from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD') }),
      run: async (caller, input) => {
        const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
        const r = await s.workforce.anomalies(caller, date(input.from), date(input.to));
        return {
          from: r.from,
          to: r.to,
          patterns: r.items.slice(0, TOOL_ROW_LIMIT).map((a) => ({ type: a.type, severity: a.severity, caregiver: a.staffName, detail: a.detail, link: a.link })),
          allPatternsLink: '/evv?tab=anomalies',
        };
      },
    },
    {
      name: 'list_referrals',
      description:
        "Referrals — people asking about care before they become patients (newest first): stage (new, contacted, assessment, authorization_pending, ready, admitted, lost), source, payer, follow-up date. status 'open' means not admitted or lost. search matches name, phone or email.",
      permission: 'referrals:read',
      inputSchema: schema({ status: str('Stage, or open', { enum: ['open', ...REFERRAL_STATUSES] }), search: str('Name, phone or email') }),
      run: async (caller, input) =>
        page(await s.referrals.list(caller, query(ListReferralsQueryDto, input)), (r) => ({
          client: `${r.clientFirstName} ${r.clientLastName}`,
          stage: r.status,
          source: r.source?.name ?? (r.channel === 'web_form' ? 'website form' : null),
          payer: r.payerType,
          received: r.createdAt.toISOString().slice(0, 10),
          nextFollowUp: r.nextFollowUp,
          link: `/referrals/${r.id}`,
        })),
    },
    {
      name: 'compliance_overview',
      description: 'The compliance dashboard: open incidents, expired and soon-expiring staff credentials, and other compliance counts.',
      permission: 'compliance:read',
      inputSchema: schema({}),
      run: async (caller) => ({ ...(await s.compliance.dashboard(caller)), link: '/compliance' }),
    },
  ];
}
