import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PhiContext, PhiCryptoService } from './phi-crypto.service.js';

const key = () => randomBytes(32).toString('base64');
const service = (env: Record<string, unknown>) =>
  new PhiCryptoService(new ConfigService({ PHI_ENCRYPTION_KEY_VERSION: 1, ...env }) as never);

describe('PhiCryptoService', () => {
  it('encrypts and decrypts with the configured key, as bytes Prisma can store', () => {
    const svc = service({ PHI_ENCRYPTION_KEY: key() });
    const blob = svc.encrypt('123-45-6789', PhiContext.PatientSsn);
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(svc.decrypt(blob, PhiContext.PatientSsn)).toBe('123-45-6789');
    expect(svc.encryptOptional(null, PhiContext.PatientSsn)).toBeNull();
    expect(svc.decryptOptional(undefined, PhiContext.PatientSsn)).toBeNull();
  });

  it('decrypts values written before a key rotation', () => {
    const oldKey = key();
    const blob = service({ PHI_ENCRYPTION_KEY: oldKey }).encrypt('secret', PhiContext.UserTwoFaSecret);

    const rotated = service({
      PHI_ENCRYPTION_KEY: key(),
      PHI_ENCRYPTION_KEY_VERSION: 2,
      PHI_ENCRYPTION_PREVIOUS_KEYS: `1:${oldKey}`,
    });
    expect(rotated.decrypt(blob, PhiContext.UserTwoFaSecret)).toBe('secret');
  });

  it('can be constructed without a key but refuses to touch PHI', () => {
    const svc = service({});
    expect(() => svc.encrypt('x', PhiContext.PatientSsn)).toThrow(/PHI_ENCRYPTION_KEY is not set/);
  });
});
