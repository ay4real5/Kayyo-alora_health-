import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { decryptPhi, encryptPhi, type PhiKeyring } from './phi-crypto.js';
import { buildPhiKeyring } from './phi-keyring.js';

/**
 * Context labels bound into each ciphertext. One per encrypted column — add new columns here.
 * Changing a label makes existing values undecryptable, so never rename one.
 */
export const PhiContext = {
  PatientSsn: 'patients.ssn_encrypted',
  StaffSsn: 'staff_profiles.ssn_encrypted',
  UserTwoFaSecret: 'users.two_fa_secret',
  AgencyTaxId: 'agencies.tax_id',
} as const;
export type PhiContext = (typeof PhiContext)[keyof typeof PhiContext];

@Injectable()
export class PhiCryptoService {
  private readonly keyring: PhiKeyring | undefined;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.keyring = buildPhiKeyring({
      PHI_ENCRYPTION_KEY: config.get('PHI_ENCRYPTION_KEY', { infer: true }),
      PHI_ENCRYPTION_KEY_VERSION: config.get('PHI_ENCRYPTION_KEY_VERSION', { infer: true }),
      PHI_ENCRYPTION_PREVIOUS_KEYS: config.get('PHI_ENCRYPTION_PREVIOUS_KEYS', { infer: true }),
    });
  }

  encrypt(plaintext: string, context: PhiContext): Uint8Array<ArrayBuffer> {
    return new Uint8Array(encryptPhi(plaintext, context, this.requireKeyring()));
  }

  decrypt(blob: Uint8Array, context: PhiContext): string {
    return decryptPhi(blob, context, this.requireKeyring());
  }

  /** Convenience for nullable columns. */
  encryptOptional(
    plaintext: string | null | undefined,
    context: PhiContext,
  ): Uint8Array<ArrayBuffer> | null {
    return plaintext == null ? null : this.encrypt(plaintext, context);
  }

  decryptOptional(blob: Uint8Array | null | undefined, context: PhiContext): string | null {
    return blob == null ? null : this.decrypt(blob, context);
  }

  private requireKeyring(): PhiKeyring {
    if (!this.keyring) {
      throw new Error('PHI_ENCRYPTION_KEY is not set — cannot encrypt or decrypt PHI');
    }
    return this.keyring;
  }
}
