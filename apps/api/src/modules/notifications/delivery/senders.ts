import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeliveryChannel } from '@alora/shared';
import type { EnvironmentVariables } from '../../../config/env.validation.js';

/**
 * Senders for the channels outside the app (DECISIONS D-071): Twilio SMS, SendGrid email, Expo push. Each is plain
 * HTTPS (no SDKs) and is **off until its settings are present**. They never log message text or contact details.
 */

/** What a notification says — its title and body, which are PHI-free by contract (DESIGN.md §13.3). */
export interface DeliveryMessage {
  notificationId: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
}

export type SendOutcome =
  | { ok: true; providerMessageId: string | null; deadTokens?: string[] }
  | { ok: false; retry: boolean; error: string; deadTokens?: string[] };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 2xx ok; 408/429/5xx and network errors are worth retrying; other 4xx are not. */
async function post(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ response?: Response; error?: string }> {
  try {
    return { response: await fetchImpl(url, { ...init, method: 'POST', signal: AbortSignal.timeout(15_000) }) };
  } catch (error) {
    return { error: `network: ${(error as Error).name}` };
  }
}
const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

abstract class Sender {
  abstract readonly channel: DeliveryChannel;
  /** Replaced in tests. */
  fetchImpl: FetchLike = (url, init) => fetch(url, init);
  abstract get enabled(): boolean;
}

/** E.164 for a stored phone number: 10 US digits → +1…; "+<8–15 digits>" kept; anything else → null. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+')) return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** "Alora: New shift assigned — Open the app to see it." — one short, PHI-free SMS. */
export function smsText(message: DeliveryMessage): string {
  const parts = [message.title, message.body].filter((p): p is string => Boolean(p?.trim())).map((p) => p.trim().replace(/[.!]+$/, ''));
  return `Alora: ${parts.join(' — ')}. Open the app for details.`.slice(0, 320);
}

@Injectable()
export class SmsSender extends Sender {
  readonly channel = 'sms' as const;
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    super();
  }

  get enabled(): boolean {
    return Boolean(
      this.config.get('TWILIO_ACCOUNT_SID', { infer: true }) &&
        this.config.get('TWILIO_AUTH_TOKEN', { infer: true }) &&
        this.config.get('TWILIO_PHONE_NUMBER', { infer: true }),
    );
  }

  async send(to: string, message: DeliveryMessage): Promise<SendOutcome> {
    const sid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true })!;
    const token = this.config.get('TWILIO_AUTH_TOKEN', { infer: true })!;
    const { response, error } = await post(this.fetchImpl, `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: this.config.get('TWILIO_PHONE_NUMBER', { infer: true })!, Body: smsText(message) }),
    });
    if (!response) return { ok: false, retry: true, error: error! };
    const json = (await response.json().catch(() => ({}))) as { sid?: string; code?: number };
    if (response.ok) return { ok: true, providerMessageId: json.sid ?? null };
    return { ok: false, retry: retryable(response.status), error: `twilio ${response.status}${json.code ? ` code ${json.code}` : ''}` };
  }
}

@Injectable()
export class EmailSender extends Sender {
  readonly channel = 'email' as const;
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    super();
  }

  get enabled(): boolean {
    return Boolean(this.config.get('SENDGRID_API_KEY', { infer: true }) && this.config.get('SENDGRID_FROM_EMAIL', { infer: true }));
  }

  async send(to: string, message: DeliveryMessage): Promise<SendOutcome> {
    const link = this.config.get('FRONTEND_URL', { infer: true });
    const text = [message.title, message.body, '', link ? `Open Alora for details: ${link}` : 'Open Alora for details.', '', 'You can change which alerts you get by email under Notification settings.']
      .filter((line) => line !== null)
      .join('\n');
    return this.sendText(to, `Alora: ${message.title}`, text);
  }

  /** A plain-text email (notifications, password reset links). */
  async sendText(to: string, subject: string, text: string): Promise<SendOutcome> {
    const { response, error } = await post(this.fetchImpl, 'https://api.sendgrid.com/v3/mail/send', {
      headers: { authorization: `Bearer ${this.config.get('SENDGRID_API_KEY', { infer: true })}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.config.get('SENDGRID_FROM_EMAIL', { infer: true }), name: 'Alora' },
        subject: subject.slice(0, 200),
        content: [{ type: 'text/plain', value: text }],
        // No open/click tracking: it rewrites links (reset links included) and adds pixels.
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
      }),
    });
    if (!response) return { ok: false, retry: true, error: error! };
    if (response.ok) return { ok: true, providerMessageId: response.headers.get('x-message-id') };
    return { ok: false, retry: retryable(response.status), error: `sendgrid ${response.status}` };
  }
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  details?: { error?: string };
}

@Injectable()
export class PushSender extends Sender {
  readonly channel = 'push' as const;
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    super();
  }

  get enabled(): boolean {
    return this.config.get('PUSH_PROVIDER', { infer: true }) === 'expo';
  }

  /** One message per registered phone. Tokens Expo says are gone come back in `deadTokens` to be removed. */
  async send(tokens: string[], message: DeliveryMessage): Promise<SendOutcome> {
    const accessToken = this.config.get('EXPO_ACCESS_TOKEN', { infer: true });
    const { response, error } = await post(this.fetchImpl, 'https://exp.host/--/api/v2/push/send', {
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: message.title,
          ...(message.body ? { body: message.body } : {}),
          // IDs only — the app loads the details after sign-in.
          data: { ...(message.data ?? {}), notificationId: message.notificationId, type: message.type },
          sound: 'default',
          priority: 'high',
        })),
      ),
    });
    if (!response) return { ok: false, retry: true, error: error! };
    if (!response.ok) return { ok: false, retry: retryable(response.status), error: `expo ${response.status}` };
    const tickets = ((await response.json().catch(() => ({}))) as { data?: ExpoTicket[] }).data ?? [];
    const deadTokens = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
    const sent = tickets.find((t) => t.status === 'ok');
    if (sent) return { ok: true, providerMessageId: sent.id ?? null, deadTokens };
    const reason = tickets.find((t) => t.status === 'error')?.details?.error ?? 'no ticket';
    return { ok: false, retry: reason === 'MessageRateExceeded', error: `expo ${reason}`, deadTokens };
  }
}
