import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv, type EnvironmentVariables } from '../../config/env.validation.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClaimsService } from '../billing/claims.service.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { InsightsService } from '../insights/insights.service.js';
import { WorkforceService } from '../insights/workforce.service.js';
import { ReferralsService } from '../referrals/referrals.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PayrollService } from '../payroll/payroll.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { CaregiverMatchService } from '../scheduling/caregiver-match.service.js';
import { OpenShiftsService } from '../scheduling/open-shifts.service.js';
import { VisitsService } from '../scheduling/visits.service.js';
import { StaffService } from '../staff/staff.service.js';
import { TimeOffService } from '../staff/time-off.service.js';
import { ASSISTANT_SYSTEM_PROMPT } from './assistant-guide.js';
import { buildAssistantActions, type ActionPreview, type ActionResult, type AssistantAction } from './assistant-actions.js';
import { buildAssistantTools, type AssistantTool } from './assistant-tools.js';
import type { AssistantChatDto } from './dto/assistant.dto.js';

/** Marks a tool result as a prepared action rather than data. */
const PROPOSAL = '__proposal';

/** Lookups per question before the assistant must answer with what it has. */
export const MAX_TOOL_ROUNDS = 6;
/** A tool result longer than this is cut (tools already return at most TOOL_ROW_LIMIT rows). */
const MAX_TOOL_RESULT_CHARS = 20_000;

export type AssistantStatus = { enabled: true; model: string } | { enabled: false; reason: 'not_configured' | 'baa_required' };

export interface AssistantReply {
  reply: string;
  /** Actions prepared for the person to confirm (D-095) — nothing has happened yet. */
  actions?: ActionPreview[];
  /** Which lookups ran, in order (shown to the user as "Looked up: …"). */
  lookups: string[];
}

/** Just the part of the SDK client the service uses, so tests can stand in for Anthropic. */
export type MessagesClient = { messages: Pick<Anthropic['messages'], 'create'> };

