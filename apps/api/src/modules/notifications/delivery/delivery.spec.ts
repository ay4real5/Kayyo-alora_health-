import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { effectiveChannel, plannedChannels, type DeliveryFacts } from './delivery-plan.js';
import { createHmac } from 'node:crypto';
import {
  EmailSender,
  PushSender,
  SmsSender,
  acsSignedHeaders,
  parseAcsConnectionString,
  smsText,
  toE164,
  type DeliveryMessage,
  type FetchLike,
} from './senders.js';

/** FAKE settings — never real credentials. */
const SETTINGS: Partial<EnvironmentVariables> = {
  TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'fake-token',
  TWILIO_PHONE_NUMBER: '+15550100000',
  SENDGRID_API_KEY: 'SG.fake',
  SENDGRID_FROM_EMAIL: 'alerts@example.test',
  PUSH_PROVIDER: 'expo',
  FRONTEND_URL: 'https://app.example.test',
};
const config = (overrides: Partial<EnvironmentVariables> = {}) =>
  ({ get: (key: keyof EnvironmentVariables) => ({ ...SETTINGS, ...overrides })[key] }) as unknown as ConfigService<EnvironmentVariables, true>;

const MESSAGE: DeliveryMessage = { notificationId: 'n1', type: 'shift_assigned', title: 'New shift assigned', body: 'Tomorrow at 9:00.', data: { visitId: 'v1' } };

function fakeFetch(status: number, json: unknown, headers: Record<string, string> = {}) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(json), { status, headers }));
}

describe('plannedChannels', () => {
  const base: DeliveryFacts = {
    type: 'shift_assigned',
    preference: null,
    available: { push: true, sms: true, email: true },
    recipient: { isActive: true, isPortalUser: false, hasPhone: true, hasEmail: true, pushDevices: 1 },
  };

  it('follows the type defaults, the person’s choices, what is connected and how they can be reached', () => {
    expect(plannedChannels(base)).toEqual(['push', 'sms']); // DESIGN §13.2: shift_assigned → push, sms
    expect(plannedChannels({ ...base, type: 'payroll_ready' })).toEqual(['email']);
    expect(plannedChannels({ ...base, preference: { channelSms: false, channelEmail: true } })).toEqual(['push', 'email']);
    expect(plannedChannels({ ...base, available: { push: true, sms: false, email: true } })).toEqual(['push']);
    expect(plannedChannels({ ...base, recipient: { ...base.recipient, pushDevices: 0, hasPhone: false } })).toEqual([]);
  });

  it('never texts or emails patients (portal users) or inactive accounts', () => {
    expect(plannedChannels({ ...base, recipient: { ...base.recipient, isPortalUser: true } })).toEqual([]);
    expect(plannedChannels({ ...base, recipient: { ...base.recipient, isActive: false } })).toEqual([]);
  });

  it('a saved choice beats the default', () => {
    expect(effectiveChannel('late_arrival', 'push', null)).toBe(false);
    expect(effectiveChannel('late_arrival', 'push', { channelPush: true })).toBe(true);
  });
});

