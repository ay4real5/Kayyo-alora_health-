import { checkPassword } from './password-policy.js';

describe('checkPassword', () => {
  it('accepts a password meeting every rule', () => {
    expect(checkPassword('Correct-Horse-9')).toEqual({ valid: true, problems: [] });
  });

  it('lists every rule that fails', () => {
    const result = checkPassword('short');
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      'must be at least 12 characters',
      'must contain an uppercase letter',
      'must contain a number',
      'must contain a special character',
    ]);
  });

  it('rejects overly long passwords', () => {
    expect(checkPassword(`Aa1!${'x'.repeat(130)}`).problems).toContain('must be at most 128 characters');
  });
});
