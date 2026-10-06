import type { Permission } from '@alora/shared';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, validateSync } from 'class-validator';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import type { PayrollService } from '../payroll/payroll.service.js';
import type { OpenShiftsService } from '../scheduling/open-shifts.service.js';
import type { VisitsService } from '../scheduling/visits.service.js';
import type { StaffService } from '../staff/staff.service.js';
import type { TimeOffService } from '../staff/time-off.service.js';

/**
 * Things the assistant can do for someone (D-095) — never on its own: it prepares an action, the person sees a Confirm
 * card with exactly what will happen, and only their click runs it, through the same service the dashboard button
 * uses, with their own permissions. Each action re-checks everything at confirm time (nothing is trusted from the
 * preview).
 */

export type ActionKind = 'assign_caregiver' | 'offer_open_shift' | 'decide_time_off' | 'calculate_payroll' | 'export_payroll';

/** What the Confirm card shows. */
export interface ActionPreview {
  kind: ActionKind;
  title: string;
  details: string[];
  /** Sent back unchanged when the person confirms. */
  params: Record<string, unknown>;
  confirmLabel: string;
}

export interface ActionResult {
  message: string;
  /** Where to see the result. */
  link?: string;
  /** A file to download (payroll export). */
  file?: { fileName: string; content: string; mimeType: string };
}

export interface ActionServices {
  visits: VisitsService;
  staff: StaffService;
  openShifts: OpenShiftsService;
  timeOff: TimeOffService;
  payroll: PayrollService;
}

/** "…/schedule/visits/<uuid>" or a bare uuid → the uuid (the model often passes the links it was given). */
export function idFrom(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const all = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  return all ? all[all.length - 1] : value;
}