/**
 * The in-app assistant (D-092): answers questions about the system and looks things up with read-only tools that run
 * as the signed-in person. Patient details pass through the model, so production stays off until a BAA with
 * Anthropic is confirmed (ASSISTANT_BAA_CONFIRMED). Message text is never logged; each lookup is audited (tool name
 * and result count — no search terms, which can be PHI, D-035).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly tools: AssistantTool[];
  private readonly actions: AssistantAction[];
  /** Replaced in tests; created on first use from ANTHROPIC_API_KEY. */
  client: MessagesClient | null = null;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly clock: AgencyClockService,
    patients: PatientsService,
    staff: StaffService,
    visits: VisitsService,
    openShifts: OpenShiftsService,
    timeOff: TimeOffService,
    claims: ClaimsService,
    payroll: PayrollService,
    compliance: ComplianceService,
    insights: InsightsService,
    match: CaregiverMatchService,
    workforce: WorkforceService,
    referrals: ReferralsService,
  ) {
    this.tools = buildAssistantTools({ patients, staff, visits, openShifts, timeOff, claims, payroll, compliance, insights, match, workforce, referrals });
    this.actions = buildAssistantActions({ visits, staff, openShifts, timeOff, payroll });
  }

  status(): AssistantStatus {
    if (!this.config.get('ANTHROPIC_API_KEY', { infer: true })) return { enabled: false, reason: 'not_configured' };
    const production = this.config.get('APP_ENV', { infer: true }) === AppEnv.Production;
    if (production && !this.config.get('ASSISTANT_BAA_CONFIRMED', { infer: true })) return { enabled: false, reason: 'baa_required' };
    return { enabled: true, model: this.config.get('ASSISTANT_MODEL', { infer: true }) };
  }

  /** The tools this person may use — the rest are never shown to the model. */
  async toolsFor(caller: AuthUser): Promise<AssistantTool[]> {
    const access = await this.permissions.forUser(caller);
    const lookups = this.tools.filter((t) => access.permissions.has(t.permission));
    // Actions are offered as "prepare_…" tools: they only build a Confirm card (D-095).
    const prepare: AssistantTool[] = this.actions
      .filter((a) => a.permissions.every((p) => access.permissions.has(p)))
      .map((a) => ({
        name: `prepare_${a.kind}`,
        description: `${a.description} This does NOT do it: the person gets a Confirm button and decides.`,
        permission: a.permissions[0]!,
        inputSchema: a.inputSchema as AssistantTool['inputSchema'],
        run: async (c, input) => ({ [PROPOSAL]: await a.preview(c, input) }),
      }));
    return [...lookups, ...prepare];
  }

  /** Runs a confirmed action (D-095): the person's own permissions, every check again, audited. */
  async executeAction(caller: AuthUser, kind: string, params: Record<string, unknown>): Promise<ActionResult> {
    const action = this.actions.find((a) => a.kind === kind);
    if (!action) throw new BadRequestException('Unknown action');
    const access = await this.permissions.forUser(caller);
    if (!action.permissions.every((p) => access.permissions.has(p))) throw new ForbiddenException('Your role can’t do that');
    const result = await action.execute(caller, params, (p) => access.permissions.has(p));
    await this.audit.record({
      agencyId: caller.agencyId,
      userId: caller.userId,
      action: 'ASSISTANT_ACTION',
      resourceType: kind,
      details: { params: Object.fromEntries(Object.entries(params).filter(([k, v]) => (k.endsWith('Id') || k === 'status') && typeof v === 'string')) as Record<string, string> },
    });
    return result;
  }

  async chat(caller: AuthUser, dto: AssistantChatDto): Promise<AssistantReply> {
    const status = this.status();
    if (!status.enabled) throw new ServiceUnavailableException('The assistant isn’t switched on for this agency yet');
    if (dto.messages[0]!.role !== 'user' || dto.messages.at(-1)!.role !== 'user') {
      throw new BadRequestException('The conversation must start and end with a question from the user');
    }
    const tools = await this.toolsFor(caller);
    const today = await this.clock.todayString(caller.agencyId);
    const access = await this.permissions.forUser(caller);

    const messages: Anthropic.MessageParam[] = dto.messages.map((m) => ({ role: m.role, content: m.content }));
    const lookups: string[] = [];
    const prepared: ActionPreview[] = [];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.ask(status.model, tools, today, access.roles, messages, round < MAX_TOOL_ROUNDS);
      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        const reply = textOf(response);
        const extra = prepared.length ? { actions: prepared } : {};
        if (reply) return { reply, lookups, ...extra };
        if (prepared.length) return { reply: 'Please check the details below and confirm.', lookups, ...extra };
        return { reply: 'Sorry, I couldn’t answer that. Try asking it a different way.', lookups };
      }
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) results.push(await this.runTool(caller, tools, use, lookups, prepared));
      messages.push({ role: 'user', content: results });
    }
    return { reply: 'That needed more lookups than I can do at once. Try a more specific question.', lookups, ...(prepared.length ? { actions: prepared } : {}) };
  }

  private async ask(
    model: string,
    tools: AssistantTool[],
    today: string,
    roles: string[],
    messages: Anthropic.MessageParam[],
    allowTools: boolean,
  ): Promise<Anthropic.Message> {
    this.client ??= new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true })! });
    const toolDefs: Anthropic.Tool[] = tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      // Tools + the guide are the same for every question: cache them.
      ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    try {
      return await this.client.messages.create({
        model,
        max_tokens: 2048,
        system: [
          { type: 'text', text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          {
            type: 'text',
            text:
              `Today is ${today} in the agency's time zone. The person asking has the role(s): ${roles.join(', ') || 'none'}. ` +
              `Lookups available to them: ${tools.map((t) => t.name).join(', ') || 'none'}. ` +
              'If answering would need information none of these lookups cover (for example payroll, billing or compliance), ' +
              'say plainly that their role doesn’t have access to that and who usually does (an administrator); don’t ask follow-up questions about it or link to those pages.',
          },
        ],
        tools: toolDefs,
        // On the last round the model must answer from what it has.
        tool_choice: allowTools && toolDefs.length ? { type: 'auto' } : { type: 'none' },
        messages,
      });
    } catch (error) {
      // Status only — never the request or response text.
      const status = error instanceof Anthropic.APIError ? error.status : 'network';
      this.logger.warn(`Assistant model call failed (${status})`);
      throw new ServiceUnavailableException('The assistant is unavailable right now — please try again in a minute');
    }
  }

  private async runTool(
    caller: AuthUser,
    tools: AssistantTool[],
    use: Anthropic.ToolUseBlock,
    lookups: string[],
    prepared: ActionPreview[],
  ): Promise<Anthropic.ToolResultBlockParam> {
    const tool = tools.find((t) => t.name === use.name);
    if (!tool) return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'That lookup isn’t available to this person.' };
    lookups.push(tool.name);
    try {
      const result = await tool.run(caller, (use.input ?? {}) as Record<string, unknown>);
      const proposal = (result as Record<string, unknown> | null)?.[PROPOSAL] as ActionPreview | undefined;
      if (proposal) {
        const key = JSON.stringify([proposal.kind, proposal.params]);
        if (!prepared.some((x) => JSON.stringify([x.kind, x.params]) === key)) prepared.push(proposal);
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: `Shown to the person as a Confirm card ("${proposal.title}"). It has NOT happened yet. Tell them to check it and press ${proposal.confirmLabel}; do not say it is done.`,
        };
      }
      await this.audit.record({
        agencyId: caller.agencyId,
        userId: caller.userId,
        action: 'ASSISTANT_LOOKUP',
        resourceType: tool.name,
        details: { results: countOf(result) },
      });
      return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS) };
    } catch (error) {
      // A refused or invalid lookup goes back to the model as an error it can explain; anything else is a bug.
      if (error instanceof HttpException) return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: error.message };
      throw error;
    }
  }
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function countOf(result: unknown): number | null {
  const shown = (result as { shown?: unknown } | null)?.shown;
  return typeof shown === 'number' ? shown : null;
}
