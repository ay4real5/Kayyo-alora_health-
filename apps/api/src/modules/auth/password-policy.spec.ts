import { describe, expect, it } from 'vitest';
import { passwordChangeRequired } from './password-policy.js';

const DAY = 24 * 60 * 60_000;

describe('passwordChangeRequired', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');

  it('requires a change when the password was never set', () => {
    expect(passwordChangeRequired(null, 90, now)).toBe(true);
  });

  it('accepts a fresh password', () => {
    expect(passwordChangeRequired(new Date(now - DAY), 90, now)).toBe(false);
  });

  it('accepts a password just under the limit and refuses one just over', () => {
    expect(passwordChangeRequired(new Date(now - 89 * DAY), 90, now)).toBe(false);
    expect(passwordChangeRequired(new Date(now - 91 * DAY), 90, now)).toBe(true);
    expect(passwordChangeRequired(new Date(now - 90 * DAY - 1), 90, now)).toBe(true);
  });

  it('is off when the max age is 0 — even for a never-set password', () => {
    expect(passwordChangeRequired(null, 0, now)).toBe(false);
    expect(passwordChangeRequired(new Date(now - 3650 * DAY), 0, now)).toBe(false);
  });
});
