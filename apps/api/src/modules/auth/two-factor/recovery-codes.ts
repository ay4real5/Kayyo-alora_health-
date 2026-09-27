import { createHash, randomBytes } from 'node:crypto';
import { base32Encode } from './totp.js';

/**
 * 2FA backup codes (DECISIONS D-026): 16 base32 characters = 80 random bits, shown as XXXX-XXXX-XXXX-XXXX.
 * 80 bits makes an offline brute force of the stored SHA-256 infeasible, so a slow hash isn't needed —
 * and a fast hash lets us look codes up directly by hash.
 */
export const RECOVERY_CODE_COUNT = 10;
const CODE_CHARS = 16;

export function generateRecoveryCode(): string {
  const raw = base32Encode(randomBytes(10)).slice(0, CODE_CHARS);
  return raw.match(/.{4}/g)!.join('-');
}

/** Accepts any case, spaces and dashes — people copy these from paper. Returns undefined if malformed. */
export function normalizeRecoveryCode(input: string): string | undefined {
  const clean = input.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z2-7]{16}$/.test(clean) ? clean : undefined;
}

export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