describe('senders', () => {
  it('are off until their settings are present', () => {
    const off = config({ TWILIO_AUTH_TOKEN: undefined, SENDGRID_API_KEY: undefined, PUSH_PROVIDER: undefined });
    expect([new SmsSender(off).enabled, new EmailSender(off).enabled, new PushSender(off).enabled]).toEqual([false, false, false]);
    expect([new SmsSender(config()).enabled, new EmailSender(config()).enabled, new PushSender(config()).enabled]).toEqual([true, true, true]);
  });

  it('SMS: Twilio form post with a short PHI-free text; 4xx is final, 5xx retries', async () => {
    const sms = new SmsSender(config());
    sms.fetchImpl = fakeFetch(201, { sid: 'SM123' });
    expect(await sms.send('+15550100001', MESSAGE)).toEqual({ ok: true, providerMessageId: 'SM123' });
    const [url, init] = vi.mocked(sms.fetchImpl).mock.calls[0]!;
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${'0'.repeat(32)}/Messages.json`);
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      To: '+15550100001',
      From: '+15550100000',
      Body: 'Primordial Health: New shift assigned — Tomorrow at 9:00. Open the app for details.',
    });
    sms.fetchImpl = fakeFetch(400, { code: 21211 });
    expect(await sms.send('+15550100001', MESSAGE)).toEqual({ ok: false, retry: false, error: 'twilio 400 code 21211' });
    sms.fetchImpl = fakeFetch(503, {});
    expect(await sms.send('+15550100001', MESSAGE)).toMatchObject({ ok: false, retry: true });
    sms.fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await sms.send('+15550100001', MESSAGE)).toEqual({ ok: false, retry: true, error: 'network: TypeError' });
  });

  it('email: SendGrid JSON with a link to the app and no tracking', async () => {
    const email = new EmailSender(config());
    email.fetchImpl = fakeFetch(202, {}, { 'x-message-id': 'abc' });
    expect(await email.send('aide@example.test', MESSAGE)).toEqual({ ok: true, providerMessageId: 'abc' });
    const body = JSON.parse(String(vi.mocked(email.fetchImpl).mock.calls[0]![1].body));
    expect(body.subject).toBe('Primordial Health: New shift assigned');
    expect(body.content[0].value).toContain('Open Primordial Health for details: https://app.example.test');
    expect(body.content[1].type).toBe('text/html');
    expect(body.tracking_settings).toEqual({ click_tracking: { enable: false }, open_tracking: { enable: false } });
  });

  it('push: one Expo message per phone with ids only; gone phones are reported', async () => {
    const push = new PushSender(config());
    push.fetchImpl = fakeFetch(200, { data: [{ status: 'ok', id: 't1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] });
    expect(await push.send(['ExponentPushToken[aaaaaaaaaa]', 'ExponentPushToken[bbbbbbbbbb]'], MESSAGE)).toEqual({
      ok: true,
      providerMessageId: 't1',
      deadTokens: ['ExponentPushToken[bbbbbbbbbb]'],
    });
    const sent = JSON.parse(String(vi.mocked(push.fetchImpl).mock.calls[0]![1].body));
    expect(sent[0]).toMatchObject({ to: 'ExponentPushToken[aaaaaaaaaa]', title: 'New shift assigned', data: { visitId: 'v1', notificationId: 'n1', type: 'shift_assigned' } });
  });

  it('phone numbers become E.164 or nothing', () => {
    expect(toE164('(555) 010-0100')).toBe('+15550100100');
    expect(toE164('1-555-010-0100')).toBe('+15550100100');
    expect(toE164('+44 20 7946 0000')).toBe('+442079460000');
    expect(toE164('0100')).toBeNull();
    expect(toE164(null)).toBeNull();
  });

  it('SMS text stays short and punctuated once', () => {
    expect(smsText({ ...MESSAGE, title: 'Shift cancelled.', body: null })).toBe('Primordial Health: Shift cancelled. Open the app for details.');
    expect(smsText({ ...MESSAGE, body: 'x'.repeat(500) }).length).toBe(320);
  });
});

describe('email through Amazon SES (D-078)', () => {
  const sesConfig = config({ EMAIL_PROVIDER: 'ses', EMAIL_FROM: 'alerts@example.test', AWS_REGION: 'us-east-1', SENDGRID_API_KEY: undefined });

  it('is chosen by EMAIL_PROVIDER, needs a sender and a region', () => {
    expect(new EmailSender(sesConfig).provider).toBe('ses');
    expect(new EmailSender(sesConfig).enabled).toBe(true);
    expect(new EmailSender(config({ EMAIL_PROVIDER: 'ses', AWS_REGION: undefined })).enabled).toBe(false);
    expect(new EmailSender(config({ SENDGRID_API_KEY: undefined })).provider).toBeNull(); // nothing chosen → off
  });

  it('sends plain text from "Primordial Health", and retries only throttling / server errors', async () => {
    const email = new EmailSender(sesConfig);
    const send = vi.fn(async (_command: unknown) => ({ MessageId: 'ses-1' }));
    email.ses = { send } as never;
    expect(await email.send('aide@example.test', MESSAGE)).toEqual({ ok: true, providerMessageId: 'ses-1' });
    const input = (send.mock.calls[0]![0] as { input: Record<string, any> }).input;
    expect(input.FromEmailAddress).toBe('Primordial Health <alerts@example.test>');
    expect(input.Destination).toEqual({ ToAddresses: ['aide@example.test'] });
    expect(input.Content.Simple.Subject.Data).toBe('Primordial Health: New shift assigned');
    expect(input.Content.Simple.Body.Text.Data).toContain('Open Primordial Health for details: https://app.example.test');
    expect(input.Content.Simple.Body.Html.Data).toContain('Primordial Health');

    const fail = (name: string, status: number) =>
      Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
    send.mockRejectedValueOnce(fail('TooManyRequestsException', 429));
    expect(await email.sendText('a@example.test', 's', 't')).toEqual({ ok: false, retry: true, error: 'ses TooManyRequestsException 429' });
    send.mockRejectedValueOnce(fail('MessageRejected', 400));
    expect(await email.sendText('a@example.test', 's', 't')).toEqual({ ok: false, retry: false, error: 'ses MessageRejected 400' });
  });
});

describe('email through Azure Communication Services (D-085)', () => {
  // FAKE key (base64 of "not-a-real-key") — never a real credential.
  const KEY = Buffer.from('not-a-real-key').toString('base64');
  const acsConfig = config({
    EMAIL_PROVIDER: 'azure',
    EMAIL_FROM: 'DoNotReply@example.test',
    AZURE_COMMUNICATION_CONNECTION_STRING: `endpoint=https://fake.communication.azure.com/;accesskey=${KEY}`,
    SENDGRID_API_KEY: undefined,
  });

  it('parses the connection string, and is off without a valid one', () => {
    expect(parseAcsConnectionString(`endpoint=https://fake.communication.azure.com/;accesskey=${KEY}`)).toEqual({
      endpoint: 'https://fake.communication.azure.com',
      accessKey: KEY,
    });
    expect(parseAcsConnectionString('endpoint=http://x;accesskey=a')).toBeNull();
    expect(parseAcsConnectionString('accesskey=a')).toBeNull();
    expect(new EmailSender(acsConfig).enabled).toBe(true);
    expect(new EmailSender(config({ EMAIL_PROVIDER: 'azure', AZURE_COMMUNICATION_CONNECTION_STRING: undefined })).enabled).toBe(false);
  });

  it('signs requests the documented way (HMAC-SHA256 over method, path+query, date, host, body hash)', () => {
    const url = new URL('https://fake.communication.azure.com/emails:send?api-version=2023-03-31');
    const now = new Date('2026-09-29T12:00:00Z');
    const headers = acsSignedHeaders('POST', url, '{"a":1}', KEY, now);
    expect(headers['x-ms-date']).toBe('Tue, 29 Sep 2026 12:00:00 GMT');
    expect(headers['x-ms-content-sha256']).toBe('AVq9f1zFei3ZS3WQ8ErYCEJzkF7jPsXOvq5iJ2qX+GI=');
    const expected = createHmac('sha256', Buffer.from(KEY, 'base64'))
      .update(`POST\n/emails:send?api-version=2023-03-31\nTue, 29 Sep 2026 12:00:00 GMT;fake.communication.azure.com;${headers['x-ms-content-sha256']}`)
      .digest('base64');
    expect(headers.authorization).toBe(`HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${expected}`);
  });

  it('sends plain text without tracking, and retries only throttling / server errors', async () => {
    const email = new EmailSender(acsConfig);
    email.fetchImpl = fakeFetch(202, { id: 'op-1', status: 'Running' });
    expect(await email.send('aide@example.test', MESSAGE)).toEqual({ ok: true, providerMessageId: 'op-1' });
    const [url, init] = vi.mocked(email.fetchImpl).mock.calls[0]!;
    expect(url).toBe('https://fake.communication.azure.com/emails:send?api-version=2023-03-31');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      senderAddress: 'DoNotReply@example.test',
      recipients: { to: [{ address: 'aide@example.test' }] },
      content: { subject: 'Primordial Health: New shift assigned' },
      userEngagementTrackingDisabled: true,
    });
    expect(body.content.plainText).toContain('Open Primordial Health for details: https://app.example.test');
    expect(body.content.html).toContain('<a href="https://app.example.test"');
    expect((init.headers as Record<string, string>).authorization).toMatch(/^HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=/);

    email.fetchImpl = fakeFetch(429, { error: { code: 'TooManyRequests' } });
    expect(await email.sendText('a@example.test', 's', 't')).toEqual({ ok: false, retry: true, error: 'azure 429 TooManyRequests' });
    email.fetchImpl = fakeFetch(400, { error: { code: 'InvalidSenderAddress' } });
    expect(await email.sendText('a@example.test', 's', 't')).toEqual({ ok: false, retry: false, error: 'azure 400 InvalidSenderAddress' });
  });
});
