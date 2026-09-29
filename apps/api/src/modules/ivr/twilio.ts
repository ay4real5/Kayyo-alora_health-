import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Twilio webhook helpers (D-073): request signatures and a tiny TwiML builder. No SDK.
 */

/**
 * Twilio's X-Twilio-Signature: base64(HMAC-SHA1(auth token, full URL + every POST parameter name and value, sorted by
 * name)). https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Text and double-quoted attribute values (apostrophes are fine in both). */
const escapeXml = (text: string) => text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** One TwiML verb. */
export type TwimlVerb =
  | { say: string }
  | { gather: { action: string; numDigits?: number; finishOnKey?: string; timeout?: number; prompt: string } }
  | { redirect: string }
  | 'hangup';

export function twiml(...verbs: TwimlVerb[]): string {
  const say = (text: string) => `<Say voice="Polly.Joanna">${escapeXml(text)}</Say>`;
  const body = verbs
    .map((verb) => {
      if (verb === 'hangup') return '<Hangup/>';
      if ('say' in verb) return say(verb.say);
      if ('redirect' in verb) return `<Redirect method="POST">${escapeXml(verb.redirect)}</Redirect>`;
      const g = verb.gather;
      const attrs = [
        `action="${escapeXml(g.action)}"`,
        'method="POST"',
        'input="dtmf"',
        g.numDigits ? `numDigits="${g.numDigits}"` : '',
        g.finishOnKey ? `finishOnKey="${escapeXml(g.finishOnKey)}"` : '',
        `timeout="${g.timeout ?? 8}"`,
      ].filter(Boolean);
      return `<Gather ${attrs.join(' ')}>${say(g.prompt)}</Gather>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}