class AssignCaregiverParams {
  @IsUUID() visitId!: string;
  @IsUUID() staffId!: string;
}
class OfferOpenShiftParams {
  @IsUUID() visitId!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
class DecideTimeOffParams {
  @IsUUID() timeOffId!: string;
  @IsIn(['approved', 'denied']) status!: 'approved' | 'denied';
}
class PayPeriodParams {
  @IsUUID() payPeriodId!: string;
}

function parse<T extends object>(cls: new () => T, raw: Record<string, unknown>, idKeys: string[]): T {
  const cleaned: Record<string, unknown> = { ...raw };
  for (const k of idKeys) cleaned[k] = idFrom(cleaned[k]);
  const value = plainToInstance(cls, cleaned);
  const errors = validateSync(value, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new BadRequestException(errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '));
  return value;
}

const when = (date: string, start: string, end: string) =>
  `${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${start}–${end}`;
const human = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).replaceAll('_', ' ');

export interface AssistantAction {
  kind: ActionKind;
  /** For the model: when to use it. */
  description: string;
  /** The same permission(s) as the dashboard endpoint. */
  permissions: Permission[];
  inputSchema: Record<string, unknown>;
  preview(caller: AuthUser, raw: Record<string, unknown>): Promise<ActionPreview>;
  execute(caller: AuthUser, raw: Record<string, unknown>, can: (p: string) => boolean): Promise<ActionResult>;
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const id = (description: string) => ({ type: 'string', description });

export function buildAssistantActions(s: ActionServices): AssistantAction[] {
  return [
    {
      kind: 'assign_caregiver',
      description: 'Assign a caregiver to a scheduled visit (e.g. the best match from suggest_caregivers). The scheduling rules are checked again when confirmed.',
      permissions: ['visits:update'],
      inputSchema: obj({ visitId: id('The visit (id or its /schedule/visits/<id> link).'), staffId: id('The caregiver (id or their /staff/<id> link).') }, ['visitId', 'staffId']),
      preview: async (caller, raw) => {
        const p = parse(AssignCaregiverParams, raw, ['visitId', 'staffId']);
        const [visit, staff] = await Promise.all([s.visits.get(caller, p.visitId), s.staff.get(caller, p.staffId)]);
        if (visit.status !== 'scheduled') throw new BadRequestException(`That visit is ${visit.status}, so it can’t be reassigned`);
        return {
          kind: 'assign_caregiver',
          title: `Assign ${staff.firstName} ${staff.lastName} to ${visit.patient.firstName} ${visit.patient.lastName}’s visit`,
          details: [
            when(visit.scheduledDate, visit.scheduledStart, visit.scheduledEnd),
            human(visit.visitType),
            visit.staff ? `Replaces ${visit.staff.firstName} ${visit.staff.lastName}` : 'Currently has no caregiver',
          ],
          params: { visitId: p.visitId, staffId: p.staffId },
          confirmLabel: 'Assign',
        };
      },
      execute: async (caller, raw) => {
        const p = parse(AssignCaregiverParams, raw, ['visitId', 'staffId']);
        const result = await s.visits.update(caller, p.visitId, { staffId: p.staffId });
        const warnings = result.warnings.length ? ` Note: ${result.warnings.map((w) => w.message).join('; ')}.` : '';
        return { message: `Assigned.${warnings} The caregiver is notified.`, link: `/schedule/visits/${p.visitId}` };
      },
    },
    {
      kind: 'offer_open_shift',
      description: 'Offer a scheduled visit as an open shift and notify eligible caregivers (first to claim it gets it). A caregiver already on it is taken off and told.',
      permissions: ['visits:create'],
      inputSchema: obj({ visitId: id('The visit (id or link).'), notes: { type: 'string', description: 'Optional note for caregivers — no patient details.' } }, ['visitId']),
      preview: async (caller, raw) => {
        const p = parse(OfferOpenShiftParams, raw, ['visitId']);
        const visit = await s.visits.get(caller, p.visitId);
        if (visit.status !== 'scheduled') throw new BadRequestException(`That visit is ${visit.status}, so it can’t be offered`);
        return {
          kind: 'offer_open_shift',
          title: `Offer ${visit.patient.firstName} ${visit.patient.lastName}’s visit as an open shift`,
          details: [
            when(visit.scheduledDate, visit.scheduledStart, visit.scheduledEnd),
            human(visit.visitType),
            visit.staff ? `${visit.staff.firstName} ${visit.staff.lastName} will be taken off it and told` : 'No caregiver yet',
            'Eligible caregivers get an alert (no patient details)',
            ...(p.notes ? [`Note: ${p.notes}`] : []),
          ],
          params: { visitId: p.visitId, ...(p.notes ? { notes: p.notes } : {}) },
          confirmLabel: 'Offer and notify',
        };
      },
      execute: async (caller, raw, can) => {
        const p = parse(OfferOpenShiftParams, raw, ['visitId']);
        const shift = await s.openShifts.create(caller, { visitId: p.visitId, ...(p.notes ? { notes: p.notes } : {}) });
        const sent = can('notifications:create') ? await s.openShifts.broadcast(caller, shift.id) : null;
        return {
          message: sent ? `Offered — ${sent.notified} caregiver${sent.notified === 1 ? '' : 's'} notified.` : 'Offered. (Notifying caregivers needs the notifications permission.)',
          link: '/schedule/open-shifts',
        };
      },
    },
    {
      kind: 'decide_time_off',
      description: 'Approve or deny a pending time off request (from list_time_off). The caregiver is told the decision.',
      permissions: ['visits:approve'],
      inputSchema: obj({ timeOffId: id('The request id (from list_time_off).'), status: { type: 'string', enum: ['approved', 'denied'] } }, ['timeOffId', 'status']),
      preview: async (caller, raw) => {
        const p = parse(DecideTimeOffParams, raw, ['timeOffId']);
        const t = await s.timeOff.get(caller, p.timeOffId);
        if (t.status !== 'pending') throw new BadRequestException(`That request is already ${t.status}`);
        const range = t.startDate === t.endDate ? t.startDate : `${t.startDate} to ${t.endDate}`;
        return {
          kind: 'decide_time_off',
          title: `${p.status === 'approved' ? 'Approve' : 'Deny'} ${t.staff.firstName} ${t.staff.lastName}’s time off`,
          details: [`${range} (${t.days} day${t.days === 1 ? '' : 's'}, ${t.type})`, ...(t.notes ? [`Their note: ${t.notes}`] : []), `${t.staff.firstName} will be notified`],
          params: { timeOffId: p.timeOffId, status: p.status },
          confirmLabel: p.status === 'approved' ? 'Approve' : 'Deny',
        };
      },
      execute: async (caller, raw) => {
        const p = parse(DecideTimeOffParams, raw, ['timeOffId']);
        const t = await s.timeOff.decide(caller, p.timeOffId, { status: p.status });
        const booked = t.bookedVisits ? ` ${t.bookedVisits} booked visit${t.bookedVisits === 1 ? ' needs' : 's need'} another caregiver.` : '';
        return { message: `${p.status === 'approved' ? 'Approved' : 'Denied'}.${booked}`, link: '/schedule/open-shifts' };
      },
    },
    {
      kind: 'calculate_payroll',
      description: 'Calculate (or recalculate) a pay period from completed visits, mileage and rates (from list_pay_periods). Earlier adjustments are kept.',
      permissions: ['payroll:create'],
      inputSchema: obj({ payPeriodId: id('The pay period (id or its /payroll/<id> link).') }, ['payPeriodId']),
      preview: async (caller, raw) => {
        const p = parse(PayPeriodParams, raw, ['payPeriodId']);
        const period = await s.payroll.getPeriod(caller, p.payPeriodId);
        return {
          kind: 'calculate_payroll',
          title: `Calculate payroll for ${period.periodStart} to ${period.periodEnd}`,
          details: [`Pay date ${period.payDate}`, `Status now: ${period.status}`, 'Bonuses, deductions and notes already entered are kept'],
          params: { payPeriodId: p.payPeriodId },
          confirmLabel: 'Calculate',
        };
      },
      execute: async (caller, raw) => {
        const p = parse(PayPeriodParams, raw, ['payPeriodId']);
        await s.payroll.calculate(caller, p.payPeriodId);
        return { message: 'Calculated — review the stubs, then approve.', link: `/payroll/${p.payPeriodId}` };
      },
    },
    {
      kind: 'export_payroll',
      description: 'Export an approved pay period as a CSV file for the payroll provider (from list_pay_periods).',
      permissions: ['payroll:export'],
      inputSchema: obj({ payPeriodId: id('The pay period (id or link).') }, ['payPeriodId']),
      preview: async (caller, raw) => {
        const p = parse(PayPeriodParams, raw, ['payPeriodId']);
        const period = await s.payroll.getPeriod(caller, p.payPeriodId);
        if (period.status !== 'approved' && period.status !== 'exported') throw new BadRequestException('Approve the pay period before exporting it');
        return {
          kind: 'export_payroll',
          title: `Export payroll for ${period.periodStart} to ${period.periodEnd}`,
          details: [`Pay date ${period.payDate}`, `${period.stubs.length} staff`, 'Downloads a CSV for your payroll provider'],
          params: { payPeriodId: p.payPeriodId },
          confirmLabel: 'Export',
        };
      },
      execute: async (caller, raw) => {
        const p = parse(PayPeriodParams, raw, ['payPeriodId']);
        const file = await s.payroll.exportCsv(caller, p.payPeriodId);
        return { message: 'Exported — the file is downloading.', link: `/payroll/${p.payPeriodId}`, file: { ...file, mimeType: 'text/csv' } };
      },
    },
  ];
}
