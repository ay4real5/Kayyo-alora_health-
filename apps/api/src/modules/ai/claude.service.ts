import Anthropic from '@anthropic-ai/sdk';
import { Global, Injectable, Logger, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv, type EnvironmentVariables } from '../../config/env.validation.js';

/** Models that accept tool_choice {type: 'tool'} (Claude 4.x and Haiku 4.5). */
const FORCED_TOOL = /^claude-(haiku|sonnet|opus)-4/;

/** Just the part of the SDK client used, so tests can stand in for Anthropic. */
export type MessagesClient = { messages: Pick<Anthropic['messages'], 'create'> };

/**
 * Claude for features other than the assistant chat (D-096: note tidy-up, incident detection, family updates). Same
 * gate as the assistant (D-092): off without ANTHROPIC_API_KEY, and in production off until ASSISTANT_BAA_CONFIRMED —
 * patient details are sent. Never logs prompt or response text.
 */
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  /** Replaced in tests; created on first use from ANTHROPIC_API_KEY. */
  client: MessagesClient | null = null;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  get enabled(): boolean {
    if (!this.config.get('ANTHROPIC_API_KEY', { infer: true })) return false;
    const production = this.config.get('APP_ENV', { infer: true }) === AppEnv.Production;
    return !production || this.config.get('ASSISTANT_BAA_CONFIRMED', { infer: true });
  }

  get model(): string {
    return this.config.get('ASSISTANT_MODEL', { infer: true });
  }

  /**
   * One structured answer: Claude must call `tool` (its input schema is the shape we want back). Returns the tool
   * input, or throws 503 when AI is off or the call fails.
   */
  async structured<T>(system: string, user: string, tool: { name: string; description: string; input_schema: Anthropic.Tool.InputSchema }): Promise<T> {
    if (!this.enabled) throw new ServiceUnavailableException('AI features aren’t switched on for this agency');
    this.client ??= new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true })! });
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: FORCED_TOOL.test(this.model) ? system : `${system}\n\nAlways answer by calling the ${tool.name} tool.`,
        tools: [tool],
        // Newer models (Opus/Sonnet 5.x, Fable) refuse a forced tool choice; they get the instruction above instead.
        tool_choice: FORCED_TOOL.test(this.model) ? { type: 'tool', name: tool.name } : { type: 'auto' },
        messages: [{ role: 'user', content: user }],
      });
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : 'network';
      this.logger.warn(`AI call failed (${status})`);
      throw new ServiceUnavailableException('The AI service is unavailable right now — please try again in a minute');
    }
    const use = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name);
    if (!use) throw new ServiceUnavailableException('The AI service didn’t return an answer — please try again');
    return use.input as T;
  }
}

@Global()
@Module({ providers: [ClaudeService], exports: [ClaudeService] })
export class AiModule {}
