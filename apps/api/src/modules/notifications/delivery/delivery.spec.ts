import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { effectiveChannel, plannedChannels, type DeliveryFacts } from './delivery-plan.js';
import { EmailSender, PushSender, SmsSender, smsText, toE164, type DeliveryMessage, type FetchLike } from './senders.js';

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
      Body: 'Kayo Health: New shift assigned — Tomorrow at 9:00. Open the app for details.',
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
    expect(body.subject).toBe('Kayo Health: New shift assigned');
    expect(body.content[0].value).toContain('Open Kayo Health for details: https://app.example.test');
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
    expect(smsText({ ...MESSAGE, title: 'Shift cancelled.', body: null })).toBe('Kayo Health: Shift cancelled. Open the app for details.');
    expect(smsText({ ...MESSAGE, body: 'x'.repeat(500) }).length).toBe(320);
  });
});
