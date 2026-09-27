import { assertValidVersion, parseKey, type PhiKeyring } from './phi-crypto.js';

export interface PhiKeySettings {
  PHI_ENCRYPTION_KEY?: string;
  PHI_ENCRYPTION_KEY_VERSION: number;
  PHI_ENCRYPTION_PREVIOUS_KEYS?: string;
}

/**
 * Builds the keyring from env settings. Returns undefined when no key is configured.
 * PHI_ENCRYPTION_PREVIOUS_KEYS holds retired keys still needed to decrypt old values: "1:<base64>,2:<base64>".
 * Throws with a message that never includes key material.
 */
export function buildPhiKeyring(settings: PhiKeySettings): PhiKeyring | undefined {
  if (!settings.PHI_ENCRYPTION_KEY) {
    if (settings.PHI_ENCRYPTION_PREVIOUS_KEYS) {
      throw new Error('PHI_ENCRYPTION_PREVIOUS_KEYS is set but PHI_ENCRYPTION_KEY is not');
    }
    return undefined;
  }

  const currentVersion = settings.PHI_ENCRYPTION_KEY_VERSION;
  assertValidVersion(currentVersion);
  const keys = new Map<number, Buffer>([[currentVersion, parseKey(settings.PHI_ENCRYPTION_KEY)]]);

  const entries = (settings.PHI_ENCRYPTION_PREVIOUS_KEYS ?? '').split(',').filter((e) => e.trim());
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    if (separator < 1) {
      throw new Error('PHI_ENCRYPTION_PREVIOUS_KEYS entries must look like "<version>:<base64 key>"');
    }
    const version = Number(entry.slice(0, separator).trim());
    assertValidVersion(version);
    if (keys.has(version)) throw new Error(`PHI key version ${version} is defined twice`);
    keys.set(version, parseKey(entry.slice(separator + 1).trim()));
  }

  return { currentVersion, keys };
}
