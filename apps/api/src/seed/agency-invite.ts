/** Helpers for `create-agency --invite` (D-084): the invite email and log-safe output. Pure, so they're unit-tested. */
import { createHash } from 'node:crypto';

/** How long the first "choose your password" link works. Longer than a reset link: the new admin may not be expecting it. */
export const INVITE_LINK_HOURS = 72;

/** Same hashing as password reset links (only the hash is stored). */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** "owner@sunrise.example" → "o***@sunrise.example", for logs. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function inviteLink(frontendUrl: string, token: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/reset-password#token=${token}`;
}

export function inviteEmail(agencyName: string, firstName: string, link: string): { subject: string; text: string } {
  return {
    subject: 'Your Primordial Health administrator account',
    text: [
      `Hello ${firstName},`,
      '',
      `An administrator account has been created for you for ${agencyName} on Primordial Health.`,
      '',
      `Choose your password here (the link works once, for ${INVITE_LINK_HOURS} hours):`,
      link,
      '',
      'Next you will set up two-factor authentication with an authenticator app. Keep the recovery codes it shows you somewhere safe.',
      '',
      "If you weren't expecting this, ignore this email; no one can use the account without this link.",
    ].join('\n'),
  };
}
