import { randomBytes } from 'node:crypto';
import {
  PhiDecryptionError,
  decryptPhi,
  decryptPhiBytes,
  encryptPhi,
  encryptPhiBytes,
  keyVersionOf,
  parseKey,
  type PhiKeyring,
} from './phi-crypto.js';

const newKey = () => randomBytes(32);
const ring = (currentVersion: number, keys: Record<number, Buffer>): PhiKeyring => ({
  currentVersion,
  keys: new Map(Object.entries(keys).map(([v, k]) => [Number(v), k])),
});

describe('PHI encryption', () => {
  const k1 = newKey();
  const keyring = ring(1, { 1: k1 });

  it('round-trips binary content, bound to its record', () => {
    const file = randomBytes(5000);
    const blob = encryptPhiBytes(file, 'documents.content:doc-1', keyring);
    expect(decryptPhiBytes(blob, 'documents.content:doc-1', keyring).equals(file)).toBe(true);
    expect(() => decryptPhiBytes(blob, 'documents.content:doc-2', keyring)).toThrow(PhiDecryptionError);
  });

  it('round-trips text, including unicode', () => {
    for (const value of ['123-45-6789', '', 'Zoë Ñúñez 🏥']) {
      expect(decryptPhi(encryptPhi(value, 'patients.ssn', keyring), 'patients.ssn', keyring)).toBe(value);
    }
  });

  it('never produces the same bytes twice for the same value', () => {
    const a = encryptPhi('123-45-6789', 'patients.ssn', keyring);
    const b = encryptPhi('123-45-6789', 'patients.ssn', keyring);
    expect(a.equals(b)).toBe(false);
    expect(a.toString('utf8')).not.toContain('123-45-6789');
  });

  it('detects tampering', () => {
    const blob = encryptPhi('123-45-6789', 'patients.ssn', keyring);
    blob[blob.length - 1]! ^= 0xff;
    expect(() => decryptPhi(blob, 'patients.ssn', keyring)).toThrow(PhiDecryptionError);
  });

  it('refuses a value moved to a different column', () => {
    const blob = encryptPhi('123-45-6789', 'patients.ssn', keyring);
    expect(() => decryptPhi(blob, 'staff_profiles.ssn', keyring)).toThrow(PhiDecryptionError);
  });

  it('supports key rotation: old values decrypt, new values use the new key', () => {
    const k2 = newKey();
    const oldBlob = encryptPhi('old secret', 'ctx', keyring);
    const rotated = ring(2, { 1: k1, 2: k2 });

    expect(decryptPhi(oldBlob, 'ctx', rotated)).toBe('old secret');
    const newBlob = encryptPhi('new secret', 'ctx', rotated);
    expect(keyVersionOf(newBlob)).toBe(2);
    expect(() => decryptPhi(newBlob, 'ctx', keyring)).toThrow(/no key for version 2/);
  });

  it('rejects truncated input and the wrong key', () => {
    expect(() => decryptPhi(Buffer.alloc(5), 'ctx', keyring)).toThrow(/too short/);
    const blob = encryptPhi('x', 'ctx', keyring);
    expect(() => decryptPhi(blob, 'ctx', ring(1, { 1: newKey() }))).toThrow(PhiDecryptionError);
  });

  it('error messages never contain the plaintext', () => {
    const blob = encryptPhi('123-45-6789', 'patients.ssn', keyring);
    blob[20]! ^= 1;
    try {
      decryptPhi(blob, 'patients.ssn', keyring);
    } catch (e) {
      expect(String(e)).not.toContain('123-45-6789');
    }
  });

  it('only accepts 32-byte base64 keys', () => {
    expect(parseKey(k1.toString('base64')).equals(k1)).toBe(true);
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => parseKey('not base64!!')).toThrow(/32 bytes/);
  });
});
