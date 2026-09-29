import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { usDigits } from './ivr.service.js';
import { twiml, twilioSignature, validTwilioSignature } from './twilio.js';

describe('Twilio signatures', () => {
  const token = 'fake-auth-token';
  const url = 'https://app.example.test/api/v1/ivr/voice/code?tries=1';
  const params = { From: '+15550100123', Digits: '1234', CallSid: 'CA00000000000000000000000000000000' };

  it('HMAC-SHA1 over the URL plus the parameters sorted by name', () => {
    const data = `${url}CallSidCA00000000000000000000000000000000Digits1234From+15550100123`;
    expect(twilioSignature(token, url, params)).toBe(createHmac('sha1', token).update(data).digest('base64'));
  });

  it('accepts only an exact match', () => {
    const sig = twilioSignature(token, url, params);
    expect(validTwilioSignature(token, url, params, sig)).toBe(true);
    expect(validTwilioSignature(token, url, { ...params, Digits: '9999' }, sig)).toBe(false); // tampered body
    expect(validTwilioSignature(token, `${url}&x=1`, params, sig)).toBe(false); // tampered URL
    expect(validTwilioSignature('other-token', url, params, sig)).toBe(false);
    expect(validTwilioSignature(token, url, params, undefined)).toBe(false);
  });
});

describe('twiml', () => {
  it('builds Say / Gather / Hangup with escaped text', () => {
    expect(twiml({ gather: { action: '/a?x=1&y=2', numDigits: 1, prompt: 'Press 1 <now>' } }, 'hangup')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Gather action="/a?x=1&amp;y=2" method="POST" input="dtmf" numDigits="1" timeout="8"><Say voice="Polly.Joanna">Press 1 &lt;now&gt;</Say></Gather>' +
        '<Hangup/></Response>',
    );
  });
});

describe('usDigits', () => {
  it('reduces caller IDs and stored numbers to 10 US digits', () => {
    expect(usDigits('+15550100123')).toBe('5550100123');
    expect(usDigits('(555) 010-0123')).toBe('5550100123');
    expect(usDigits('anonymous')).toBeNull();
    expect(usDigits('+442079460000')).toBeNull();
  });
});
