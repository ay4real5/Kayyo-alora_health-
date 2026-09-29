import {
  base32Decode,
  base32Encode,
  generateSecret,
  otpauthUri,
  timeStep,
  totpAt,
  verifyTotp,
} from './totp.js';

// RFC 6238 Appendix B, SHA-1 column: secret is the ASCII string "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [seconds: number, eightDigits: string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP', () => {
  it.each(RFC_VECTORS)('matches RFC 6238 at T=%i', (seconds, expected) => {
    expect(totpAt(RFC_SECRET, timeStep(seconds * 1000), 8)).toBe(expected);
    expect(totpAt(RFC_SECRET, timeStep(seconds * 1000))).toBe(expected.slice(-6));
  });

  it('round-trips base32 (RFC 4648 vectors)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar');
    const secret = generateSecret();
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });

  it('accepts the current code and ±1 step of clock drift, nothing further', () => {
    const secret = generateSecret();
    const now = Date.UTC(2026, 8, 27, 12, 0, 10);
    const step = timeStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), now)).toBeNull();
  });

  it('rejects malformed codes', () => {
    const secret = generateSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456']) expect(verifyTotp(secret, bad)).toBeNull();
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const uri = otpauthUri('Kayo Health', 'nurse@example.test', base32Decode('MZXW6YTBOI'));
    expect(uri).toBe(
      'otpauth://totp/Kayo%20Health%3Anurse%40example.test?secret=MZXW6YTBOI&issuer=Kayo+Health&algorithm=SHA1&digits=6&period=30',
    );
  });
});
