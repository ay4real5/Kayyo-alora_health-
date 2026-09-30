import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken, inviteEmail, inviteLink, maskEmail } from './agency-invite.js';

describe('agency invite helpers', () => {
  it('masks email addresses for logs', () => {
    expect(maskEmail('owner@sunrise.example')).toBe('o***@sunrise.example');
    expect(maskEmail('nope')).toBe('***');
  });

  it('builds the same kind of link as a password reset (token in the fragment, never sent to servers)', () => {
    expect(inviteLink('https://app.example.test/', 'abc')).toBe('https://app.example.test/reset-password#token=abc');
  });

  it('hashes tokens like the reset service does', () => {
    expect(hashToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });

  it('writes a plain invite with the link on its own line', () => {
    const { subject, text } = inviteEmail('Sunrise Home Health', 'Ada', 'https://app.example.test/reset-password#token=abc');
    expect(subject).toBe('Your Primordial Health administrator account');
    expect(text).toContain('for Sunrise Home Health on Primordial Health');
    expect(text.split('\n')).toContain('https://app.example.test/reset-password#token=abc');
    expect(text).toContain('72 hours');
  });
});
