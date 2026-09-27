import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes.js';

describe('recovery codes', () => {
  it('look like XXXX-XXXX-XXXX-XXXX and are unique', () => {
    const codes = Array.from({ length: 200 }, generateRecoveryCode);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('normalise case, spaces and dashes, and reject malformed input', () => {
    expect(normalizeRecoveryCode(' abcd-efgh ijkl-mnop ')).toBe('ABCDEFGHIJKLMNOP');
    expect(normalizeRecoveryCode('ABCD-EFGH-IJKL')).toBeUndefined(); // too short
    expect(normalizeRecoveryCode('ABCD-EFGH-IJKL-MN01')).toBeUndefined(); // 0 and 1 aren't base32
  });

  it('hash identically however the code was typed', () => {
    const code = generateRecoveryCode();
    expect(hashRecoveryCode(normalizeRecoveryCode(code.toLowerCase())!)).toBe(
      hashRecoveryCode(normalizeRecoveryCode(code)!),
    );
  });
});
