import { createHash, createHmac } from 'node:crypto';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeliveryChannel } from '@alora/shared';
import type { EnvironmentVariables } from '../../../config/env.validation.js';

/**
 * Senders for the channels outside the app (DECISIONS D-071, D-078, D-085): Twilio SMS, Azure / Amazon SES / SendGrid
 * email, Expo push. Each is plain HTTPS (SES uses AWS's client) and is **off until its settings are present**. They never log message text or contact details.
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

/** "Primordial Health: New shift assigned — Open the app to see it." — one short, PHI-free SMS. */
export function smsText(message: DeliveryMessage): string {
  const parts = [message.title, message.body].filter((p): p is string => Boolean(p?.trim())).map((p) => p.trim().replace(/[.!]+$/, ''));
  return `Primordial Health: ${parts.join(' — ')}. Open the app for details.`.slice(0, 320);
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

/** Minimal view of the SES v2 client, so tests can stand in for AWS. */
export interface SesLike {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

/** "endpoint=https://x.communication.azure.com/;accesskey=…" → its parts, or null if it isn't one. */
export function parseAcsConnectionString(value: string | undefined): { endpoint: string; accessKey: string } | null {
  if (!value) return null;
  const parts = new Map<string, string>();
  for (const part of value.split(';')) {
    const at = part.indexOf('=');
    if (at > 0) parts.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  const endpoint = parts.get('endpoint');
  const accessKey = parts.get('accesskey');
  if (!endpoint || !accessKey || !/^https:\/\/[^/]+/.test(endpoint)) return null;
  return { endpoint: endpoint.replace(/\/+$/, ''), accessKey };
}

/**
 * Azure Communication Services request signing (HMAC-SHA256 over method, path, date, host and body hash), as
 * documented for its REST API. Returns the headers to add.
 */
export function acsSignedHeaders(method: string, url: URL, body: string, accessKey: string, now: Date = new Date()): Record<string, string> {
  const date = now.toUTCString();
  const contentHash = createHash('sha256').update(body, 'utf8').digest('base64');
  const toSign = `${method}\n${url.pathname}${url.search}\n${date};${url.host};${contentHash}`;
  const signature = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(toSign, 'utf8').digest('base64');
  return {
    'x-ms-date': date,
    'x-ms-content-sha256': contentHash,
    authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
  };
}

/**
 * Email (D-071, D-078, D-085): **Azure Communication Services** (production — same Microsoft agreement and BAA as the
 * hosting), **Amazon SES** (AWS BAA; the fallback) or SendGrid (no BAA — development only). Chosen by EMAIL_PROVIDER;
 * off until the provider's settings are present.
 */
@Injectable()
export class EmailSender extends Sender {
  readonly channel = 'email' as const;
  /** Replaced in tests; created on first use with the standard AWS credential chain (task role, env vars). */
  ses: SesLike | null = null;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    super();
  }

  get provider(): 'azure' | 'ses' | 'sendgrid' | null {
    const chosen = this.config.get('EMAIL_PROVIDER', { infer: true });
    if (chosen) return chosen;
    return this.config.get('SENDGRID_API_KEY', { infer: true }) ? 'sendgrid' : null;
  }

  private get from(): string | undefined {
    return this.config.get('EMAIL_FROM', { infer: true }) ?? this.config.get('SENDGRID_FROM_EMAIL', { infer: true });
  }

  get enabled(): boolean {
    if (!this.from) return false;
    if (this.provider === 'azure') return parseAcsConnectionString(this.config.get('AZURE_COMMUNICATION_CONNECTION_STRING', { infer: true })) !== null;
    if (this.provider === 'ses') return Boolean(this.config.get('AWS_REGION', { infer: true }));
    if (this.provider === 'sendgrid') return Boolean(this.config.get('SENDGRID_API_KEY', { infer: true }));
    return false;
  }

  async send(to: string, message: DeliveryMessage): Promise<SendOutcome> {
    const link = this.config.get('FRONTEND_URL', { infer: true });
    const text = [message.title, message.body, '', link ? `Open Primordial Health for details: ${link}` : 'Open Primordial Health for details.', '', 'You can change which alerts you get by email under Notification settings.']
      .filter((line) => line !== null)
      .join('\n');
    return this.sendText(to, `Primordial Health: ${message.title}`, text);
  }

  /** A plain-text email (notifications, password reset links). */
  async sendText(to: string, subject: string, text: string): Promise<SendOutcome> {
    const short = subject.slice(0, 200);
    if (this.provider === 'azure') return this.viaAzure(to, short, text);
    return this.provider === 'ses' ? this.viaSes(to, short, text) : this.viaSendGrid(to, short, text);
  }

  /** Azure Communication Services Email: accepted (202) means queued; the display name is set on the sender in Azure. */
  private async viaAzure(to: string, subject: string, text: string): Promise<SendOutcome> {
    const acs = parseAcsConnectionString(this.config.get('AZURE_COMMUNICATION_CONNECTION_STRING', { infer: true }))!;
    const url = new URL(`${acs.endpoint}/emails:send?api-version=2023-03-31`);
    const body = JSON.stringify({
      senderAddress: this.from,
      recipients: { to: [{ address: to }] },
      content: { subject, plainText: text },
      // No open/click tracking: it rewrites links (reset links included) and adds pixels.
      userEngagementTrackingDisabled: true,
    });
    const { response, error } = await post(this.fetchImpl, url.toString(), {
      headers: { 'content-type': 'application/json', ...acsSignedHeaders('POST', url, body, acs.accessKey) },
      body,
    });
    if (!response) return { ok: false, retry: true, error: error! };
    const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { code?: string } };
    if (response.ok) return { ok: true, providerMessageId: json.id ?? response.headers.get('operation-id') };
    return { ok: false, retry: retryable(response.status), error: `azure ${response.status}${json.error?.code ? ` ${json.error.code}` : ''}` };
  }

  private async viaSes(to: string, subject: string, text: string): Promise<SendOutcome> {
    this.ses ??= new SESv2Client({ region: this.config.get('AWS_REGION', { infer: true }) });
    try {
      const result = await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: `Primordial Health <${this.from}>`,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } } },
        }),
      );
      return { ok: true, providerMessageId: result.MessageId ?? null };
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      const status = e.$metadata?.httpStatusCode ?? 0;
      const throttled = e.name === 'TooManyRequestsException' || e.name === 'ThrottlingException' || e.name === 'LimitExceededException';
      return { ok: false, retry: throttled || status === 0 || retryable(status), error: `ses ${e.name ?? 'error'}${status ? ` ${status}` : ''}` };
    }
  }

  private async viaSendGrid(to: string, subject: string, text: string): Promise<SendOutcome> {
    const { response, error } = await post(this.fetchImpl, 'https://api.sendgrid.com/v3/mail/send', {
      headers: { authorization: `Bearer ${this.config.get('SENDGRID_API_KEY', { infer: true })}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.from, name: 'Primordial Health' },
        subject,
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
