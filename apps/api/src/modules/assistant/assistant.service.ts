import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv, type EnvironmentVariables } from '../../config/env.validation.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClaimsService } from '../billing/claims.service.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { InsightsService } from '../insights/insights.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PayrollService } from '../payroll/payroll.service.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import { CaregiverMatchService } from '../scheduling/caregiver-match.service.js';
import { OpenShiftsService } from '../scheduling/open-shifts.service.js';
import { VisitsService } from '../scheduling/visits.service.js';
import { StaffService } from '../staff/staff.service.js';
import { TimeOffService } from '../staff/time-off.service.js';
import { ASSISTANT_SYSTEM_PROMPT } from './assistant-guide.js';
import { buildAssistantTools, type AssistantTool } from './assistant-tools.js';
import type { AssistantChatDto } from './dto/assistant.dto.js';

/** Lookups per question before the assistant must answer with what it has. */
export const MAX_TOOL_ROUNDS = 6;
/** A tool result longer than this is cut (tools already return at most TOOL_ROW_LIMIT rows). */
const MAX_TOOL_RESULT_CHARS = 20_000;

export type AssistantStatus = { enabled: true; model: string } | { enabled: false; reason: 'not_configured' | 'baa_required' };

export interface AssistantReply {
  reply: string;
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
  ) {
    this.tools = buildAssistantTools({ patients, staff, visits, openShifts, timeOff, claims, payroll, compliance, insights, match });
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
    return this.tools.filter((t) => access.permissions.has(t.permission));
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
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.ask(status.model, tools, today, access.roles, messages, round < MAX_TOOL_ROUNDS);
      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        const reply = textOf(response);
        if (reply) return { reply, lookups };
        return { reply: 'Sorry, I couldn’t answer that. Try asking it a different way.', lookups };
      }
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) results.push(await this.runTool(caller, tools, use, lookups));
      messages.push({ role: 'user', content: results });
    }
    return { reply: 'That needed more lookups than I can do at once. Try a more specific question.', lookups };
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

  private async runTool(caller: AuthUser, tools: AssistantTool[], use: Anthropic.ToolUseBlock, lookups: string[]): Promise<Anthropic.ToolResultBlockParam> {
    const tool = tools.find((t) => t.name === use.name);
    if (!tool) return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'That lookup isn’t available to this person.' };
    lookups.push(tool.name);
    try {
      const result = await tool.run(caller, (use.input ?? {}) as Record<string, unknown>);
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
