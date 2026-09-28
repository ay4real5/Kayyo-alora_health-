import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

/** The demo admins' authenticator key (FAKE data; see apps/api/src/seed/demo-seed.ts DEMO_TOTP_SECRET). */
const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of text.replace(/=+$/, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** RFC 6238 code (SHA-1, 6 digits, 30 s) for a given time step. */
function totp(step: number, secret = DEMO_TOTP_SECRET): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

/**
 * Answers the sign-in code prompt for a demo admin (admins must use 2FA, D-045). A code works once, so a second
 * admin sign-in within the same 30 seconds is refused as a replay — then wait for the next code and try again.
 */
export async function answerTwoFactor(page: Page): Promise<void> {
  const field = page.getByLabel('Authentication code');
  await expect(field).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    const step = Math.floor(Date.now() / 30_000);
    await field.fill(totp(step));
    await page.getByRole('button', { name: 'Verify' }).click();
    const outcome = await Promise.race([
      page.getByRole('heading', { name: /Welcome/ }).waitFor().then(() => 'in' as const),
      page.getByRole('alert').filter({ hasText: /code/i }).waitFor().then(() => 'refused' as const),
    ]);
    if (outcome === 'in') return;
    await page.waitForTimeout((step + 1) * 30_000 - Date.now() + 500); // next code
  }
  throw new Error('Could not complete two-factor sign-in');
}
