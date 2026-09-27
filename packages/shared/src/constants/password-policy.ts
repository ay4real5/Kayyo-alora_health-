/** Password policy (DESIGN.md §7.3). Shared so the web and mobile apps can show the same rules as the API. */
export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
} as const;

export interface PasswordCheck {
  valid: boolean;
  problems: string[];
}

export function checkPassword(password: string): PasswordCheck {
  const problems: string[] = [];
  if (password.length < PASSWORD_POLICY.minLength) {
    problems.push(`must be at least ${PASSWORD_POLICY.minLength} characters`);
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    problems.push(`must be at most ${PASSWORD_POLICY.maxLength} characters`);
  }
  if (!/[a-z]/.test(password)) problems.push('must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('must contain an uppercase letter');
  if (!/[0-9]/.test(password)) problems.push('must contain a number');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('must contain a special character');
  return { valid: problems.length === 0, problems };
}
