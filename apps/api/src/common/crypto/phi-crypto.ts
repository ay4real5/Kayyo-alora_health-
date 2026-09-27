import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for PHI (SSNs, 2FA secrets, …) — DECISIONS D-006.
 *
 * Stored format (BYTEA): [key version: 1 byte][IV: 12 bytes][GCM auth tag: 16 bytes][ciphertext]
 *
 * - AES-256-GCM: tampering with any byte makes decryption fail instead of returning garbage.
 * - A fresh random IV per value: the same SSN never encrypts to the same bytes twice.
 * - The key version byte lets us rotate keys: new values use the current key, old values still decrypt
 *   with the previous key they were written with.
 * - `context` (e.g. "patients.ssn") is bound as additional authenticated data, so a ciphertext copied
 *   into a different column or table will not decrypt.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export interface PhiKeyring {
  currentVersion: number;
  /** version → 32-byte key. Must contain currentVersion. */
  keys: ReadonlyMap<number, Buffer>;
}

export class PhiDecryptionError extends Error {
  constructor(reason: string) {
    // Never include plaintext or key material in this message.
    super(`PHI decryption failed: ${reason}`);
    this.name = 'PhiDecryptionError';
  }
}

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== base64.trim()) {
    throw new Error(`PHI encryption key must be ${KEY_BYTES} bytes, base64-encoded`);
  }
  return key;
}

export function assertValidVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > 255) {
    throw new Error('PHI key version must be an integer from 1 to 255');
  }
}

export function encryptPhi(plaintext: string, context: string, keyring: PhiKeyring): Buffer {
  const key = keyring.keys.get(keyring.currentVersion);
  if (!key) throw new Error(`No PHI key for current version ${keyring.currentVersion}`);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return Buffer.concat([Buffer.from([keyring.currentVersion]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptPhi(blob: Uint8Array, context: string, keyring: PhiKeyring): string {
  const data = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (data.length < HEADER_BYTES) throw new PhiDecryptionError('value is too short');

  const version = data[0]!;
  const key = keyring.keys.get(version);
  if (!key) throw new PhiDecryptionError(`no key for version ${version}`);

  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, HEADER_BYTES);
  const ciphertext = data.subarray(HEADER_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new PhiDecryptionError('value was tampered with, or the key/context does not match');
  }
}

/** The key version a stored value was encrypted with — used to find values that need re-encrypting. */
export function keyVersionOf(blob: Uint8Array): number | undefined {
  return blob.length > 0 ? blob[0] : undefined;
}
